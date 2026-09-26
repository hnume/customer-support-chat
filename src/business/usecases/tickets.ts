// ============================================================
// usecases/tickets — ขั้นตอนทางธุรกิจของ ticket
// ไม่รู้จัก express / socket.io / SQL — คุยผ่าน ports เท่านั้น
// ============================================================
import {
  bumpPriority, isChannel, isClosed, isPriority, isStatus, isValidEmail, ticketNumberFromSubject,
  type Agent, type Priority, type Side, type Ticket, type TicketMessage, type TicketPatch,
} from '../models/ticket';
import { computeDue, slaState } from '../models/slaPolicy';
import { toCustomerView, type CustomerTicketView } from '../models/views';
import { notFound, validation } from '../models/errors';
import type { TicketFilter } from '../ports';
import { findSupervisor, pickAgent } from './assignment';
import type { Deps } from './deps';

export interface OpenTicketInput {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
  priority?: string;
  category?: string;
  channel?: string;
}

export function makeTicketUseCases(d: Deps) {
  const nowIso = () => d.clock().toISOString();

  async function load(idOrNumber: string): Promise<Ticket> {
    const t = await d.tickets.find(idOrNumber);
    if (!t) throw notFound('ไม่พบ ticket');
    return t;
  }

  async function recomputeDue(t: Ticket, patch: TicketPatch = {}): Promise<void> {
    const next = { ...t, ...patch };
    await d.tickets.update(t.id, { ...patch, slaDueAt: computeDue(next, d.slaUnitMs) });
  }

  // ---------- สร้าง ticket (Web / Mobile / Chat / Email) ----------
  async function open(input: OpenTicketInput): Promise<Ticket> {
    if (!isValidEmail(input.email)) throw validation('กรุณาระบุอีเมลให้ถูกต้อง');
    if (!input.subject && !input.message) throw validation('กรุณาระบุหัวข้อหรือรายละเอียดปัญหา');

    const customer = await d.customers.upsertByEmail({
      name: input.name?.trim() || input.email,
      email: input.email.trim().toLowerCase(),
    });
    const created = await d.tickets.create({
      customerId: customer.id,
      subject: input.subject?.trim() || '(ไม่มีหัวข้อ)',
      category: input.category || 'general',
      channel: isChannel(input.channel) ? input.channel : 'web',
      priority: isPriority(input.priority) ? input.priority : 'normal',
    });
    await d.tickets.addEvent(created.id, 'created', `สร้าง ticket ผ่านช่องทาง ${created.channel}`);
    await recomputeDue(created);

    const agent = await pickAgent(d);
    if (agent) {
      await d.tickets.update(created.id, { assigneeId: agent.id });
      await d.tickets.addEvent(created.id, 'assigned', `Auto-assign ให้ ${agent.name}`);
      d.notifier.alertAgent(agent.id, {
        type: 'assigned', ticketId: created.id, text: `ได้รับ ticket ใหม่ ${created.number}: ${created.subject}`,
      });
    }
    if (input.message) {
      await d.tickets.addMessage(created.id, {
        from: 'customer', senderId: customer.id, senderName: customer.name, text: input.message, internal: false,
      });
    }
    const t = await load(created.id);
    d.notifier.ticketChanged(t, 'new');
    return t;
  }

  // ---------- ส่งข้อความ (ลูกค้า / agent) ----------
  async function post(t: Ticket, from: Side, sender: { id: string; name: string }, text: string, internal: boolean): Promise<TicketMessage> {
    text = String(text ?? '').trim();
    if (!text) throw validation('ข้อความว่าง');
    const m = await d.tickets.addMessage(t.id, { from, senderId: sender.id, senderName: sender.name, text, internal });

    if (from === 'agent' && !internal) {
      if (!t.firstResponseAt) {
        await recomputeDue(t, { firstResponseAt: m.at, slaWarned: false });
        await d.tickets.addEvent(t.id, 'first_response', `ตอบกลับครั้งแรกโดย ${sender.name}`, sender.id);
      }
      if (t.status === 'open') await d.tickets.update(t.id, { status: 'in_progress' });
      if (t.channel === 'email') await d.mailer.send(t.customerEmail, `Re: [${t.number}] ${t.subject}`, text);
    }

    if (from === 'customer') {
      // ลูกค้าตอบใน ticket ที่ปิดแล้ว → เปิดใหม่
      if (isClosed(t.status)) {
        await d.tickets.update(t.id, { status: 'open', resolvedAt: null });
        await d.tickets.addEvent(t.id, 'reopened', 'ลูกค้าตอบกลับ ticket ถูกเปิดใหม่');
      } else if (t.status === 'pending') {
        await d.tickets.update(t.id, { status: 'in_progress' });
      }
      d.notifier.alertAgent(t.assigneeId, {
        type: 'message', ticketId: t.id, text: `${t.number}: ข้อความใหม่จาก ${t.customerName}`,
      });
    }

    const fresh = await load(t.id);
    d.notifier.ticketMessage(fresh, m);
    d.notifier.ticketChanged(fresh, 'updated');
    return m;
  }

  // ---------- Escalate (ใช้ทั้งกดเองและ SLA watcher) ----------
  async function escalateTicket(t: Ticket, reason: string, by: string): Promise<Ticket> {
    const supervisor = await findSupervisor(d);
    const priority: Priority = bumpPriority(t.priority);
    const patch: TicketPatch = {
      escalated: true,
      escalationLevel: t.escalationLevel + 1,
      priority,
      assigneeId: supervisor ? supervisor.id : t.assigneeId,
      slaWarned: false,
      slaResetAt: nowIso(), // เริ่มนับ SLA รอบใหม่ให้ผู้รับเรื่องคนใหม่
    };
    await recomputeDue(t, patch);
    await d.tickets.addEvent(
      t.id, 'escalated',
      `Escalate ระดับ ${patch.escalationLevel} → ${supervisor ? supervisor.name : '-'} (priority: ${priority}) เหตุผล: ${reason}`,
      by
    );
    return load(t.id);
  }

  async function markMessages(ticketId: string, recipient: Side, level: 'delivered' | 'read', onlyIds?: string[]) {
    const t = await d.tickets.find(ticketId);
    if (!t) return;
    const changed = await d.tickets.markMessages(t.id, recipient, level, onlyIds);
    if (changed.length) d.notifier.ticketMessageStatus(t, changed);
  }

  return {
    open,

    // ---- ลูกค้า ----
    async getPublic(id: string): Promise<CustomerTicketView> {
      const t = await d.tickets.find(id);
      if (!t || t.id !== id) throw notFound('ไม่พบ ticket'); // ลูกค้าต้องใช้ uuid (เป็น secret)
      return toCustomerView(t);
    },
    async postFromCustomer(id: string, text: string) {
      const t = await d.tickets.find(id);
      if (!t || t.id !== id) throw notFound('ไม่พบ ticket');
      return post(t, 'customer', { id: t.customerId, name: t.customerName }, text, false);
    },

    /** Email webhook: หัวข้อมี [TK-xxxx] และเป็นอีเมลเจ้าของ → ต่อข้อความเข้า ticket เดิม */
    async inboundEmail(input: { from?: string; name?: string; subject?: string; body?: string }) {
      if (!input.from) throw validation('ต้องมี from');
      const from = input.from.trim().toLowerCase();
      const subject = input.subject ?? '';
      const number = ticketNumberFromSubject(subject);
      const existing = number ? await d.tickets.find(number) : null;
      if (existing && existing.customerEmail === from) {
        await post(existing, 'customer', { id: existing.customerId, name: existing.customerName }, input.body ?? '', false);
        return { ticket: existing.number, appended: true };
      }
      const t = await open({ name: input.name, email: from, subject, message: input.body, channel: 'email' });
      await d.mailer.send(from, `[${t.number}] ได้รับเรื่องของคุณแล้ว`, `เราได้รับเรื่อง "${t.subject}" แล้ว หมายเลข ${t.number}`);
      return { ticket: t.number, appended: false };
    },

    // ---- Agent ----
    list: (filter: TicketFilter) => d.tickets.list(filter),
    get: load,

    async postFromAgent(agent: Agent, id: string, text: string, internal: boolean) {
      return post(await load(id), 'agent', agent, text, internal);
    },

    /** เปลี่ยนสถานะ / priority / ผู้รับผิดชอบ */
    async update(agent: Agent, id: string, body: { status?: unknown; priority?: unknown; assigneeId?: unknown }): Promise<Ticket> {
      const t = await load(id);
      const { status, priority, assigneeId } = body;

      if (status !== undefined && status !== t.status) {
        if (!isStatus(status)) throw validation('สถานะไม่ถูกต้อง');
        await d.tickets.update(t.id, { status, resolvedAt: status === 'resolved' ? nowIso() : t.resolvedAt });
        await d.tickets.addEvent(t.id, 'status', `${t.status} → ${status}`, agent.name);
        if (status === 'resolved' && t.channel === 'email') {
          await d.mailer.send(t.customerEmail, `[${t.number}] เรื่องของคุณได้รับการแก้ไขแล้ว`, 'หากยังพบปัญหา ตอบกลับอีเมลนี้ได้เลย');
        }
      }
      if (priority !== undefined && priority !== t.priority) {
        if (!isPriority(priority)) throw validation('priority ไม่ถูกต้อง');
        await d.tickets.addEvent(t.id, 'priority', `${t.priority} → ${priority}`, agent.name);
        await recomputeDue(t, { priority, slaWarned: false });
      }
      if (assigneeId !== undefined && assigneeId !== t.assigneeId) {
        const target = assigneeId ? await d.agents.get(String(assigneeId)) : null;
        if (assigneeId && !target) throw validation('ไม่พบ agent');
        await d.tickets.update(t.id, { assigneeId: target ? target.id : null });
        await d.tickets.addEvent(t.id, 'assigned', target ? `มอบหมายให้ ${target.name}` : 'ยกเลิกการมอบหมาย', agent.name);
        if (target) {
          d.notifier.alertAgent(target.id, { type: 'assigned', ticketId: t.id, text: `${agent.name} มอบหมาย ${t.number} ให้คุณ` });
        }
      }
      const fresh = await load(t.id);
      d.notifier.ticketChanged(fresh, 'updated');
      return fresh;
    },

    async escalate(agent: Agent, id: string, reason?: string): Promise<Ticket> {
      const t = await escalateTicket(await load(id), reason || 'escalate โดย agent', agent.name);
      d.notifier.alertAgent(t.assigneeId, { type: 'escalated', ticketId: t.id, text: `${t.number} ถูก escalate มาที่คุณ` });
      d.notifier.ticketChanged(t, 'escalated');
      return t;
    },

    // ---- สถานะข้อความ ----
    markDelivered: (ticketId: string, recipient: Side, ids?: string[]) => markMessages(ticketId, recipient, 'delivered', ids),
    markRead: (ticketId: string, recipient: Side) => markMessages(ticketId, recipient, 'read'),

    /** มีสิทธิ์เข้าห้อง ticket ไหม: agent เข้าได้ทุกห้อง ลูกค้าต้องใช้ uuid */
    async resolveForJoin(ticketId: string, asAgent: boolean): Promise<Ticket | null> {
      const t = await d.tickets.find(ticketId);
      if (!t) return null;
      return asAgent || t.id === ticketId ? t : null;
    },

    // ---- SLA watcher เรียกเป็นรอบ ๆ ----
    async checkSla(): Promise<void> {
      const now = d.clock();
      for (const t of await d.tickets.listSlaActive()) {
        const state = slaState(t, now, d.slaUnitMs);
        if (state === 'breached') {
          await d.tickets.addEvent(t.id, 'sla_breached', `ผิด SLA (${t.firstResponseAt ? 'resolution' : 'first response'})`);
          const fresh = await escalateTicket(t, 'SLA breached', 'system');
          d.notifier.ticketChanged(fresh, 'escalated');
          d.notifier.alertAllAgents({ type: 'escalated', ticketId: t.id, text: `⚠️ ${t.number} ผิด SLA และถูก escalate แล้ว` });
        } else if (state === 'warning' && !t.slaWarned) {
          const left = Math.ceil((new Date(t.slaDueAt!).getTime() - now.getTime()) / 60000);
          await d.tickets.update(t.id, { slaWarned: true });
          await d.tickets.addEvent(t.id, 'sla_warning', `ใกล้ผิด SLA เหลือ ${left} นาที`);
          d.notifier.ticketChanged(await load(t.id), 'sla_warning');
          d.notifier.alertAllAgents({ type: 'sla_warning', ticketId: t.id, text: `⏰ ${t.number} ใกล้ผิด SLA` });
        }
      }
    },
  };
}
export type TicketUseCases = ReturnType<typeof makeTicketUseCases>;

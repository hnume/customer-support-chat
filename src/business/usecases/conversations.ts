// ============================================================
// usecases/conversations — Team chat 1:1 และ Group
// ข้อความส่งถึงคนที่ offline ได้: เก็บลง DB แล้ว mark delivered ตอนเขากลับมา online
// ============================================================
import { toConvMessageView, type Conversation, type ConvMessage } from '../models/conversation';
import type { Agent } from '../models/ticket';
import { notFound, validation } from '../models/errors';
import type { Deps } from './deps';

export function makeConversationUseCases(d: Deps) {
  async function names(): Promise<Map<string, string>> {
    return new Map((await d.agents.list()).map((a) => [a.id, a.name]));
  }

  function title(conv: Conversation, forAgentId: string, agentNames: Map<string, string>): string {
    if (conv.type === 'group') return conv.name || 'Group';
    const other = conv.members.find((id) => id !== forAgentId);
    return (other && agentNames.get(other)) || 'Direct';
  }

  async function loadAsMember(agentId: string, convId: string): Promise<Conversation> {
    const conv = await d.conversations.find(convId);
    if (!conv || !conv.members.includes(agentId)) throw notFound('ไม่พบห้องแชท');
    return conv;
  }

  /** แจ้งผู้ส่งว่าข้อความของเขาถูกรับ / อ่านแล้ว */
  function emitStatus(conv: Conversation, changed: ConvMessage[]) {
    for (const m of changed) {
      d.notifier.convStatus(m.senderId, { convId: conv.id, message: toConvMessageView(conv.members, m) });
    }
  }

  async function mark(agentId: string, convId: string, level: 'delivered' | 'read', ids?: string[]) {
    const conv = await d.conversations.find(convId);
    if (!conv || !conv.members.includes(agentId)) return;
    emitStatus(conv, await d.conversations.mark(conv.id, agentId, level, ids));
  }

  return {
    async list(agent: Agent) {
      const agentNames = await names();
      return (await d.conversations.listForAgent(agent.id)).map((c) => ({ ...c, title: title(c, agent.id, agentNames) }));
    },

    /** { type: 'direct', memberIds: ['a2'] } หรือ { type: 'group', name, memberIds: [...] } */
    async create(agent: Agent, body: { type?: unknown; name?: unknown; memberIds?: unknown }) {
      const type = body.type;
      if (type !== 'direct' && type !== 'group') throw validation('type ต้องเป็น direct หรือ group');
      const ids = [...new Set(Array.isArray(body.memberIds) ? body.memberIds.map(String) : [])].filter((id) => id !== agent.id);
      const agentNames = await names();
      if (ids.some((id) => !agentNames.has(id))) throw validation('มีสมาชิกที่ไม่พบในระบบ');
      if (type === 'direct' && ids.length !== 1) throw validation('แชท 1:1 ต้องเลือกคู่สนทนา 1 คน');
      if (type === 'group' && ids.length < 1) throw validation('group ต้องมีสมาชิกอย่างน้อย 1 คน');
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (type === 'group' && !name) throw validation('กรุณาตั้งชื่อ group');

      // 1:1 ที่มีอยู่แล้วให้ใช้ห้องเดิม
      const conv =
        (type === 'direct' && (await d.conversations.findDirect(agent.id, ids[0]))) ||
        (await d.conversations.create({ type, name: type === 'group' ? name : null, createdBy: agent.id, members: [agent.id, ...ids] }));
      d.notifier.convUpdated(conv.members, conv.id);
      return { ...conv, title: title(conv, agent.id, agentNames) };
    },

    /** ประวัติการสนทนา (โหลดย้อนหลังด้วย before + limit) */
    async history(agent: Agent, convId: string, opts: { before?: string; limit?: number }) {
      const conv = await loadAsMember(agent.id, convId);
      const limit = Math.min(Number(opts.limit) || 50, 200);
      const { messages, hasMore } = await d.conversations.messages(conv.id, { before: opts.before, limit });
      const agentNames = await names();
      return {
        id: conv.id,
        type: conv.type,
        title: title(conv, agent.id, agentNames),
        members: conv.members.map((id) => ({ id, name: agentNames.get(id), online: d.presence.isOnline(id) })),
        hasMore,
        messages: messages.map((m) => toConvMessageView(conv.members, m)),
      };
    },

    async send(agent: Agent, convId: string, text: unknown) {
      const body = String(text ?? '').trim();
      if (!body) throw validation('ข้อความว่าง');
      const conv = await loadAsMember(agent.id, convId);
      const m = await d.conversations.addMessage(conv.id, agent, body);
      const view = toConvMessageView(conv.members, m);
      const agentNames = await names();
      for (const id of conv.members) {
        d.notifier.convMessage(id, { convId: conv.id, title: title(conv, id, agentNames), message: view });
      }
      return view;
    },

    async updateMembers(agent: Agent, convId: string, body: { add?: unknown; remove?: unknown }) {
      const conv = await loadAsMember(agent.id, convId);
      if (conv.type !== 'group') throw validation('แก้สมาชิกได้เฉพาะ group');
      const add = Array.isArray(body.add) ? body.add.map(String) : [];
      const remove = Array.isArray(body.remove) ? body.remove.map(String) : [];
      const agentNames = await names();
      if (add.some((id) => !agentNames.has(id))) throw validation('มีสมาชิกที่ไม่พบในระบบ');
      const updated = await d.conversations.updateMembers(conv.id, add, remove);
      d.notifier.convUpdated([...new Set([...conv.members, ...updated.members])], conv.id);
      return { id: updated.id, members: updated.members };
    },

    markDelivered: (agentId: string, convId: string, ids?: string[]) => mark(agentId, convId, 'delivered', ids),
    markRead: (agentId: string, convId: string) => mark(agentId, convId, 'read'),

    /** agent กลับมา online → ข้อความที่ส่งมาตอน offline ถือว่าได้รับแล้ว */
    async deliverPending(agentId: string) {
      for (const convId of await d.conversations.pendingFor(agentId)) await mark(agentId, convId, 'delivered');
    },

    /** สมาชิกคนอื่นในห้อง (ใช้ส่ง typing indicator) */
    async otherMembers(agentId: string, convId: string): Promise<string[]> {
      const conv = await d.conversations.find(convId);
      if (!conv || !conv.members.includes(agentId)) return [];
      return conv.members.filter((id) => id !== agentId);
    },
  };
}
export type ConversationUseCases = ReturnType<typeof makeConversationUseCases>;

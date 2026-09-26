// ============================================================
// SLA Policy + Assignment + Escalation Rules
// ============================================================
const store = require('./store');

// เวลาเป้าหมาย (นาที) ตามระดับความสำคัญ
// ปรับค่าเป็นวินาทีได้ด้วย env SLA_DEMO=1 เพื่อทดสอบ escalate เร็ว ๆ
const DEMO = process.env.SLA_DEMO === '1';
const UNIT_MS = DEMO ? 1000 : 60 * 1000;

const SLA_POLICY = {
  //         ตอบครั้งแรก    แก้ไขเสร็จ
  urgent: { firstResponse: 15,  resolution: 240 },
  high:   { firstResponse: 60,  resolution: 480 },
  normal: { firstResponse: 240, resolution: 1440 },
  low:    { firstResponse: 1440, resolution: 4320 },
};

const WARN_RATIO = 0.2; // เตือนเมื่อเหลือเวลา < 20%
const PRIORITY_ORDER = ['low', 'normal', 'high', 'urgent'];

function computeDue(ticket) {
  const p = SLA_POLICY[ticket.priority] || SLA_POLICY.normal;
  let base = ticket.firstResponseAt ? ticket.firstResponseAt : ticket.createdAt;
  // หลัง escalate ให้เริ่มนับ SLA รอบใหม่ให้ผู้รับเรื่องคนใหม่
  if (ticket.slaResetAt && ticket.slaResetAt > base) base = ticket.slaResetAt;
  const mins = ticket.firstResponseAt ? p.resolution : p.firstResponse;
  return new Date(new Date(base).getTime() + mins * UNIT_MS).toISOString();
}

function slaTotalMs(ticket) {
  const p = SLA_POLICY[ticket.priority] || SLA_POLICY.normal;
  return (ticket.firstResponseAt ? p.resolution : p.firstResponse) * UNIT_MS;
}

// ---------- Auto Assign: เลือก agent ที่ online และงานน้อยที่สุด ----------
function pickAgent(onlineAgentIds, { role = 'agent' } = {}) {
  const candidates = store.getAgents().filter(
    (a) => a.role === role && (onlineAgentIds.size === 0 || onlineAgentIds.has(a.id))
  );
  if (!candidates.length) return null;
  const load = (id) =>
    store.allTickets().filter(
      (t) => t.assigneeId === id && !['resolved', 'closed'].includes(t.status)
    ).length;
  return candidates.sort((a, b) => load(a.id) - load(b.id))[0];
}

// ---------- Escalation ----------
function escalate(ticket, reason, by = 'system') {
  const supervisor = store.getAgents().find((a) => a.role === 'supervisor');
  const idx = PRIORITY_ORDER.indexOf(ticket.priority);
  const newPriority = PRIORITY_ORDER[Math.min(idx + 1, PRIORITY_ORDER.length - 1)];
  store.updateTicket(ticket, {
    escalated: true,
    escalationLevel: ticket.escalationLevel + 1,
    priority: newPriority,
    assigneeId: supervisor ? supervisor.id : ticket.assigneeId,
    slaWarned: false,
    slaResetAt: new Date().toISOString(),
  });
  store.updateTicket(ticket, { slaDueAt: computeDue(ticket) });
  store.addEvent(
    ticket,
    'escalated',
    `Escalate ระดับ ${ticket.escalationLevel} → ${supervisor ? supervisor.name : '-'} (priority: ${newPriority}) เหตุผล: ${reason}`,
    by
  );
  return ticket;
}

// ---------- SLA Watcher: รันทุก ๆ N วินาที ----------
// onChange(ticket, kind) ถูกเรียกเมื่อมีการเตือน/escalate เพื่อให้ server แจ้ง realtime
function startWatcher(onChange, intervalMs = DEMO ? 2000 : 30000) {
  return setInterval(() => {
    const nowMs = Date.now();
    for (const t of store.allTickets()) {
      if (['resolved', 'closed', 'pending'].includes(t.status) || !t.slaDueAt) continue;
      const remaining = new Date(t.slaDueAt).getTime() - nowMs;

      if (remaining <= 0) {
        store.addEvent(t, 'sla_breached', `ผิด SLA (${t.firstResponseAt ? 'resolution' : 'first response'})`);
        escalate(t, 'SLA breached');
        onChange(t, 'escalated');
      } else if (!t.slaWarned && remaining < slaTotalMs(t) * WARN_RATIO) {
        store.updateTicket(t, { slaWarned: true });
        store.addEvent(t, 'sla_warning', `ใกล้ผิด SLA เหลือ ${Math.ceil(remaining / 60000)} นาที`);
        onChange(t, 'sla_warning');
      }
    }
  }, intervalMs);
}

module.exports = { SLA_POLICY, DEMO, computeDue, pickAgent, escalate, startWatcher };

// ============================================================
// Data Store — เก็บข้อมูลเป็นไฟล์ JSON (data/db.json)
// เปลี่ยนเป็น PostgreSQL / MongoDB ได้โดยแก้เฉพาะไฟล์นี้
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const defaultData = () => ({
  seq: 1000,
  agents: [
    { id: 'a1', name: 'สมชาย (Agent)',   role: 'agent',      team: 'L1' },
    { id: 'a2', name: 'สมหญิง (Agent)',  role: 'agent',      team: 'L1' },
    { id: 'a3', name: 'วิชัย (Agent)',    role: 'agent',      team: 'L1' },
    { id: 's1', name: 'หัวหน้าทีม (Supervisor)', role: 'supervisor', team: 'L2' },
  ],
  customers: [],
  tickets: [],
  conversations: [], // Team chat: 1:1 (direct) และ group ระหว่าง agent
});

let db = defaultData();
let saveTimer = null;

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = { ...defaultData(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
    }
  } catch (e) {
    console.error('[store] โหลดข้อมูลไม่สำเร็จ ใช้ค่าเริ่มต้นแทน:', e.message);
  }
}

// เขียนไฟล์แบบ debounce เพื่อไม่ให้เขียนถี่เกินไป
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }, 200);
}

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ---------- Customers ----------
function upsertCustomer({ name, email }) {
  email = String(email || '').trim().toLowerCase();
  let c = db.customers.find((x) => x.email === email);
  if (!c) {
    c = { id: uid(), name: name || email, email, createdAt: now() };
    db.customers.push(c);
  } else if (name) {
    c.name = name;
  }
  save();
  return c;
}

// ---------- Agents ----------
const getAgents = () => db.agents;
const getAgent = (id) => db.agents.find((a) => a.id === id);

// ---------- Tickets ----------
function createTicket({ customer, subject, channel, priority, category }) {
  const t = {
    id: uid(),
    number: `TK-${++db.seq}`,
    subject: subject || '(ไม่มีหัวข้อ)',
    category: category || 'general',
    channel: channel || 'web',          // web | mobile | email | chat
    priority: priority || 'normal',     // low | normal | high | urgent
    status: 'open',                     // open | in_progress | pending | resolved | closed
    customerId: customer.id,
    customerName: customer.name,
    customerEmail: customer.email,
    assigneeId: null,
    escalated: false,
    escalationLevel: 0,
    slaWarned: false,
    createdAt: now(),
    updatedAt: now(),
    firstResponseAt: null,
    resolvedAt: null,
    slaDueAt: null,
    messages: [],
    events: [],
  };
  db.tickets.push(t);
  save();
  return t;
}

const getTicket = (id) => db.tickets.find((t) => t.id === id || t.number === id);

function listTickets(filter = {}) {
  return db.tickets
    .filter((t) => !filter.status || t.status === filter.status)
    .filter((t) => !filter.assigneeId || t.assigneeId === filter.assigneeId)
    .filter((t) => !filter.customerId || t.customerId === filter.customerId)
    .filter((t) => {
      if (!filter.q) return true;
      const q = filter.q.toLowerCase();
      return [t.number, t.subject, t.customerName, t.customerEmail]
        .some((v) => String(v).toLowerCase().includes(q));
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// ข้อความมีสถานะ sent → delivered → read
function addMessage(ticket, { from, senderId, senderName, text, internal = false }) {
  const m = {
    id: uid(), from, senderId, senderName, text, internal, at: now(),
    status: 'sent', deliveredAt: null, readAt: null,
  };
  ticket.messages.push(m);
  ticket.updatedAt = m.at;
  save();
  return m;
}

// ผู้รับฝั่ง recipientSide ('customer' | 'agent') ได้รับ/อ่านข้อความแล้ว
// คืนค่ารายการข้อความที่สถานะเปลี่ยน เพื่อแจ้งผู้ส่งแบบ realtime
function markTicketMessages(ticket, recipientSide, level, onlyIds = null) {
  const ts = now();
  const changed = [];
  for (const m of ticket.messages) {
    if (m.internal || m.from === recipientSide) continue;
    if (onlyIds && !onlyIds.includes(m.id)) continue;
    if (!m.deliveredAt) { m.deliveredAt = ts; m.status = 'delivered'; changed.push(m); }
    if (level === 'read' && !m.readAt) {
      m.readAt = ts; m.status = 'read';
      if (!changed.includes(m)) changed.push(m);
    }
  }
  if (changed.length) save();
  return changed;
}

function addEvent(ticket, type, detail, by = 'system') {
  const e = { id: uid(), type, detail, by, at: now() };
  ticket.events.push(e);
  ticket.updatedAt = e.at;
  save();
  return e;
}

function updateTicket(ticket, patch) {
  Object.assign(ticket, patch, { updatedAt: now() });
  save();
  return ticket;
}

const allTickets = () => db.tickets;

// ============================================================
// Team Chat — 1:1 และ Group chat (ส่งถึงคนที่ offline ได้)
// แต่ละข้อความเก็บ deliveredTo / readBy แยกรายคน
// ============================================================
function convMessageStatus(conv, m) {
  const others = conv.members.filter((id) => id !== m.senderId);
  if (!others.length) return 'read';
  if (others.every((id) => m.readBy[id])) return 'read';
  if (others.every((id) => m.deliveredTo[id])) return 'delivered';
  return 'sent';
}

function listConversations(agentId) {
  return db.conversations
    .filter((c) => c.members.includes(agentId))
    .map((c) => {
      const last = c.messages[c.messages.length - 1] || null;
      return {
        id: c.id, type: c.type, name: c.name, members: c.members, createdAt: c.createdAt,
        updatedAt: last ? last.at : c.createdAt,
        lastMessage: last ? { text: last.text, senderName: last.senderName, at: last.at } : null,
        unread: c.messages.filter((m) => m.senderId !== agentId && !m.readBy[agentId]).length,
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

const getConversation = (id) => db.conversations.find((c) => c.id === id);

function createConversation({ type, name, memberIds, createdBy }) {
  const members = [...new Set([createdBy, ...memberIds])];
  if (type === 'direct') {
    // 1:1 ต้องมี 2 คนเท่านั้น และถ้ามีอยู่แล้วให้ใช้ห้องเดิม
    const existing = db.conversations.find(
      (c) => c.type === 'direct' && c.members.length === 2 && members.every((id) => c.members.includes(id))
    );
    if (existing) return existing;
  }
  const c = { id: uid(), type, name: name || null, members, createdBy, createdAt: now(), messages: [] };
  db.conversations.push(c);
  save();
  return c;
}

function updateMembers(conv, { add = [], remove = [] }) {
  conv.members = [...new Set([...conv.members, ...add])].filter((id) => !remove.includes(id));
  save();
  return conv;
}

function addConvMessage(conv, { senderId, senderName, text }) {
  const at = now();
  const m = {
    id: uid(), senderId, senderName, text, at,
    deliveredTo: { [senderId]: at }, readBy: { [senderId]: at },
  };
  conv.messages.push(m);
  save();
  return m;
}

// agentId ได้รับ / อ่านข้อความแล้ว → คืนรายการข้อความที่เปลี่ยน
function markConv(conv, agentId, level, onlyIds = null) {
  const ts = now();
  const changed = [];
  for (const m of conv.messages) {
    if (m.senderId === agentId) continue;
    if (onlyIds && !onlyIds.includes(m.id)) continue;
    let touched = false;
    if (!m.deliveredTo[agentId]) { m.deliveredTo[agentId] = ts; touched = true; }
    if (level === 'read' && !m.readBy[agentId]) { m.readBy[agentId] = ts; touched = true; }
    if (touched) changed.push(m);
  }
  if (changed.length) save();
  return changed;
}

// ข้อความค้างส่งทั้งหมดของ agent (ใช้ตอนกลับมา online)
function pendingConvFor(agentId) {
  return db.conversations
    .filter((c) => c.members.includes(agentId))
    .filter((c) => c.messages.some((m) => m.senderId !== agentId && !m.deliveredTo[agentId]));
}

// ข้อมูลภาพรวมสำหรับ dashboard / analytics
function stats() {
  const t = db.tickets;
  const by = (k) => t.reduce((acc, x) => ((acc[x[k]] = (acc[x[k]] || 0) + 1), acc), {});
  const responded = t.filter((x) => x.firstResponseAt);
  const avgFirstResponseMin = responded.length
    ? responded.reduce((s, x) => s + (new Date(x.firstResponseAt) - new Date(x.createdAt)), 0) /
      responded.length / 60000
    : 0;
  const breached = t.filter((x) => x.events.some((e) => e.type === 'sla_breached')).length;

  // ---- Messaging metrics (ตอบ Business questions) ----
  const msgs = [
    ...t.flatMap((x) => x.messages.filter((m) => !m.internal)
      .map((m) => ({ at: m.at, delivered: m.deliveredAt ? [m.deliveredAt] : [], read: m.readAt ? [m.readAt] : [], expected: 1 }))),
    ...db.conversations.flatMap((c) => c.messages.map((m) => ({
      at: m.at,
      delivered: Object.entries(m.deliveredTo).filter(([id]) => id !== m.senderId).map(([, v]) => v),
      read: Object.entries(m.readBy).filter(([id]) => id !== m.senderId).map(([, v]) => v),
      expected: Math.max(c.members.length - 1, 1),
    }))),
  ];
  const diffs = (key) => msgs.flatMap((m) => m[key].map((v) => new Date(v) - new Date(m.at)));
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const today = new Date().toISOString().slice(0, 10);
  const perDay = msgs.reduce((acc, m) => ((acc[m.at.slice(0, 10)] = (acc[m.at.slice(0, 10)] || 0) + 1), acc), {});
  const undelivered = msgs.filter((m) => m.delivered.length < m.expected).length;
  const messaging = {
    totalMessages: msgs.length,
    messagesToday: perDay[today] || 0,
    messagesPerDay: perDay,
    avgDeliveryLatencySec: Math.round(avg(diffs('delivered')) / 100) / 10,
    avgTimeToReadSec: Math.round(avg(diffs('read')) / 100) / 10,
    pendingDelivery: undelivered,
    deliveredRate: msgs.length ? Math.round(((msgs.length - undelivered) / msgs.length) * 100) : 100,
    activeConversations: db.conversations.filter((c) => c.messages.some((m) => m.at.startsWith(today))).length,
  };

  return {
    messaging,
    total: t.length,
    byStatus: by('status'),
    byChannel: by('channel'),
    byPriority: by('priority'),
    escalated: t.filter((x) => x.escalated).length,
    slaBreached: breached,
    slaComplianceRate: t.length ? Math.round(((t.length - breached) / t.length) * 100) : 100,
    avgFirstResponseMin: Math.round(avgFirstResponseMin * 10) / 10,
    agentLoad: db.agents.map((a) => ({
      id: a.id,
      name: a.name,
      open: t.filter((x) => x.assigneeId === a.id && !['resolved', 'closed'].includes(x.status)).length,
    })),
  };
}

load();

module.exports = {
  upsertCustomer, getAgents, getAgent,
  createTicket, getTicket, listTickets, addMessage, markTicketMessages, addEvent, updateTicket, allTickets,
  listConversations, getConversation, createConversation, updateMembers, addConvMessage, markConv,
  convMessageStatus, pendingConvFor,
  stats,
};

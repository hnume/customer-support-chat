// ============================================================
// Customer Support Chat System — Server
// Express (REST API) + Socket.IO (Realtime chat / notification)
//
//  Customer ──(Web / Mobile / Email / Chat)──► Support Channel
//        ──► Ticket Management ──► Auto Assign ──► Agent
//        ──► Agent ตอบ / เปลี่ยนสถานะ / assign / escalate
//        ──► SLA Watcher ──► เตือน / escalate อัตโนมัติ
//
//  Messaging: สถานะ sent / delivered / read, ส่งตอนอีกฝ่าย offline ได้,
//             ประวัติการสนทนา, Team chat แบบ 1:1 และ Group
// ============================================================
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const store = require('./src/store');
const sla = require('./src/sla');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const STATUSES = ['open', 'in_progress', 'pending', 'resolved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const CHANNELS = ['web', 'mobile', 'email', 'chat'];

// agentId -> จำนวน socket ที่เชื่อมต่อ (ใช้ดูว่าใคร online)
const onlineAgents = new Map();
const onlineSet = () => new Set([...onlineAgents.keys()]);

// ---------- Helpers ----------
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ลูกค้าต้องไม่เห็น internal note และ event ภายใน
function forCustomer(t) {
  const agent = t.assigneeId ? store.getAgent(t.assigneeId) : null;
  return {
    id: t.id, number: t.number, subject: t.subject, status: t.status,
    priority: t.priority, channel: t.channel, createdAt: t.createdAt,
    agentName: agent ? agent.name : null,
    messages: t.messages.filter((m) => !m.internal),
  };
}

function withAssignee(t) {
  const a = t.assigneeId ? store.getAgent(t.assigneeId) : null;
  return { ...t, assigneeName: a ? a.name : null };
}

function broadcastTicket(t, kind = 'updated') {
  io.to('agents').emit('ticket:updated', { kind, ticket: withAssignee(t) });
  io.to(`ticket:${t.id}:customer`).emit('ticket:status', forCustomer(t));
}

function notifyAgent(agentId, payload) {
  if (agentId) io.to(`agent:${agentId}`).emit('notify', payload);
}

// จำลองการส่งอีเมลออก (ต่อ SMTP / SendGrid จริงได้ที่นี่)
function sendEmail(to, subject, body) {
  console.log(`[email-out] to=${to} subject="${subject}"\n${body}\n`);
}

function postMessage(t, { from, senderId, senderName, text, internal }) {
  const m = store.addMessage(t, { from, senderId, senderName, text, internal });

  if (from === 'agent' && !internal) {
    if (!t.firstResponseAt) {
      store.updateTicket(t, { firstResponseAt: m.at });
      store.updateTicket(t, { slaDueAt: sla.computeDue(t), slaWarned: false });
      store.addEvent(t, 'first_response', `ตอบกลับครั้งแรกโดย ${senderName}`, senderId);
    }
    if (t.status === 'open') store.updateTicket(t, { status: 'in_progress' });
    if (t.channel === 'email') sendEmail(t.customerEmail, `Re: [${t.number}] ${t.subject}`, text);
  }

  if (from === 'customer') {
    // ลูกค้าตอบกลับมาใน ticket ที่ปิดไปแล้ว → เปิดใหม่อัตโนมัติ
    if (['resolved', 'closed'].includes(t.status)) {
      store.updateTicket(t, { status: 'open', resolvedAt: null });
      store.addEvent(t, 'reopened', 'ลูกค้าตอบกลับ ticket ถูกเปิดใหม่');
    }
    if (t.status === 'pending') store.updateTicket(t, { status: 'in_progress' });
    notifyAgent(t.assigneeId, {
      type: 'message', ticketId: t.id,
      text: `${t.number}: ข้อความใหม่จาก ${t.customerName}`,
    });
  }

  // ส่งถึงผู้รับแบบ realtime (Socket.IO รวมห้องและไม่ส่งซ้ำ socket เดียวกัน)
  const agentRooms = [`ticket:${t.id}:agents`];
  if (from === 'customer' && t.assigneeId) agentRooms.push(`agent:${t.assigneeId}`);
  io.to(agentRooms).emit('message:new', { ticketId: t.id, message: m });
  if (!internal) io.to(`ticket:${t.id}:customer`).emit('message:new', { ticketId: t.id, message: m });
  broadcastTicket(t);
  return m;
}

// แจ้งผู้ส่งว่าข้อความเปลี่ยนสถานะ (delivered / read)
function emitTicketStatus(t, changed) {
  if (!changed.length) return;
  const updates = changed.map((m) => ({ id: m.id, status: m.status, deliveredAt: m.deliveredAt, readAt: m.readAt }));
  const rooms = [`ticket:${t.id}:agents`, `ticket:${t.id}:customer`];
  if (t.assigneeId) rooms.push(`agent:${t.assigneeId}`);
  io.to(rooms).emit('message:status', { ticketId: t.id, updates });
}

// ---------- Team chat helpers ----------
function convMsgView(conv, m) {
  const others = conv.members.filter((id) => id !== m.senderId);
  return {
    id: m.id, senderId: m.senderId, senderName: m.senderName, text: m.text, at: m.at,
    status: store.convMessageStatus(conv, m),
    deliveredCount: others.filter((id) => m.deliveredTo[id]).length,
    readCount: others.filter((id) => m.readBy[id]).length,
    recipients: others.length,
  };
}

function convTitle(conv, forAgentId) {
  if (conv.type === 'group') return conv.name || 'Group';
  const other = conv.members.find((id) => id !== forAgentId);
  return store.getAgent(other)?.name || 'Direct';
}

function emitConvStatus(conv, changed) {
  for (const m of changed) {
    io.to(`agent:${m.senderId}`).emit('conv:status', { convId: conv.id, message: convMsgView(conv, m) });
  }
}

// agent กลับมา online → ส่งข้อความที่ค้างอยู่ (offline delivery) และแจ้งผู้ส่งว่า delivered
function deliverPending(agentId) {
  for (const conv of store.pendingConvFor(agentId)) {
    emitConvStatus(conv, store.markConv(conv, agentId, 'delivered'));
  }
}

function openTicket({ name, email, subject, message, priority, category, channel }) {
  const customer = store.upsertCustomer({ name, email });
  const t = store.createTicket({
    customer, subject,
    channel: CHANNELS.includes(channel) ? channel : 'web',
    priority: PRIORITIES.includes(priority) ? priority : 'normal',
    category,
  });
  store.addEvent(t, 'created', `สร้าง ticket ผ่านช่องทาง ${t.channel}`);
  store.updateTicket(t, { slaDueAt: sla.computeDue(t) });

  const agent = sla.pickAgent(onlineSet());
  if (agent) {
    store.updateTicket(t, { assigneeId: agent.id });
    store.addEvent(t, 'assigned', `Auto-assign ให้ ${agent.name}`);
    notifyAgent(agent.id, { type: 'assigned', ticketId: t.id, text: `ได้รับ ticket ใหม่ ${t.number}: ${t.subject}` });
  }
  if (message) {
    store.addMessage(t, { from: 'customer', senderId: customer.id, senderName: customer.name, text: message });
  }
  io.to('agents').emit('ticket:updated', { kind: 'new', ticket: withAssignee(t) });
  return t;
}

// ============================================================
// REST API
// ============================================================
app.get('/api/agents', (req, res) =>
  res.json(store.getAgents().map((a) => ({ ...a, online: onlineAgents.has(a.id) })))
);

app.get('/api/sla-policy', (req, res) => res.json({ policy: sla.SLA_POLICY, demoMode: sla.DEMO }));

app.get('/api/stats', (req, res) => res.json(store.stats()));

// ลูกค้าแจ้งปัญหา (Web / Mobile / Chat)
app.post('/api/tickets', (req, res) => {
  const { name, email, subject, message } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return bad(res, 'กรุณาระบุอีเมลให้ถูกต้อง');
  if (!subject && !message) return bad(res, 'กรุณาระบุหัวข้อหรือรายละเอียดปัญหา');
  const t = openTicket({ ...req.body, name: name || email });
  res.status(201).json(forCustomer(t));
});

// Email webhook — เชื่อมกับ SendGrid Inbound Parse / Mailgun Routes ได้
// ถ้าหัวข้อมี [TK-xxxx] จะต่อข้อความเข้า ticket เดิม
app.post('/api/inbound/email', (req, res) => {
  const { from, name, subject = '', body = '' } = req.body || {};
  if (!from) return bad(res, 'ต้องมี from');
  const match = subject.match(/\[(TK-\d+)\]/);
  const existing = match && store.getTicket(match[1]);
  if (existing && existing.customerEmail === String(from).toLowerCase()) {
    postMessage(existing, { from: 'customer', senderId: existing.customerId, senderName: existing.customerName, text: body });
    return res.json({ ticket: existing.number, appended: true });
  }
  const t = openTicket({ name, email: from, subject, message: body, channel: 'email' });
  sendEmail(from, `[${t.number}] ได้รับเรื่องของคุณแล้ว`, `เราได้รับเรื่อง "${t.subject}" แล้ว หมายเลข ${t.number}`);
  res.status(201).json({ ticket: t.number, appended: false });
});

// ลูกค้าดู ticket ของตัวเอง (ใช้ id แบบ UUID เป็น secret)
app.get('/api/public/tickets/:id', (req, res) => {
  const t = store.getTicket(req.params.id);
  if (!t || t.id !== req.params.id) return bad(res, 'ไม่พบ ticket', 404);
  res.json(forCustomer(t));
});

app.post('/api/public/tickets/:id/messages', (req, res) => {
  const t = store.getTicket(req.params.id);
  if (!t || t.id !== req.params.id) return bad(res, 'ไม่พบ ticket', 404);
  const text = String(req.body?.text || '').trim();
  if (!text) return bad(res, 'ข้อความว่าง');
  res.status(201).json(postMessage(t, { from: 'customer', senderId: t.customerId, senderName: t.customerName, text }));
});

// ---------- Agent API ----------
// (เดโม: ระบุตัว agent ด้วย header x-agent-id — production ควรใช้ JWT / Keycloak)
function requireAgent(req, res, next) {
  const agent = store.getAgent(req.header('x-agent-id'));
  if (!agent) return bad(res, 'ต้องเข้าสู่ระบบในฐานะ agent', 401);
  req.agent = agent;
  next();
}

app.get('/api/tickets', requireAgent, (req, res) => {
  const { status, assigneeId, q } = req.query;
  res.json(store.listTickets({ status, assigneeId, q }).map(withAssignee));
});

app.get('/api/tickets/:id', requireAgent, (req, res) => {
  const t = store.getTicket(req.params.id);
  if (!t) return bad(res, 'ไม่พบ ticket', 404);
  res.json(withAssignee(t));
});

app.post('/api/tickets/:id/messages', requireAgent, (req, res) => {
  const t = store.getTicket(req.params.id);
  if (!t) return bad(res, 'ไม่พบ ticket', 404);
  const text = String(req.body?.text || '').trim();
  if (!text) return bad(res, 'ข้อความว่าง');
  res.status(201).json(postMessage(t, {
    from: 'agent', senderId: req.agent.id, senderName: req.agent.name,
    text, internal: !!req.body.internal,
  }));
});

// เปลี่ยนสถานะ / priority / assign
app.patch('/api/tickets/:id', requireAgent, (req, res) => {
  const t = store.getTicket(req.params.id);
  if (!t) return bad(res, 'ไม่พบ ticket', 404);
  const { status, priority, assigneeId } = req.body || {};
  const by = req.agent;

  if (status && status !== t.status) {
    if (!STATUSES.includes(status)) return bad(res, 'สถานะไม่ถูกต้อง');
    const old = t.status;
    store.updateTicket(t, { status, resolvedAt: status === 'resolved' ? new Date().toISOString() : t.resolvedAt });
    store.addEvent(t, 'status', `${old} → ${status}`, by.name);
    if (status === 'resolved' && t.channel === 'email') {
      sendEmail(t.customerEmail, `[${t.number}] เรื่องของคุณได้รับการแก้ไขแล้ว`, 'หากยังพบปัญหา ตอบกลับอีเมลนี้ได้เลย');
    }
  }
  if (priority && priority !== t.priority) {
    if (!PRIORITIES.includes(priority)) return bad(res, 'priority ไม่ถูกต้อง');
    store.addEvent(t, 'priority', `${t.priority} → ${priority}`, by.name);
    store.updateTicket(t, { priority, slaWarned: false });
    store.updateTicket(t, { slaDueAt: sla.computeDue(t) });
  }
  if (assigneeId !== undefined && assigneeId !== t.assigneeId) {
    const target = assigneeId ? store.getAgent(assigneeId) : null;
    if (assigneeId && !target) return bad(res, 'ไม่พบ agent');
    store.updateTicket(t, { assigneeId: target ? target.id : null });
    store.addEvent(t, 'assigned', target ? `มอบหมายให้ ${target.name}` : 'ยกเลิกการมอบหมาย', by.name);
    if (target) notifyAgent(target.id, { type: 'assigned', ticketId: t.id, text: `${by.name} มอบหมาย ${t.number} ให้คุณ` });
  }
  broadcastTicket(t);
  res.json(withAssignee(t));
});

app.post('/api/tickets/:id/escalate', requireAgent, (req, res) => {
  const t = store.getTicket(req.params.id);
  if (!t) return bad(res, 'ไม่พบ ticket', 404);
  sla.escalate(t, req.body?.reason || 'escalate โดย agent', req.agent.name);
  notifyAgent(t.assigneeId, { type: 'escalated', ticketId: t.id, text: `${t.number} ถูก escalate มาที่คุณ` });
  broadcastTicket(t, 'escalated');
  res.json(withAssignee(t));
});

// ============================================================
// Team Chat API — 1:1 และ Group chat ระหว่าง agent
// ============================================================
function requireMember(req, res, next) {
  const conv = store.getConversation(req.params.id);
  if (!conv || !conv.members.includes(req.agent.id)) return bad(res, 'ไม่พบห้องแชท', 404);
  req.conv = conv;
  next();
}

app.get('/api/conversations', requireAgent, (req, res) => {
  res.json(store.listConversations(req.agent.id).map((c) => ({ ...c, title: convTitle(c, req.agent.id) })));
});

// สร้างห้อง: { type: 'direct', memberIds: ['a2'] } หรือ { type: 'group', name, memberIds: [...] }
app.post('/api/conversations', requireAgent, (req, res) => {
  const { type, name, memberIds = [] } = req.body || {};
  if (!['direct', 'group'].includes(type)) return bad(res, 'type ต้องเป็น direct หรือ group');
  const ids = [...new Set(memberIds)].filter((id) => id !== req.agent.id);
  if (ids.some((id) => !store.getAgent(id))) return bad(res, 'มีสมาชิกที่ไม่พบในระบบ');
  if (type === 'direct' && ids.length !== 1) return bad(res, 'แชท 1:1 ต้องเลือกคู่สนทนา 1 คน');
  if (type === 'group' && ids.length < 1) return bad(res, 'group ต้องมีสมาชิกอย่างน้อย 1 คน');
  if (type === 'group' && !String(name || '').trim()) return bad(res, 'กรุณาตั้งชื่อ group');
  const conv = store.createConversation({ type, name: name && name.trim(), memberIds: ids, createdBy: req.agent.id });
  conv.members.forEach((id) => io.to(`agent:${id}`).emit('conv:updated', { convId: conv.id }));
  res.status(201).json({ ...conv, messages: undefined, title: convTitle(conv, req.agent.id) });
});

// ประวัติการสนทนา (รองรับ ?before=<ISO>&limit=50 สำหรับโหลดย้อนหลัง)
app.get('/api/conversations/:id/messages', requireAgent, requireMember, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  let list = req.conv.messages;
  if (req.query.before) list = list.filter((m) => m.at < req.query.before);
  res.json({
    id: req.conv.id, type: req.conv.type, title: convTitle(req.conv, req.agent.id),
    members: req.conv.members.map((id) => ({ id, name: store.getAgent(id)?.name, online: onlineAgents.has(id) })),
    hasMore: list.length > limit,
    messages: list.slice(-limit).map((m) => convMsgView(req.conv, m)),
  });
});

app.post('/api/conversations/:id/messages', requireAgent, requireMember, (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return bad(res, 'ข้อความว่าง');
  const conv = req.conv;
  const m = store.addConvMessage(conv, { senderId: req.agent.id, senderName: req.agent.name, text });
  // ส่ง realtime ให้สมาชิกที่ online / คนที่ offline จะได้รับตอนกลับมา (deliverPending)
  conv.members.forEach((id) =>
    io.to(`agent:${id}`).emit('conv:message', { convId: conv.id, title: convTitle(conv, id), message: convMsgView(conv, m) })
  );
  res.status(201).json(convMsgView(conv, m));
});

// เพิ่ม / ลบสมาชิก group
app.post('/api/conversations/:id/members', requireAgent, requireMember, (req, res) => {
  if (req.conv.type !== 'group') return bad(res, 'แก้สมาชิกได้เฉพาะ group');
  const { add = [], remove = [] } = req.body || {};
  if (add.some((id) => !store.getAgent(id))) return bad(res, 'มีสมาชิกที่ไม่พบในระบบ');
  const before = [...req.conv.members];
  store.updateMembers(req.conv, { add, remove });
  [...new Set([...before, ...req.conv.members])].forEach((id) =>
    io.to(`agent:${id}`).emit('conv:updated', { convId: req.conv.id })
  );
  res.json({ id: req.conv.id, members: req.conv.members });
});

// ============================================================
// Socket.IO — realtime
// ============================================================
io.on('connection', (socket) => {
  // Agent เข้าสู่ระบบ
  socket.on('agent:online', ({ agentId }) => {
    if (!store.getAgent(agentId)) return;
    socket.data.agentId = agentId;
    socket.join('agents');
    socket.join(`agent:${agentId}`);
    onlineAgents.set(agentId, (onlineAgents.get(agentId) || 0) + 1);
    io.to('agents').emit('agents:presence', [...onlineAgents.keys()]);
    deliverPending(agentId); // ข้อความที่ส่งมาตอน offline → delivered
  });

  // เข้าห้องแชทของ ticket
  socket.on('ticket:join', ({ ticketId }) => {
    const t = store.getTicket(ticketId);
    if (!t) return;
    for (const r of socket.rooms) if (r.startsWith('ticket:')) socket.leave(r);
    if (socket.data.agentId) {
      socket.join(`ticket:${t.id}:agents`);
    } else if (ticketId === t.id) {
      socket.join(`ticket:${t.id}:customer`);
    } else return;
    socket.join(`ticket:${t.id}`);
    // เปิดห้อง = ได้รับข้อความที่ค้างอยู่ทั้งหมด
    emitTicketStatus(t, store.markTicketMessages(t, sideOf(socket), 'delivered'));
  });

  // ---------- สถานะข้อความ ticket: delivered / read ----------
  const sideOf = (s) => (s.data.agentId ? 'agent' : 'customer');
  const canAccessTicket = (t) =>
    socket.data.agentId || socket.rooms.has(`ticket:${t.id}:customer`);

  socket.on('message:ack', ({ ticketId, messageIds }) => {
    const t = store.getTicket(ticketId);
    if (!t || !canAccessTicket(t)) return;
    emitTicketStatus(t, store.markTicketMessages(t, sideOf(socket), 'delivered', messageIds));
  });

  socket.on('ticket:read', ({ ticketId }) => {
    const t = store.getTicket(ticketId);
    if (!t || !canAccessTicket(t)) return;
    emitTicketStatus(t, store.markTicketMessages(t, sideOf(socket), 'read'));
  });

  // ---------- Team chat: ack / read / typing ----------
  const memberConv = (convId) => {
    const c = store.getConversation(convId);
    return c && socket.data.agentId && c.members.includes(socket.data.agentId) ? c : null;
  };
  socket.on('conv:ack', ({ convId, messageIds }) => {
    const c = memberConv(convId);
    if (c) emitConvStatus(c, store.markConv(c, socket.data.agentId, 'delivered', messageIds));
  });
  socket.on('conv:read', ({ convId }) => {
    const c = memberConv(convId);
    if (c) emitConvStatus(c, store.markConv(c, socket.data.agentId, 'read'));
  });
  socket.on('conv:typing', ({ convId, isTyping }) => {
    const c = memberConv(convId);
    if (!c) return;
    const name = store.getAgent(socket.data.agentId).name;
    c.members.filter((id) => id !== socket.data.agentId)
      .forEach((id) => io.to(`agent:${id}`).emit('conv:typing', { convId, name, isTyping }));
  });

  // typing indicator
  socket.on('typing', ({ ticketId, name, isTyping }) => {
    socket.to(`ticket:${ticketId}`).emit('typing', { ticketId, name, isTyping });
  });

  socket.on('disconnect', () => {
    const id = socket.data.agentId;
    if (!id) return;
    const n = (onlineAgents.get(id) || 1) - 1;
    n <= 0 ? onlineAgents.delete(id) : onlineAgents.set(id, n);
    io.to('agents').emit('agents:presence', [...onlineAgents.keys()]);
  });
});

// SLA watcher → แจ้งเตือน realtime
sla.startWatcher((t, kind) => {
  broadcastTicket(t, kind);
  const text = kind === 'escalated'
    ? `⚠️ ${t.number} ผิด SLA และถูก escalate แล้ว`
    : `⏰ ${t.number} ใกล้ผิด SLA`;
  io.to('agents').emit('notify', { type: kind, ticketId: t.id, text }); // แจ้งทุก agent
});

server.listen(PORT, () => {
  console.log(`\n🚀 Support Chat System พร้อมใช้งาน`);
  console.log(`   ลูกค้า : http://localhost:${PORT}/`);
  console.log(`   Agent  : http://localhost:${PORT}/agent.html`);
  console.log(`   SLA demo mode: ${sla.DEMO ? 'ON (นาที → วินาที)' : 'OFF'}\n`);
});

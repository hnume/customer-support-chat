// ============ Agent Dashboard ============
let me = null;             // agent ที่ login
let agents = [];
let online = new Set();
let tickets = [];
let current = null;        // ticket ที่เปิดอยู่
let convs = [];
let currentConv = null;    // ห้อง team chat ที่เปิดอยู่
let tab = 'tickets';
const socket = io({ autoConnect: false });

const authed = (url, opts = {}) => api(url, { ...opts, headers: { 'x-agent-id': me.id } });

// ---------------- Login ----------------
(async () => {
  agents = await api('/api/agents');
  $('#agentSelect').innerHTML = agents.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  const saved = storage.get('agentId');
  if (saved && agents.find((a) => a.id === saved)) login(saved);
})();

$('#loginBtn').onclick = () => login($('#agentSelect').value);
$('#logoutBtn').onclick = () => { storage.del('agentId'); location.reload(); };

function login(id) {
  me = agents.find((a) => a.id === id);
  storage.set('agentId', id);
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#me').textContent = me.name;
  socket.connect();
  loadTickets();
  loadStats();
  loadConvs();
  setInterval(loadStats, 15000);
  setInterval(renderList, 1000); // อัปเดต SLA countdown
}

socket.on('connect', () => {
  socket.emit('agent:online', { agentId: me.id });
  if (current) socket.emit('ticket:join', { ticketId: current.id });
});

// ---------------- Tabs ----------------
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
function switchTab(name) {
  tab = name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#ticketsView').classList.toggle('hidden', name !== 'tickets');
  $('#teamView').classList.toggle('hidden', name !== 'team');
  if (name === 'team') markConvRead();
  else markTicketRead();
}

// ---------------- Stats ----------------
async function loadStats() {
  const s = await api('/api/stats');
  const m = s.messaging;
  const item = (label, val) => `<div class="stat"><span class="muted">${label}</span><b>${val}</b></div>`;
  $('#stats').innerHTML =
    item('Ticket ทั้งหมด', s.total) +
    item('เปิดใหม่', s.byStatus.open || 0) +
    item('กำลังดำเนินการ', s.byStatus.in_progress || 0) +
    item('Escalated', s.escalated) +
    item('SLA Compliance', s.slaComplianceRate + '%') +
    item('ตอบครั้งแรกเฉลี่ย', s.avgFirstResponseMin + ' นาที') +
    item('ข้อความวันนี้', m.messagesToday) +
    item('Delivery latency', m.avgDeliveryLatencySec + ' วิ') +
    item('เวลาก่อนอ่าน (เฉลี่ย)', m.avgTimeToReadSec + ' วิ') +
    item('ส่งถึงแล้ว', m.deliveredRate + '%');
}

// ======================================================
//                     TICKETS
// ======================================================
async function loadTickets() {
  tickets = await authed('/api/tickets');
  renderList();
}

function slaInfo(t) {
  if (['resolved', 'closed'].includes(t.status)) return { text: '✔ เสร็จสิ้น', cls: 'sla-ok' };
  if (t.status === 'pending') return { text: '⏸ หยุด SLA (รอลูกค้า)', cls: 'muted' };
  if (!t.slaDueAt) return { text: '', cls: '' };
  const ms = new Date(t.slaDueAt) - Date.now();
  const label = t.firstResponseAt ? 'แก้ไข' : 'ตอบแรก';
  if (ms <= 0) return { text: `⛔ เกิน SLA (${label})`, cls: 'sla-breach' };
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  const left = h ? `${h} ชม. ${m % 60} น.` : m ? `${m} น. ${Math.floor(ms / 1000) % 60} วิ` : `${Math.floor(ms / 1000)} วิ`;
  return { text: `⏱ ${label} เหลือ ${left}`, cls: t.slaWarned ? 'sla-warn' : 'sla-ok' };
}

function unreadOf(t) {
  return t.messages.filter((m) => m.from === 'customer' && !m.readAt).length;
}

function renderList() {
  if (!me) return;
  const q = $('#q').value.trim().toLowerCase();
  const st = $('#fStatus').value;
  const mine = $('#fMine').value === 'mine';
  const list = tickets
    .filter((t) => !st || t.status === st)
    .filter((t) => !mine || t.assigneeId === me.id)
    .filter((t) => !q || [t.number, t.subject, t.customerName, t.customerEmail].join(' ').toLowerCase().includes(q));

  $('#ticketList').innerHTML = list.length ? list.map((t) => {
    const s = slaInfo(t);
    const unread = unreadOf(t);
    return `<div class="ticket-item ${current?.id === t.id ? 'active' : ''} ${t.escalated ? 'escalated' : ''}" data-id="${t.id}">
      <div class="t1"><span>${t.number} · ${CHANNEL_ICON[t.channel] || t.channel}</span><span class="muted">${fmtTime(t.updatedAt)}</span></div>
      <div class="t2">${esc(t.subject)} ${unread ? `<span class="unread">${unread}</span>` : ''}</div>
      <div class="t3">
        <span class="badge st-${t.status}">${STATUS_TH[t.status]}</span>
        <span class="badge pr-${t.priority}">${PRIORITY_TH[t.priority]}</span>
        ${t.escalated ? '<span class="badge pr-urgent">Escalated</span>' : ''}
        <span class="${s.cls}">${s.text}</span>
      </div>
      <div class="muted">${esc(t.customerName)} → ${esc(t.assigneeName || 'ยังไม่มอบหมาย')}</div>
    </div>`;
  }).join('') : '<div class="empty">ไม่มี ticket</div>';

  if (current) {
    const s = slaInfo(current);
    const el = $('#slaNow');
    if (el) { el.textContent = s.text; el.className = s.cls; }
  }
}

$('#ticketList').onclick = (e) => {
  const item = e.target.closest('.ticket-item');
  if (item) openTicket(item.dataset.id);
};
['#q', '#fStatus', '#fMine'].forEach((s) => $(s).addEventListener('input', renderList));

async function openTicket(id) {
  current = await authed(`/api/tickets/${id}`);
  socket.emit('ticket:join', { ticketId: id });
  $('#noTicket').classList.add('hidden');
  $('#chatPane').classList.remove('hidden');
  $('#typing').textContent = '';
  renderChat();
  renderDetails();
  renderList();
  markTicketRead();
}

function renderChat() {
  $('#cNumber').textContent = current.number;
  $('#cSubject').textContent = current.subject;
  $('#cCustomer').textContent = `${current.customerName} <${current.customerEmail}> · ${CHANNEL_ICON[current.channel]}`;
  $('#messages').innerHTML = current.messages.map((m) => renderMessage(m, 'agent')).join('');
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

function renderDetails() {
  const t = current;
  const opt = (obj, val) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${v}</option>`).join('');
  const agentOpts = `<option value="">— ยังไม่มอบหมาย —</option>` + agents.map((a) =>
    `<option value="${a.id}" ${a.id === t.assigneeId ? 'selected' : ''}>${online.has(a.id) ? '🟢' : '⚪'} ${esc(a.name)}</option>`).join('');
  const s = slaInfo(t);
  $('#details').innerHTML = `
    <h3>${t.number}</h3>
    <div class="muted">สร้างเมื่อ ${fmtTime(t.createdAt)} · หมวด ${esc(t.category)}</div>
    <p id="slaNow" class="${s.cls}">${s.text}</p>
    <label>สถานะ</label><select id="dStatus">${opt(STATUS_TH, t.status)}</select>
    <label>Priority</label><select id="dPriority">${opt(PRIORITY_TH, t.priority)}</select>
    <label>ผู้รับผิดชอบ</label><select id="dAssignee">${agentOpts}</select>
    <div style="display:flex;gap:6px;margin-top:10px">
      <button id="takeBtn" style="flex:1">รับงานเอง</button>
      <button id="escBtn" class="danger" style="flex:1">Escalate</button>
    </div>
    <label style="margin-top:16px">Timeline</label>
    <ul class="events">${[...t.events].reverse().map((e) =>
      `<li><b>${esc(e.type)}</b> · ${esc(e.detail)}<div class="muted">${esc(e.by)} · ${fmtTime(e.at)}</div></li>`).join('')}</ul>`;

  const patch = (body) => authed(`/api/tickets/${t.id}`, { method: 'PATCH', body }).then(applyTicket).catch((e) => toast(e.message));
  $('#dStatus').onchange = (e) => patch({ status: e.target.value });
  $('#dPriority').onchange = (e) => patch({ priority: e.target.value });
  $('#dAssignee').onchange = (e) => patch({ assigneeId: e.target.value || null });
  $('#takeBtn').onclick = () => patch({ assigneeId: me.id });
  $('#escBtn').onclick = async () => {
    const reason = prompt('เหตุผลในการ escalate', 'ต้องการผู้เชี่ยวชาญ L2');
    if (reason === null) return;
    authed(`/api/tickets/${t.id}/escalate`, { method: 'POST', body: { reason } }).then(applyTicket).catch((e) => toast(e.message));
  };
}

function applyTicket(t) {
  const i = tickets.findIndex((x) => x.id === t.id);
  i >= 0 ? (tickets[i] = t) : tickets.unshift(t);
  tickets.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  if (current?.id === t.id) {
    const msgCountChanged = current.messages.length !== t.messages.length;
    current = t;
    renderDetails();
    if (msgCountChanged) renderChat();
  }
  renderList();
}

function markTicketRead() {
  if (current && tab === 'tickets' && isVisible()) socket.emit('ticket:read', { ticketId: current.id });
}
window.addEventListener('focus', () => (tab === 'team' ? markConvRead() : markTicketRead()));

// ส่งข้อความ
async function sendReply() {
  const text = $('#text').value.trim();
  if (!text || !current) return;
  $('#text').value = '';
  try {
    await authed(`/api/tickets/${current.id}/messages`, { method: 'POST', body: { text, internal: $('#internal').checked } });
  } catch (e) { toast(e.message); }
}
$('#composer').onsubmit = (e) => { e.preventDefault(); sendReply(); };
const emitTyping = typingEmitter(socket, () => current?.id, 'เจ้าหน้าที่');
$('#text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
  else if (!$('#internal').checked) emitTyping();
});

// ---------------- Realtime: tickets ----------------
socket.on('ticket:updated', ({ kind, ticket }) => {
  if (kind === 'new' && ticket.assigneeId !== me.id) toast(`🆕 ${ticket.number}: ${ticket.subject}`, () => openTicket(ticket.id));
  applyTicket(ticket);
  loadStats();
});

socket.on('message:new', ({ ticketId, message }) => {
  // รับข้อความแล้ว → ack delivered
  if (message.from === 'customer') socket.emit('message:ack', { ticketId, messageIds: [message.id] });
  if (current?.id !== ticketId || document.querySelector(`#messages [data-id="${message.id}"]`)) return;
  current.messages.push(message);
  $('#messages').insertAdjacentHTML('beforeend', renderMessage(message, 'agent'));
  $('#messages').scrollTop = $('#messages').scrollHeight;
  if (message.from === 'customer') markTicketRead();
});

socket.on('message:status', ({ ticketId, updates }) => {
  const t = tickets.find((x) => x.id === ticketId);
  for (const u of updates) {
    for (const list of [t?.messages, current?.id === ticketId ? current.messages : null]) {
      const m = list && list.find((x) => x.id === u.id);
      if (m) Object.assign(m, u);
    }
  }
  if (current?.id === ticketId) applyStatus(updates);
  renderList();
});

socket.on('typing', ({ ticketId, name, isTyping }) => {
  if (ticketId === current?.id) $('#typing').textContent = isTyping ? `${name} กำลังพิมพ์...` : '';
});

socket.on('agents:presence', (ids) => { online = new Set(ids); if (current) renderDetails(); renderConvMembers(); });

socket.on('notify', (n) => {
  toast(n.text, () => { switchTab('tickets'); openTicket(n.ticketId); });
});

// ======================================================
//               TEAM CHAT (1:1 / Group)
// ======================================================
async function loadConvs() {
  convs = await authed('/api/conversations');
  renderConvList();
}

function renderConvList() {
  const totalUnread = convs.reduce((s, c) => s + c.unread, 0);
  $('#teamUnread').textContent = totalUnread;
  $('#teamUnread').classList.toggle('hidden', !totalUnread);
  $('#convList').innerHTML = convs.length ? convs.map((c) => `
    <div class="ticket-item ${currentConv?.id === c.id ? 'active' : ''}" data-id="${c.id}">
      <div class="t1"><span>${c.type === 'group' ? '👥 Group' : '👤 1:1'}</span><span class="muted">${fmtTime(c.updatedAt)}</span></div>
      <div class="t2">${esc(c.title)} ${c.unread ? `<span class="unread">${c.unread}</span>` : ''}</div>
      <div class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${c.lastMessage ? `${esc(c.lastMessage.senderName)}: ${esc(c.lastMessage.text)}` : 'ยังไม่มีข้อความ'}
      </div>
    </div>`).join('') : '<div class="empty">ยังไม่มีห้องแชท</div>';
}

$('#convList').onclick = (e) => {
  const item = e.target.closest('.ticket-item');
  if (item) openConv(item.dataset.id);
};

// ข้อความใน team chat: แสดงจำนวนคนที่อ่านใน group
function renderConvMessage(m) {
  const mine = m.senderId === me.id;
  const extra = mine && m.recipients > 1 ? ` (${m.readCount}/${m.recipients})` : '';
  const st = mine ? `<div class="st" data-cst="${m.id}">${ticks(m.status, extra)}</div>` : '';
  return `<div class="msg ${mine ? 'mine' : 'theirs'}" data-cid="${m.id}"><div class="meta">${esc(m.senderName)} · ${fmtTime(m.at)}</div>${esc(m.text)}${st}</div>`;
}

async function openConv(id) {
  currentConv = await authed(`/api/conversations/${id}/messages`);
  $('#noConv').classList.add('hidden');
  $('#convPane').classList.remove('hidden');
  $('#convTitle').textContent = (currentConv.type === 'group' ? '👥 ' : '👤 ') + currentConv.title;
  $('#convTyping').textContent = '';
  renderConvMembers();
  $('#convMessages').innerHTML =
    (currentConv.hasMore ? '<div class="event-line">มีข้อความเก่ากว่านี้</div>' : '') +
    currentConv.messages.map(renderConvMessage).join('');
  $('#convMessages').scrollTop = $('#convMessages').scrollHeight;
  renderConvList();
  markConvRead();
}

function renderConvMembers() {
  if (!currentConv) return;
  $('#convMembers').innerHTML = currentConv.members.map((m) =>
    `<span><span class="dot ${online.has(m.id) ? 'on' : ''}"></span>${esc(m.name)}</span>`).join(' &nbsp; ');
}

function markConvRead() {
  if (!currentConv || tab !== 'team' || !isVisible()) return;
  socket.emit('conv:read', { convId: currentConv.id });
  const c = convs.find((x) => x.id === currentConv.id);
  if (c && c.unread) { c.unread = 0; renderConvList(); }
}

async function sendConv() {
  const text = $('#convText').value.trim();
  if (!text || !currentConv) return;
  $('#convText').value = '';
  try { await authed(`/api/conversations/${currentConv.id}/messages`, { method: 'POST', body: { text } }); }
  catch (e) { toast(e.message); }
}
$('#convComposer').onsubmit = (e) => { e.preventDefault(); sendConv(); };
let convTypingTimer = null;
$('#convText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendConv(); return; }
  if (!currentConv) return;
  if (!convTypingTimer) socket.emit('conv:typing', { convId: currentConv.id, isTyping: true });
  clearTimeout(convTypingTimer);
  const id = currentConv.id;
  convTypingTimer = setTimeout(() => { socket.emit('conv:typing', { convId: id, isTyping: false }); convTypingTimer = null; }, 1500);
});

// ----- สร้างห้องใหม่ -----
function showNewConv(type) {
  const f = $('#newConvForm');
  f.classList.remove('hidden');
  f.elements['type'].value = type;
  $('#groupNameWrap').classList.toggle('hidden', type !== 'group');
  $('#memberLabel').textContent = type === 'group' ? 'เลือกสมาชิก (หลายคน)' : 'เลือกคู่สนทนา';
  const input = type === 'group' ? 'checkbox' : 'radio';
  $('#memberPicker').innerHTML = agents.filter((a) => a.id !== me.id).map((a) =>
    `<label class="member-row"><input type="${input}" name="members" value="${a.id}" />
      <span class="dot ${online.has(a.id) ? 'on' : ''}"></span>${esc(a.name)}</label>`).join('');
}
$('#newDirectBtn').onclick = () => showNewConv('direct');
$('#newGroupBtn').onclick = () => showNewConv('group');
$('#cancelConv').onclick = () => $('#newConvForm').classList.add('hidden');
$('#newConvForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const memberIds = [...f.querySelectorAll('input[name=members]:checked')].map((i) => i.value);
  try {
    const conv = await authed('/api/conversations', { method: 'POST', body: { type: f.elements['type'].value, name: f.elements['name'].value, memberIds } });
    f.classList.add('hidden');
    f.reset();
    await loadConvs();
    openConv(conv.id);
  } catch (err) { toast(err.message); }
};

// ----- Realtime: team chat -----
socket.on('conv:message', ({ convId, title, message }) => {
  if (message.senderId !== me.id) socket.emit('conv:ack', { convId, messageIds: [message.id] }); // delivered
  let c = convs.find((x) => x.id === convId);
  if (!c) { loadConvs(); } else {
    c.lastMessage = { text: message.text, senderName: message.senderName, at: message.at };
    c.updatedAt = message.at;
    const viewing = currentConv?.id === convId && tab === 'team' && isVisible();
    if (message.senderId !== me.id && !viewing) c.unread++;
    convs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    renderConvList();
  }
  if (currentConv?.id === convId) {
    if (!document.querySelector(`[data-cid="${message.id}"]`)) {
      currentConv.messages.push(message);
      $('#convMessages').insertAdjacentHTML('beforeend', renderConvMessage(message));
      $('#convMessages').scrollTop = $('#convMessages').scrollHeight;
    }
    if (message.senderId !== me.id) markConvRead();
  } else if (message.senderId !== me.id) {
    toast(`💬 ${title}: ${message.senderName} — ${message.text.slice(0, 60)}`, () => { switchTab('team'); openConv(convId); });
  }
});

socket.on('conv:status', ({ convId, message }) => {
  if (currentConv?.id !== convId) return;
  const el = document.querySelector(`[data-cst="${message.id}"]`);
  const extra = message.recipients > 1 ? ` (${message.readCount}/${message.recipients})` : '';
  if (el) el.innerHTML = ticks(message.status, extra);
});

socket.on('conv:typing', ({ convId, name, isTyping }) => {
  if (currentConv?.id === convId) $('#convTyping').textContent = isTyping ? `${name} กำลังพิมพ์...` : '';
});

socket.on('conv:updated', async ({ convId }) => {
  await loadConvs();
  if (currentConv?.id === convId) {
    if (convs.find((c) => c.id === convId)) openConv(convId);
    else { currentConv = null; $('#convPane').classList.add('hidden'); $('#noConv').classList.remove('hidden'); }
  }
});

// ============ หน้าลูกค้า: แจ้งปัญหา + แชทสด ============
const socket = io();
let ticket = null;

function showChat(t) {
  ticket = t;
  storage.set('ticketId', t.id);
  $('#startForm').classList.add('hidden');
  $('#chat').classList.remove('hidden');
  renderHeader(t);
  $('#messages').innerHTML = t.messages.map((m) => renderMessage(m, 'customer')).join('');
  scrollBottom();
  socket.emit('ticket:join', { ticketId: t.id });
  markRead();
}

function renderHeader(t) {
  $('#tNumber').textContent = t.number;
  $('#tSubject').textContent = t.subject;
  $('#tStatus').textContent = STATUS_TH[t.status];
  $('#tStatus').className = `badge st-${t.status}`;
  $('#tAgent').textContent = t.agentName ? `เจ้าหน้าที่: ${t.agentName}` : 'กำลังหาเจ้าหน้าที่ให้คุณ...';
}

const scrollBottom = () => { const m = $('#messages'); m.scrollTop = m.scrollHeight; };

// เริ่มแชท / สร้าง ticket
$('#startForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#formError').textContent = '';
  const body = Object.fromEntries(new FormData(e.target));
  try {
    storage.set('customerName', body.name);
    showChat(await api('/api/tickets', { method: 'POST', body }));
  } catch (err) {
    $('#formError').textContent = err.message;
  }
});

// ส่งข้อความ
async function send() {
  const text = $('#text').value.trim();
  if (!text || !ticket) return;
  $('#text').value = '';
  try {
    await api(`/api/public/tickets/${ticket.id}/messages`, { method: 'POST', body: { text } });
  } catch (err) { toast('ส่งไม่สำเร็จ: ' + err.message); }
}
$('#composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
const emitTyping = typingEmitter(socket, () => ticket?.id, storage.get('customerName') || 'ลูกค้า');
$('#text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } else emitTyping();
});

$('#newBtn').addEventListener('click', () => {
  storage.del('ticketId');
  ticket = null;
  $('#chat').classList.add('hidden');
  $('#startForm').classList.remove('hidden');
  $('#startForm').reset();
});

// ---------- realtime ----------
socket.on('message:new', ({ ticketId, message }) => {
  if (ticketId !== ticket?.id || document.querySelector(`[data-id="${message.id}"]`)) return;
  $('#messages').insertAdjacentHTML('beforeend', renderMessage(message, 'customer'));
  scrollBottom();
  if (message.from !== 'customer') {
    socket.emit('message:ack', { ticketId, messageIds: [message.id] }); // delivered
    markRead();
  }
});
socket.on('message:status', ({ ticketId, updates }) => { if (ticketId === ticket?.id) applyStatus(updates); });

// อ่านแล้ว = ห้องแชทเปิดอยู่และหน้าต่างถูกโฟกัส
function markRead() { if (ticket && isVisible()) socket.emit('ticket:read', { ticketId: ticket.id }); }
window.addEventListener('focus', markRead);
document.addEventListener('visibilitychange', markRead);
socket.on('ticket:status', (t) => { if (t.id === ticket?.id) { ticket = t; renderHeader(t); } });
socket.on('typing', ({ ticketId, name, isTyping }) => {
  if (ticketId === ticket?.id) $('#typing').textContent = isTyping ? `${name} กำลังพิมพ์...` : '';
});
socket.on('connect', () => ticket && socket.emit('ticket:join', { ticketId: ticket.id }));

// กลับมาหน้าเดิม → โหลดแชทต่อ
(async () => {
  const id = storage.get('ticketId');
  if (!id) return;
  try { showChat(await api(`/api/public/tickets/${id}`)); } catch { storage.del('ticketId'); }
})();

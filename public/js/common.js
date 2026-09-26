// ฟังก์ชันใช้ร่วมกันระหว่างหน้า customer และ agent
const STATUS_TH = { open: 'เปิดใหม่', in_progress: 'กำลังดำเนินการ', pending: 'รอลูกค้า', resolved: 'แก้ไขแล้ว', closed: 'ปิด' };
const PRIORITY_TH = { low: 'ต่ำ', normal: 'ปกติ', high: 'สูง', urgent: 'ด่วนมาก' };
const CHANNEL_ICON = { web: '🌐 Web', mobile: '📱 Mobile', email: '✉️ Email', chat: '💬 Chat' };

const $ = (s, el = document) => el.querySelector(s);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
}

function toast(text, onClick) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  el.onclick = () => { onClick && onClick(); el.remove(); };
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// localStorage อาจใช้ไม่ได้ในบางเบราว์เซอร์ → ห่อด้วย try/catch
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ✓ = sent, ✓✓ = delivered, ✓✓ สีฟ้า = read
const STATUS_LABEL = { sent: 'ส่งแล้ว', delivered: 'ได้รับแล้ว', read: 'อ่านแล้ว' };
function ticks(status, extra = '') {
  const mark = status === 'sent' ? '✓' : '✓✓';
  return `<span class="ticks tk-${status}" title="${STATUS_LABEL[status] || ''}${extra}">${mark} ${STATUS_LABEL[status] || ''}${extra}</span>`;
}

function renderMessage(m, mineFrom) {
  const mine = !m.internal && m.from === mineFrom;
  const cls = m.internal ? 'internal' : mine ? 'mine' : 'theirs';
  const label = m.internal ? '🔒 Internal note · ' : '';
  const st = mine ? `<div class="st" data-st="${m.id}">${ticks(m.status || 'sent')}</div>` : '';
  return `<div class="msg ${cls}" data-id="${m.id}"><div class="meta">${label}${esc(m.senderName)} · ${fmtTime(m.at)}</div>${esc(m.text)}${st}</div>`;
}

// อัปเดตเครื่องหมายสถานะของข้อความที่แสดงอยู่
function applyStatus(updates) {
  for (const u of updates) {
    const el = document.querySelector(`[data-st="${u.id}"]`);
    if (el) el.innerHTML = ticks(u.status);
  }
}

// หน้าต่างกำลังเปิดดูอยู่หรือไม่ (ใช้ตัดสินว่า "อ่านแล้ว")
const isVisible = () => document.visibilityState === 'visible' && document.hasFocus();

// ส่ง typing แบบหน่วงเวลา
function typingEmitter(socket, getTicketId, name) {
  let timer = null, typing = false;
  return () => {
    const ticketId = getTicketId();
    if (!ticketId) return;
    if (!typing) { typing = true; socket.emit('typing', { ticketId, name, isTyping: true }); }
    clearTimeout(timer);
    timer = setTimeout(() => { typing = false; socket.emit('typing', { ticketId, name, isTyping: false }); }, 1500);
  };
}

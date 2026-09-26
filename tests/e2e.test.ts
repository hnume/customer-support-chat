// ทดสอบทั้งระบบ: HTTP + Socket.IO + PostgreSQL (PGlite in-memory)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, startTestApp, until } from './helpers';

describe('Customer Support Chat System', () => {
  let h: Awaited<ReturnType<typeof startTestApp>>;
  before(async () => { h = await startTestApp({ slaUnitMs: 100, slaCheckIntervalMs: 100 }); });
  after(async () => { await h.stop(); });

  test('ลูกค้าแจ้งปัญหา → auto-assign → แชท + สถานะ sent/delivered/read', async () => {
    const a1 = h.socket();
    const a1Status: string[] = [];
    a1.on('message:status', (d) => a1Status.push(...d.updates.map((u: any) => u.status)));
    a1.on('message:new', ({ ticketId, message }) => {
      if (message.from === 'customer') a1.emit('message:ack', { ticketId, messageIds: [message.id] });
    });
    a1.emit('agent:online', { agentId: 'a1' });
    await sleep(150);

    const t = await h.api('/api/tickets', {
      method: 'POST',
      body: { name: 'ลูกค้า A', email: 'A@x.com', subject: 'Login ไม่ได้', message: 'ช่วยด้วย', priority: 'normal' },
    });
    assert.match(t.number, /^TK-\d+$/);
    assert.equal(t.agentName, 'สมชาย (Agent)');
    assert.equal(t.status, 'open');

    const c = h.socket();
    const cStatus: string[] = [];
    c.on('message:status', (d) => cStatus.push(...d.updates.map((u: any) => u.status)));
    c.on('message:new', ({ ticketId, message }) => {
      if (message.from === 'agent') c.emit('message:ack', { ticketId, messageIds: [message.id] });
    });
    c.emit('ticket:join', { ticketId: t.id });
    a1.emit('ticket:join', { ticketId: t.id });
    await sleep(150);

    await h.api(`/api/public/tickets/${t.id}/messages`, { method: 'POST', body: { text: 'ยังเข้าไม่ได้' } });
    await sleep(150);
    a1.emit('ticket:read', { ticketId: t.id });
    await until(() => cStatus.includes('read'));

    await h.api(`/api/tickets/${t.id}/messages`, { method: 'POST', agent: 'a1', body: { text: 'ลอง reset password ครับ' } });
    await sleep(150);
    c.emit('ticket:read', { ticketId: t.id });
    await until(() => a1Status.filter((s) => s === 'read').length >= 1 && a1Status.includes('delivered'));

    const tk = await h.api(`/api/tickets/${t.id}`, { agent: 'a1' });
    assert.equal(tk.status, 'in_progress');
    assert.ok(tk.firstResponseAt);
    assert.deepEqual(tk.messages.map((m: any) => `${m.from}:${m.status}`), ['customer:read', 'customer:read', 'agent:read']);
    assert.ok(tk.events.some((e: any) => e.type === 'first_response'));
  });

  test('internal note ลูกค้ามองไม่เห็น + ลูกค้าเข้า ticket ด้วยเลข TK ไม่ได้', async () => {
    const [t] = await h.api('/api/tickets', { agent: 'a1' });
    await h.api(`/api/tickets/${t.id}/messages`, { method: 'POST', agent: 'a1', body: { text: 'secret', internal: true } });
    const pub = await h.api(`/api/public/tickets/${t.id}`);
    assert.equal(pub.messages.some((m: any) => m.internal), false);
    await assert.rejects(h.api(`/api/public/tickets/${t.number}`), /404/);
    await assert.rejects(h.api('/api/tickets'), /401/);
  });

  test('email webhook: สร้าง ticket และต่อเรื่องเดิมด้วย [TK-xxxx]', async () => {
    const e1 = await h.api('/api/inbound/email', { method: 'POST', body: { from: 'b@x.com', name: 'B', subject: 'บิลผิด', body: 'ยอดไม่ตรง' } });
    assert.equal(e1.appended, false);
    const e2 = await h.api('/api/inbound/email', { method: 'POST', body: { from: 'b@x.com', subject: `Re: [${e1.ticket}] บิลผิด`, body: 'ตามเรื่อง' } });
    assert.deepEqual(e2, { ticket: e1.ticket, appended: true });
    const t = await h.api(`/api/tickets/${e1.ticket}`, { agent: 'a1' });
    assert.equal(t.channel, 'email');
    assert.equal(t.messages.length, 2);
  });

  test('เปลี่ยนสถานะ / resolve / ลูกค้าตอบแล้วเปิดใหม่', async () => {
    const t = await h.api('/api/tickets', { method: 'POST', body: { email: 'r@x.com', subject: 'x', message: 'y' } });
    const up = await h.api(`/api/tickets/${t.id}`, { method: 'PATCH', agent: 'a2', body: { status: 'resolved', assigneeId: 'a3' } });
    assert.equal(up.status, 'resolved');
    assert.equal(up.assigneeName, 'วิชัย (Agent)');
    await assert.rejects(h.api(`/api/tickets/${t.id}`, { method: 'PATCH', agent: 'a2', body: { status: 'bogus' } }), /400/);
    await h.api(`/api/public/tickets/${t.id}/messages`, { method: 'POST', body: { text: 'ยังไม่หาย' } });
    const again = await h.api(`/api/tickets/${t.id}`, { agent: 'a2' });
    assert.equal(again.status, 'open');
    assert.ok(again.events.some((e: any) => e.type === 'reopened'));
  });

  test('team chat 1:1: ส่งตอนอีกฝ่าย offline → delivered เมื่อกลับมา → read', async () => {
    const a1 = h.socket();
    const st: string[] = [];
    a1.on('conv:status', (d) => st.push(d.message.status));
    a1.emit('agent:online', { agentId: 'a1' });
    await sleep(100);

    const conv = await h.api('/api/conversations', { method: 'POST', agent: 'a1', body: { type: 'direct', memberIds: ['a2'] } });
    const again = await h.api('/api/conversations', { method: 'POST', agent: 'a1', body: { type: 'direct', memberIds: ['a2'] } });
    assert.equal(conv.id, again.id, '1:1 ต้องไม่สร้างห้องซ้ำ');

    await h.api(`/api/conversations/${conv.id}/messages`, { method: 'POST', agent: 'a1', body: { text: 'ว่างไหม' } });
    let hist = await h.api(`/api/conversations/${conv.id}/messages`, { agent: 'a1' });
    assert.equal(hist.messages[0].status, 'sent');

    const a2 = h.socket();
    a2.emit('agent:online', { agentId: 'a2' }); // กลับมา online
    await until(() => st.includes('delivered'));
    const list = await h.api('/api/conversations', { agent: 'a2' });
    assert.equal(list[0].unread, 1);
    assert.equal(list[0].title, 'สมชาย (Agent)');

    a2.emit('conv:read', { convId: conv.id });
    await until(() => st.includes('read'));
    hist = await h.api(`/api/conversations/${conv.id}/messages`, { agent: 'a1' });
    assert.equal(hist.messages[0].status, 'read');
  });

  test('group chat: นับคนอ่าน + เพิ่ม/ลบสมาชิก', async () => {
    const a2 = h.socket();
    a2.on('conv:message', ({ convId, message }) => a2.emit('conv:ack', { convId, messageIds: [message.id] }));
    a2.emit('agent:online', { agentId: 'a2' });
    await sleep(100);

    const g = await h.api('/api/conversations', { method: 'POST', agent: 'a1', body: { type: 'group', name: 'ทีม L1', memberIds: ['a2', 'a3'] } });
    await h.api(`/api/conversations/${g.id}/messages`, { method: 'POST', agent: 'a1', body: { text: 'ประชุม 3 โมง' } });
    await sleep(150);
    a2.emit('conv:read', { convId: g.id });
    await sleep(150);

    const hist = await h.api(`/api/conversations/${g.id}/messages`, { agent: 'a1' });
    const m = hist.messages[0];
    assert.equal(m.status, 'sent'); // a3 ยังไม่ได้รับ
    assert.equal(m.readCount, 1);
    assert.equal(m.recipients, 2);

    const r = await h.api(`/api/conversations/${g.id}/members`, { method: 'POST', agent: 'a1', body: { add: ['s1'], remove: ['a3'] } });
    assert.deepEqual([...r.members].sort(), ['a1', 'a2', 's1']);
    await assert.rejects(h.api(`/api/conversations/${g.id}/messages`, { agent: 'a3' }), /404/);
  });

  test('SLA: ใกล้ผิด → เตือน, ผิด → escalate ให้ supervisor (ครั้งเดียว)', async () => {
    const watcher = h.socket();
    const alerts: string[] = [];
    watcher.on('notify', (n) => alerts.push(n.type));
    watcher.emit('agent:online', { agentId: 'a3' });
    await sleep(100);

    // urgent = 15 หน่วย × 100ms = 1.5 วินาที
    const t = await h.api('/api/tickets', { method: 'POST', body: { email: 'c@x.com', subject: 'ด่วน', message: 'ล่ม', priority: 'urgent' } });
    await until(async () => (await h.api(`/api/tickets/${t.id}`, { agent: 'a1' })).escalated, 5000);
    await sleep(500);

    const tk = await h.api(`/api/tickets/${t.id}`, { agent: 'a1' });
    assert.equal(tk.assigneeId, 's1');
    assert.equal(tk.escalationLevel, 1, 'ต้อง escalate ครั้งเดียว (SLA เริ่มนับใหม่หลัง escalate)');
    assert.deepEqual(
      tk.events.map((e: any) => e.type).filter((x: string) => x.startsWith('sla') || x === 'escalated'),
      ['sla_warning', 'sla_breached', 'escalated']
    );
    assert.ok(alerts.includes('sla_warning') && alerts.includes('escalated'));
  });

  test('stats ตอบ Business questions', async () => {
    const s = await h.api('/api/stats');
    assert.ok(s.total >= 4);
    assert.ok(s.messaging.totalMessages > 0);
    assert.ok(s.messaging.deliveredRate > 0 && s.messaging.deliveredRate <= 100);
    assert.ok(s.escalated >= 1 && s.slaBreached >= 1);
    assert.equal(s.agentLoad.length, 4);
  });
});

describe('API docs', () => {
  test('Swagger UI และ OpenAPI spec ครอบคลุมทุก route', async () => {
    const h = await startTestApp();
    try {
      const base = `http://localhost:${(h.app.server.address() as { port: number }).port}`;
      const html = await (await fetch(`${base}/api/docs/`)).text();
      assert.match(html, /swagger-ui/);
      const spec = await h.api('/api/openapi.json');
      assert.equal(spec.openapi, '3.0.3');
      const paths = Object.keys(spec.paths).sort();
      assert.deepEqual(paths, [
        '/agents', '/conversations', '/conversations/{id}/members', '/conversations/{id}/messages',
        '/inbound/email', '/public/tickets/{id}', '/public/tickets/{id}/messages', '/sla-policy', '/stats',
        '/tickets', '/tickets/{id}', '/tickets/{id}/escalate', '/tickets/{id}/messages',
      ]);
    } finally {
      await h.stop();
    }
  });
});

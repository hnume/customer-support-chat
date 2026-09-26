import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDue, slaState } from '../src/business/models/slaPolicy';
import { bumpPriority, ticketNumberFromSubject } from '../src/business/models/ticket';

const MIN = 60_000;
const created = '2026-01-01T00:00:00.000Z';

test('first response SLA ตาม priority', () => {
  assert.equal(computeDue({ priority: 'urgent', createdAt: created, firstResponseAt: null, slaResetAt: null }, MIN), '2026-01-01T00:15:00.000Z');
  assert.equal(computeDue({ priority: 'high', createdAt: created, firstResponseAt: null, slaResetAt: null }, MIN), '2026-01-01T01:00:00.000Z');
});

test('ตอบแล้วเปลี่ยนเป็น resolution SLA นับจากเวลาที่ตอบ', () => {
  const due = computeDue({ priority: 'urgent', createdAt: created, firstResponseAt: '2026-01-01T00:10:00.000Z', slaResetAt: null }, MIN);
  assert.equal(due, '2026-01-01T04:10:00.000Z');
});

test('หลัง escalate เริ่มนับใหม่จาก slaResetAt', () => {
  const due = computeDue({ priority: 'urgent', createdAt: created, firstResponseAt: null, slaResetAt: '2026-01-01T00:20:00.000Z' }, MIN);
  assert.equal(due, '2026-01-01T00:35:00.000Z');
});

test('slaState: ok → warning (เหลือ < 20%) → breached', () => {
  const t = { priority: 'urgent' as const, firstResponseAt: null, slaDueAt: '2026-01-01T00:15:00.000Z' };
  assert.equal(slaState(t, new Date('2026-01-01T00:05:00Z'), MIN), 'ok');
  assert.equal(slaState(t, new Date('2026-01-01T00:13:00Z'), MIN), 'warning');
  assert.equal(slaState(t, new Date('2026-01-01T00:15:00Z'), MIN), 'breached');
});

test('bumpPriority และอ่านเลข ticket จากหัวข้ออีเมล', () => {
  assert.equal(bumpPriority('normal'), 'high');
  assert.equal(bumpPriority('urgent'), 'urgent');
  assert.equal(ticketNumberFromSubject('Re: [TK-1002] บิลผิด'), 'TK-1002');
  assert.equal(ticketNumberFromSubject('ไม่มีเลข'), null);
});

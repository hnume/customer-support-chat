// ============================================================
// SLA policy — pure functions (ไม่แตะ DB) จึงเขียน unit test ง่าย
// ============================================================
import type { Priority, Ticket } from './ticket';

/** เวลาเป้าหมายเป็น "นาที" ตาม priority */
export const SLA_POLICY: Record<Priority, { firstResponse: number; resolution: number }> = {
  urgent: { firstResponse: 15, resolution: 240 },
  high: { firstResponse: 60, resolution: 480 },
  normal: { firstResponse: 240, resolution: 1440 },
  low: { firstResponse: 1440, resolution: 4320 },
};

/** เตือนเมื่อเวลาเหลือน้อยกว่า 20% */
export const SLA_WARN_RATIO = 0.2;

type SlaInput = Pick<Ticket, 'priority' | 'createdAt' | 'firstResponseAt' | 'slaResetAt'>;

/** ระยะเวลา SLA รอบปัจจุบัน (ms) — ยังไม่ตอบ = first response, ตอบแล้ว = resolution */
export function slaWindowMs(t: Pick<Ticket, 'priority' | 'firstResponseAt'>, unitMs: number): number {
  const p = SLA_POLICY[t.priority];
  return (t.firstResponseAt ? p.resolution : p.firstResponse) * unitMs;
}

/** เวลาครบกำหนด SLA — หลัง escalate จะเริ่มนับใหม่จาก slaResetAt */
export function computeDue(t: SlaInput, unitMs: number): string {
  let base = new Date(t.firstResponseAt ?? t.createdAt).getTime();
  if (t.slaResetAt) base = Math.max(base, new Date(t.slaResetAt).getTime());
  return new Date(base + slaWindowMs(t, unitMs)).toISOString();
}

export type SlaState = 'ok' | 'warning' | 'breached';

export function slaState(
  t: Pick<Ticket, 'priority' | 'firstResponseAt' | 'slaDueAt'>,
  now: Date,
  unitMs: number
): SlaState {
  if (!t.slaDueAt) return 'ok';
  const remaining = new Date(t.slaDueAt).getTime() - now.getTime();
  if (remaining <= 0) return 'breached';
  if (remaining < slaWindowMs(t, unitMs) * SLA_WARN_RATIO) return 'warning';
  return 'ok';
}

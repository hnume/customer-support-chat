// ============================================================
// workers/slaWatcher — ตั้งเวลาอย่างเดียว logic อยู่ใน usecase checkSla()
// ============================================================
import type { UseCases } from '../business/usecases';

export function startSlaWatcher(uc: UseCases, intervalMs: number): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // กันรอบซ้อน ถ้ารอบก่อนยังไม่เสร็จ
    running = true;
    try {
      await uc.tickets.checkSla();
    } catch (e) {
      console.error('[sla-watcher]', e);
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

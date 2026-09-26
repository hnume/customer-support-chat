// ============================================================
// pkg/config — อ่านค่าจาก environment (.env) ที่เดียว
// ============================================================
import 'dotenv/config';

export interface Config {
  port: number;
  databaseUrl: string | null;
  /** ใช้เฉพาะตอน test: ไม่มี DATABASE_URL → PGlite in-memory */
  pgliteDir: string | null;
  slaDemo: boolean;
  slaUnitMs: number;        // 1 "นาที" ของ SLA เท่ากับกี่ ms
  slaCheckIntervalMs: number;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const slaDemo = process.env.SLA_DEMO === '1';
  return {
    port: Number(process.env.PORT) || 3000,
    databaseUrl: process.env.DATABASE_URL || null,
    pgliteDir: null,
    slaDemo,
    slaUnitMs: slaDemo ? 1000 : 60_000,
    slaCheckIntervalMs: slaDemo ? 2000 : 30_000,
    ...overrides,
  };
}

// ============================================================
// pkg/db/migrate — รันไฟล์ migrations/*.sql ตามลำดับ (ครั้งเดียวต่อไฟล์)
// ประวัติเก็บในตาราง schema_migrations
// ============================================================
import fs from 'fs';
import path from 'path';
import type { Db } from './client';

export const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'migrations');

export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations(name) VALUES ('${f.replace(/'/g, "''")}');\nCOMMIT;`);
    log(`[migrate] applied ${f}`);
    applied.push(f);
  }
  return applied;
}

// ============================================================
// pkg/db — การเชื่อมต่อ PostgreSQL
//  - ใช้งานจริง: PostgreSQL ผ่าน DATABASE_URL (node-postgres)
//  - ตอนรัน test: PGlite (PostgreSQL แบบ in-memory) — SQL ชุดเดียวกัน
// ============================================================
import { Pool, types } from 'pg';

// ให้ COUNT()/BIGINT คืนเป็น number เหมือน PGlite
types.setTypeParser(20, (v) => parseInt(v, 10));

export interface Db {
  readonly kind: 'postgres' | 'pglite';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export async function connectDb(opts: { databaseUrl: string | null; pgliteDir: string | null }): Promise<Db> {
  if (opts.databaseUrl) {
    const pool = new Pool({ connectionString: opts.databaseUrl });
    await pool.query('SELECT 1');
    return {
      kind: 'postgres',
      async query<T>(sql: string, params: unknown[] = []) {
        return (await pool.query(sql, params)).rows as T[];
      },
      async exec(sql: string) { await pool.query(sql); },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const pg = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite();
  await pg.waitReady;
  return {
    kind: 'pglite',
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pg.query<T>(sql, params)).rows;
    },
    async exec(sql: string) { await pg.exec(sql); },
    close: () => pg.close(),
  };
}

import type { Db } from '../pkg/db/client';
import { uid } from '../pkg/utils/ids';
import { toIso } from '../pkg/utils/time';
import type { Customer } from '../business/models/ticket';
import type { CustomerRepository } from '../business/ports';

export class PgCustomerRepository implements CustomerRepository {
  constructor(private db: Db) {}

  /** มีอีเมลนี้แล้ว → อัปเดตชื่อ, ยังไม่มี → สร้างใหม่ */
  async upsertByEmail(input: { name: string; email: string }): Promise<Customer> {
    const [r] = await this.db.query<Record<string, any>>(
      `INSERT INTO customers (id, name, email) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [uid(), input.name, input.email]
    );
    return { id: r.id, name: r.name, email: r.email, createdAt: toIso(r.created_at)! };
  }
}

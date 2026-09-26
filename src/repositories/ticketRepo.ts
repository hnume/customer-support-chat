// ============================================================
// repositories/ticketRepo — tickets, ticket_messages, ticket_events (PostgreSQL)
// ============================================================
import type { Db } from '../pkg/db/client';
import { uid } from '../pkg/utils/ids';
import { toIso } from '../pkg/utils/time';
import type { Side, Ticket, TicketEvent, TicketMessage, TicketPatch } from '../business/models/ticket';
import type { NewTicket, NewTicketMessage, TicketFilter, TicketRepository } from '../business/ports';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TICKET_SELECT = `
  SELECT t.*, c.name AS customer_name, c.email AS customer_email, a.name AS assignee_name
  FROM tickets t
  JOIN customers c ON c.id = t.customer_id
  LEFT JOIN agents a ON a.id = t.assignee_id`;

type Row = Record<string, any>;

const mapMessage = (r: Row): TicketMessage => ({
  id: r.id,
  from: r.from_side,
  senderId: r.sender_id,
  senderName: r.sender_name,
  text: r.text,
  internal: r.internal,
  at: toIso(r.created_at)!,
  status: r.status,
  deliveredAt: toIso(r.delivered_at),
  readAt: toIso(r.read_at),
});

const mapEvent = (r: Row): TicketEvent => ({
  id: r.id, type: r.type, detail: r.detail, by: r.actor, at: toIso(r.created_at)!,
});

const mapTicket = (r: Row, messages: TicketMessage[], events: TicketEvent[]): Ticket => ({
  id: r.id,
  number: r.number,
  subject: r.subject,
  category: r.category,
  channel: r.channel,
  priority: r.priority,
  status: r.status,
  customerId: r.customer_id,
  customerName: r.customer_name,
  customerEmail: r.customer_email,
  assigneeId: r.assignee_id,
  assigneeName: r.assignee_name ?? null,
  escalated: r.escalated,
  escalationLevel: r.escalation_level,
  slaWarned: r.sla_warned,
  slaDueAt: toIso(r.sla_due_at),
  slaResetAt: toIso(r.sla_reset_at),
  firstResponseAt: toIso(r.first_response_at),
  resolvedAt: toIso(r.resolved_at),
  createdAt: toIso(r.created_at)!,
  updatedAt: toIso(r.updated_at)!,
  messages,
  events,
});

// ชื่อฟิลด์ใน TypeScript → ชื่อคอลัมน์
const PATCH_COLUMNS: Record<keyof TicketPatch, string> = {
  status: 'status',
  priority: 'priority',
  assigneeId: 'assignee_id',
  escalated: 'escalated',
  escalationLevel: 'escalation_level',
  slaWarned: 'sla_warned',
  slaDueAt: 'sla_due_at',
  slaResetAt: 'sla_reset_at',
  firstResponseAt: 'first_response_at',
  resolvedAt: 'resolved_at',
};

export class PgTicketRepository implements TicketRepository {
  constructor(private db: Db) {}

  /** โหลด messages + events ของหลาย ticket ในครั้งเดียว (เลี่ยง N+1 query) */
  private async hydrate(rows: Row[]): Promise<Ticket[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [msgs, evs] = await Promise.all([
      this.db.query<Row>('SELECT * FROM ticket_messages WHERE ticket_id = ANY($1::uuid[]) ORDER BY created_at, id', [ids]),
      this.db.query<Row>('SELECT * FROM ticket_events WHERE ticket_id = ANY($1::uuid[]) ORDER BY created_at, id', [ids]),
    ]);
    const group = <T>(list: Row[], map: (r: Row) => T) => {
      const m = new Map<string, T[]>();
      for (const r of list) (m.get(r.ticket_id) ?? m.set(r.ticket_id, []).get(r.ticket_id)!).push(map(r));
      return m;
    };
    const mm = group(msgs, mapMessage);
    const em = group(evs, mapEvent);
    return rows.map((r) => mapTicket(r, mm.get(r.id) ?? [], em.get(r.id) ?? []));
  }

  async create(input: NewTicket): Promise<Ticket> {
    const id = uid();
    await this.db.query(
      `INSERT INTO tickets (id, subject, category, channel, priority, status, customer_id)
       VALUES ($1, $2, $3, $4, $5, 'open', $6)`,
      [id, input.subject, input.category, input.channel, input.priority, input.customerId]
    );
    return (await this.find(id))!;
  }

  async find(idOrNumber: string): Promise<Ticket | null> {
    const byId = UUID_RE.test(idOrNumber);
    const rows = await this.db.query<Row>(`${TICKET_SELECT} WHERE ${byId ? 't.id = $1::uuid' : 't.number = $1'}`, [idOrNumber]);
    return (await this.hydrate(rows))[0] ?? null;
  }

  async list(filter: TicketFilter = {}): Promise<Ticket[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) { params.push(filter.status); where.push(`t.status = $${params.length}`); }
    if (filter.assigneeId) { params.push(filter.assigneeId); where.push(`t.assignee_id = $${params.length}`); }
    if (filter.q) {
      params.push(`%${filter.q}%`);
      const p = `$${params.length}`;
      where.push(`(t.number ILIKE ${p} OR t.subject ILIKE ${p} OR c.name ILIKE ${p} OR c.email ILIKE ${p})`);
    }
    const sql = `${TICKET_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.updated_at DESC`;
    return this.hydrate(await this.db.query<Row>(sql, params));
  }

  async listSlaActive(): Promise<Ticket[]> {
    return this.hydrate(await this.db.query<Row>(
      `${TICKET_SELECT} WHERE t.status IN ('open', 'in_progress') AND t.sla_due_at IS NOT NULL`
    ));
  }

  async update(id: string, patch: TicketPatch): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, col] of Object.entries(PATCH_COLUMNS) as [keyof TicketPatch, string][]) {
      if (patch[key] === undefined) continue;
      params.push(patch[key]);
      sets.push(`${col} = $${params.length}`);
    }
    if (!sets.length) return;
    params.push(id);
    await this.db.query(`UPDATE tickets SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
  }

  async addMessage(ticketId: string, m: NewTicketMessage): Promise<TicketMessage> {
    const [row] = await this.db.query<Row>(
      `INSERT INTO ticket_messages (id, ticket_id, from_side, sender_id, sender_name, text, internal)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [uid(), ticketId, m.from, m.senderId, m.senderName, m.text, m.internal]
    );
    await this.db.query('UPDATE tickets SET updated_at = now() WHERE id = $1', [ticketId]);
    return mapMessage(row);
  }

  async addEvent(ticketId: string, type: string, detail: string, by = 'system'): Promise<void> {
    await this.db.query(
      'INSERT INTO ticket_events (id, ticket_id, type, detail, actor) VALUES ($1, $2, $3, $4, $5)',
      [uid(), ticketId, type, detail, by]
    );
    await this.db.query('UPDATE tickets SET updated_at = now() WHERE id = $1', [ticketId]);
  }

  async markMessages(ticketId: string, recipient: Side, level: 'delivered' | 'read', onlyIds?: string[]): Promise<TicketMessage[]> {
    const read = level === 'read';
    const params: unknown[] = [ticketId, recipient, read];
    let idFilter = '';
    if (onlyIds?.length) { params.push(onlyIds); idFilter = `AND id = ANY($4::uuid[])`; }
    const rows = await this.db.query<Row>(
      `UPDATE ticket_messages SET
         delivered_at = COALESCE(delivered_at, now()),
         read_at      = CASE WHEN $3 THEN COALESCE(read_at, now()) ELSE read_at END,
         status       = CASE WHEN $3 THEN 'read' ELSE 'delivered' END
       WHERE ticket_id = $1 AND internal = false AND from_side <> $2
         AND (delivered_at IS NULL OR ($3 AND read_at IS NULL)) ${idFilter}
       RETURNING *`,
      params
    );
    return rows.map(mapMessage);
  }

  async openCountByAssignee(): Promise<Record<string, number>> {
    const rows = await this.db.query<{ assignee_id: string; n: number }>(
      `SELECT assignee_id, COUNT(*)::int AS n FROM tickets
       WHERE assignee_id IS NOT NULL AND status NOT IN ('resolved', 'closed') GROUP BY assignee_id`
    );
    return Object.fromEntries(rows.map((r) => [r.assignee_id, r.n]));
  }
}

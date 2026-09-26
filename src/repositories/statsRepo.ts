// ============================================================
// repositories/statsRepo — ตัวเลข dashboard / Business questions
// SQL ชุดนี้ copy ไปรันใน TablePlus ได้เลย
// ============================================================
import type { Db } from '../pkg/db/client';
import type { Stats } from '../business/models/stats';
import type { StatsRepository } from '../business/ports';

type Row = Record<string, any>;

const countBy = async (db: Db, col: string) =>
  Object.fromEntries(
    (await db.query<Row>(`SELECT ${col} AS k, COUNT(*)::int AS n FROM tickets GROUP BY ${col}`)).map((r) => [r.k, r.n])
  );

export class PgStatsRepository implements StatsRepository {
  constructor(private db: Db) {}

  async snapshot(now: Date): Promise<Stats> {
    const db = this.db;
    const today = now.toISOString().slice(0, 10);

    const [t] = await db.query<Row>(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE escalated)::int AS escalated,
             COALESCE(AVG(EXTRACT(EPOCH FROM first_response_at - created_at)) FILTER (WHERE first_response_at IS NOT NULL), 0)::float AS avg_first_sec,
             (SELECT COUNT(DISTINCT ticket_id)::int FROM ticket_events WHERE type = 'sla_breached') AS breached
        FROM tickets`);

    // ข้อความทั้งหมด: แชท ticket (ไม่รวม internal) + team chat (1 แถวต่อผู้รับ)
    const [m] = await db.query<Row>(`
      WITH deliveries AS (
        SELECT created_at AS sent_at, delivered_at, read_at FROM ticket_messages WHERE internal = false
        UNION ALL
        SELECT m.created_at, r.delivered_at, r.read_at
          FROM conversation_messages m
          JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.agent_id <> m.sender_id
          LEFT JOIN message_receipts r ON r.message_id = m.id AND r.agent_id = cm.agent_id
      )
      SELECT
        COALESCE(AVG(EXTRACT(EPOCH FROM delivered_at - sent_at)) FILTER (WHERE delivered_at IS NOT NULL), 0)::float AS avg_delivery,
        COALESCE(AVG(EXTRACT(EPOCH FROM read_at - sent_at)) FILTER (WHERE read_at IS NOT NULL), 0)::float AS avg_read
      FROM deliveries`);

    const perDayRows = await db.query<Row>(`
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*)::int AS n FROM (
        SELECT created_at FROM ticket_messages WHERE internal = false
        UNION ALL SELECT created_at FROM conversation_messages
      ) x GROUP BY 1 ORDER BY 1`);

    // ข้อความที่ยังส่งไม่ถึงผู้รับครบทุกคน
    const [p] = await db.query<Row>(`
      SELECT
        (SELECT COUNT(*)::int FROM ticket_messages WHERE internal = false) +
        (SELECT COUNT(*)::int FROM conversation_messages) AS total,
        (SELECT COUNT(*)::int FROM ticket_messages WHERE internal = false AND delivered_at IS NULL) +
        (SELECT COUNT(*)::int FROM conversation_messages m WHERE EXISTS (
           SELECT 1 FROM conversation_members cm
             LEFT JOIN message_receipts r ON r.message_id = m.id AND r.agent_id = cm.agent_id
            WHERE cm.conversation_id = m.conversation_id AND cm.agent_id <> m.sender_id AND r.delivered_at IS NULL
        )) AS pending,
        (SELECT COUNT(DISTINCT conversation_id)::int FROM conversation_messages
          WHERE to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = $1) AS active_convs`, [today]);

    const agentLoad = await db.query<Row>(`
      SELECT a.id, a.name, COUNT(t.id)::int AS open
        FROM agents a LEFT JOIN tickets t ON t.assignee_id = a.id AND t.status NOT IN ('resolved', 'closed')
       GROUP BY a.id, a.name ORDER BY a.role, a.id`);

    const perDay = Object.fromEntries(perDayRows.map((r) => [r.day, r.n]));
    const round1 = (x: number) => Math.round(x * 10) / 10;
    return {
      messaging: {
        totalMessages: p.total,
        messagesToday: perDay[today] ?? 0,
        messagesPerDay: perDay,
        avgDeliveryLatencySec: round1(m.avg_delivery),
        avgTimeToReadSec: round1(m.avg_read),
        pendingDelivery: p.pending,
        deliveredRate: p.total ? Math.round(((p.total - p.pending) / p.total) * 100) : 100,
        activeConversations: p.active_convs,
      },
      total: t.total,
      byStatus: await countBy(db, 'status'),
      byChannel: await countBy(db, 'channel'),
      byPriority: await countBy(db, 'priority'),
      escalated: t.escalated,
      slaBreached: t.breached,
      slaComplianceRate: t.total ? Math.round(((t.total - t.breached) / t.total) * 100) : 100,
      avgFirstResponseMin: round1(t.avg_first_sec / 60),
      agentLoad: agentLoad.map((r) => ({ id: r.id, name: r.name, open: r.open })),
    };
  }
}

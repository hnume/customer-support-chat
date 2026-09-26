// ============================================================
// repositories/conversationRepo — Team chat (PostgreSQL)
// conversations, conversation_members, conversation_messages, message_receipts
// ============================================================
import type { Db } from '../pkg/db/client';
import { uid } from '../pkg/utils/ids';
import { toIso } from '../pkg/utils/time';
import type { Conversation, ConversationSummary, ConversationType, ConvMessage } from '../business/models/conversation';
import type { ConversationRepository } from '../business/ports';

type Row = Record<string, any>;

export class PgConversationRepository implements ConversationRepository {
  constructor(private db: Db) {}

  private async members(ids: string[]): Promise<Map<string, string[]>> {
    const rows = await this.db.query<Row>(
      'SELECT conversation_id, agent_id FROM conversation_members WHERE conversation_id = ANY($1::uuid[]) ORDER BY joined_at, agent_id',
      [ids]
    );
    const m = new Map<string, string[]>();
    for (const r of rows) (m.get(r.conversation_id) ?? m.set(r.conversation_id, []).get(r.conversation_id)!).push(r.agent_id);
    return m;
  }

  private mapConv(r: Row, members: string[]): Conversation {
    return { id: r.id, type: r.type, name: r.name, members, createdBy: r.created_by, createdAt: toIso(r.created_at)! };
  }

  /** เติม deliveredTo / readBy จากตาราง message_receipts */
  private async withReceipts(rows: Row[]): Promise<ConvMessage[]> {
    if (!rows.length) return [];
    const receipts = await this.db.query<Row>(
      'SELECT * FROM message_receipts WHERE message_id = ANY($1::uuid[])',
      [rows.map((r) => r.id)]
    );
    return rows.map((r) => {
      const deliveredTo: Record<string, string> = {};
      const readBy: Record<string, string> = {};
      for (const x of receipts) {
        if (x.message_id !== r.id) continue;
        if (x.delivered_at) deliveredTo[x.agent_id] = toIso(x.delivered_at)!;
        if (x.read_at) readBy[x.agent_id] = toIso(x.read_at)!;
      }
      return {
        id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, senderName: r.sender_name,
        text: r.text, at: toIso(r.created_at)!, deliveredTo, readBy,
      };
    });
  }

  async listForAgent(agentId: string): Promise<ConversationSummary[]> {
    const rows = await this.db.query<Row>(
      `SELECT c.*,
              lm.text AS last_text, lm.sender_name AS last_sender, lm.created_at AS last_at,
              (SELECT COUNT(*)::int FROM conversation_messages m
                 LEFT JOIN message_receipts r ON r.message_id = m.id AND r.agent_id = $1
                WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND r.read_at IS NULL) AS unread
         FROM conversations c
         JOIN conversation_members me ON me.conversation_id = c.id AND me.agent_id = $1
         LEFT JOIN LATERAL (
           SELECT text, sender_name, created_at FROM conversation_messages
            WHERE conversation_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1
         ) lm ON true
        ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
      [agentId]
    );
    const members = await this.members(rows.map((r) => r.id));
    return rows.map((r) => ({
      ...this.mapConv(r, members.get(r.id) ?? []),
      updatedAt: toIso(r.last_at ?? r.created_at)!,
      lastMessage: r.last_at ? { text: r.last_text, senderName: r.last_sender, at: toIso(r.last_at)! } : null,
      unread: r.unread,
    }));
  }

  async find(id: string): Promise<Conversation | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [row] = await this.db.query<Row>('SELECT * FROM conversations WHERE id = $1', [id]);
    if (!row) return null;
    return this.mapConv(row, (await this.members([id])).get(id) ?? []);
  }

  async findDirect(a: string, b: string): Promise<Conversation | null> {
    const [row] = await this.db.query<Row>(
      `SELECT c.id FROM conversations c
        WHERE c.type = 'direct'
          AND (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id = c.id) = 2
          AND EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.id AND m.agent_id = $1)
          AND EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = c.id AND m.agent_id = $2)
        LIMIT 1`,
      [a, b]
    );
    return row ? this.find(row.id) : null;
  }

  async create(input: { type: ConversationType; name: string | null; createdBy: string; members: string[] }): Promise<Conversation> {
    const id = uid();
    await this.db.query('INSERT INTO conversations (id, type, name, created_by) VALUES ($1, $2, $3, $4)', [
      id, input.type, input.name, input.createdBy,
    ]);
    for (const agentId of new Set(input.members)) {
      await this.db.query('INSERT INTO conversation_members (conversation_id, agent_id) VALUES ($1, $2)', [id, agentId]);
    }
    return (await this.find(id))!;
  }

  async updateMembers(id: string, add: string[], remove: string[]): Promise<Conversation> {
    for (const agentId of add) {
      await this.db.query(
        'INSERT INTO conversation_members (conversation_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, agentId]
      );
    }
    if (remove.length) {
      await this.db.query('DELETE FROM conversation_members WHERE conversation_id = $1 AND agent_id = ANY($2::text[])', [id, remove]);
    }
    return (await this.find(id))!;
  }

  async addMessage(conversationId: string, sender: { id: string; name: string }, text: string): Promise<ConvMessage> {
    const id = uid();
    const [row] = await this.db.query<Row>(
      `INSERT INTO conversation_messages (id, conversation_id, sender_id, sender_name, text)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, conversationId, sender.id, sender.name, text]
    );
    // ผู้ส่งถือว่าได้รับและอ่านแล้ว
    await this.db.query(
      'INSERT INTO message_receipts (message_id, agent_id, delivered_at, read_at) VALUES ($1, $2, $3, $3)',
      [id, sender.id, row.created_at]
    );
    return (await this.withReceipts([row]))[0];
  }

  async messages(conversationId: string, opts: { before?: string; limit: number }) {
    const params: unknown[] = [conversationId, opts.limit + 1];
    let before = '';
    if (opts.before) { params.push(opts.before); before = 'AND created_at < $3'; }
    const rows = await this.db.query<Row>(
      `SELECT * FROM conversation_messages WHERE conversation_id = $1 ${before}
        ORDER BY created_at DESC, id DESC LIMIT $2`,
      params
    );
    const hasMore = rows.length > opts.limit;
    const page = rows.slice(0, opts.limit).reverse();
    return { messages: await this.withReceipts(page), hasMore };
  }

  async mark(conversationId: string, agentId: string, level: 'delivered' | 'read', onlyIds?: string[]): Promise<ConvMessage[]> {
    const read = level === 'read';
    const params: unknown[] = [conversationId, agentId, read];
    let idFilter = '';
    if (onlyIds?.length) { params.push(onlyIds); idFilter = 'AND m.id = ANY($4::uuid[])'; }
    const changed = await this.db.query<Row>(
      `INSERT INTO message_receipts AS r (message_id, agent_id, delivered_at, read_at)
       SELECT m.id, $2, now(), CASE WHEN $3 THEN now() END
         FROM conversation_messages m
        WHERE m.conversation_id = $1 AND m.sender_id <> $2 ${idFilter}
       ON CONFLICT (message_id, agent_id) DO UPDATE SET
         delivered_at = COALESCE(r.delivered_at, EXCLUDED.delivered_at),
         read_at      = COALESCE(r.read_at, EXCLUDED.read_at)
       WHERE r.delivered_at IS NULL OR (EXCLUDED.read_at IS NOT NULL AND r.read_at IS NULL)
       RETURNING r.message_id`,
      params
    );
    if (!changed.length) return [];
    const rows = await this.db.query<Row>(
      'SELECT * FROM conversation_messages WHERE id = ANY($1::uuid[]) ORDER BY created_at, id',
      [changed.map((r) => r.message_id)]
    );
    return this.withReceipts(rows);
  }

  async pendingFor(agentId: string): Promise<string[]> {
    const rows = await this.db.query<Row>(
      `SELECT DISTINCT m.conversation_id
         FROM conversation_messages m
         JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.agent_id = $1
         LEFT JOIN message_receipts r ON r.message_id = m.id AND r.agent_id = $1
        WHERE m.sender_id <> $1 AND r.delivered_at IS NULL`,
      [agentId]
    );
    return rows.map((r) => r.conversation_id);
  }
}

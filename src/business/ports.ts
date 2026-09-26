// ============================================================
// business/ports — interface ที่ usecases ต้องการจากโลกภายนอก
// usecases รู้จักแค่ interface เหล่านี้ ไม่รู้ว่าข้างหลังเป็น PostgreSQL / Socket.IO / SMTP
// (repositories/ และ pkg/ เป็นผู้ implement)
// ============================================================
import type {
  Agent, Channel, Customer, Priority, Side, Ticket, TicketMessage, TicketPatch, TicketStatus,
} from './models/ticket';
import type { Conversation, ConversationSummary, ConversationType, ConvMessage, ConvMessageView } from './models/conversation';
import type { Stats } from './models/stats';

// ---------- Repositories ----------
export interface AgentRepository {
  list(): Promise<Agent[]>;
  get(id: string): Promise<Agent | null>;
}

export interface CustomerRepository {
  upsertByEmail(input: { name: string; email: string }): Promise<Customer>;
}

export interface TicketFilter {
  status?: TicketStatus;
  assigneeId?: string;
  q?: string;
}

export interface NewTicket {
  customerId: string;
  subject: string;
  category: string;
  channel: Channel;
  priority: Priority;
}

export interface NewTicketMessage {
  from: Side;
  senderId: string;
  senderName: string;
  text: string;
  internal: boolean;
}

export interface TicketRepository {
  create(input: NewTicket): Promise<Ticket>;
  /** ค้นด้วย id (uuid) หรือ number (TK-xxxx) */
  find(idOrNumber: string): Promise<Ticket | null>;
  list(filter?: TicketFilter): Promise<Ticket[]>;
  /** ticket ที่ SLA ยังเดินอยู่ (ไม่ใช่ pending / resolved / closed) */
  listSlaActive(): Promise<Ticket[]>;
  update(id: string, patch: TicketPatch): Promise<void>;
  addMessage(ticketId: string, msg: NewTicketMessage): Promise<TicketMessage>;
  addEvent(ticketId: string, type: string, detail: string, by?: string): Promise<void>;
  /** ผู้รับฝั่ง recipient ได้รับ / อ่านข้อความแล้ว → คืนข้อความที่สถานะเปลี่ยน */
  markMessages(ticketId: string, recipient: Side, level: 'delivered' | 'read', onlyIds?: string[]): Promise<TicketMessage[]>;
  /** จำนวน ticket ที่ยังไม่ปิดของแต่ละ agent */
  openCountByAssignee(): Promise<Record<string, number>>;
}

export interface ConversationRepository {
  listForAgent(agentId: string): Promise<ConversationSummary[]>;
  find(id: string): Promise<Conversation | null>;
  findDirect(a: string, b: string): Promise<Conversation | null>;
  create(input: { type: ConversationType; name: string | null; createdBy: string; members: string[] }): Promise<Conversation>;
  updateMembers(id: string, add: string[], remove: string[]): Promise<Conversation>;
  addMessage(conversationId: string, sender: { id: string; name: string }, text: string): Promise<ConvMessage>;
  messages(conversationId: string, opts: { before?: string; limit: number }): Promise<{ messages: ConvMessage[]; hasMore: boolean }>;
  /** agent ได้รับ / อ่านข้อความแล้ว → คืนข้อความที่เปลี่ยน */
  mark(conversationId: string, agentId: string, level: 'delivered' | 'read', onlyIds?: string[]): Promise<ConvMessage[]>;
  /** ห้องที่มีข้อความค้างส่งถึง agent คนนี้ (ส่งมาตอน offline) */
  pendingFor(agentId: string): Promise<string[]>;
}

export interface StatsRepository {
  snapshot(now: Date): Promise<Stats>;
}

// ---------- Services ----------
export type TicketChangeKind = 'new' | 'updated' | 'escalated' | 'sla_warning';

export interface Alert {
  type: string;
  ticketId: string;
  text: string;
}

/** ช่องทางแจ้งเหตุการณ์แบบ realtime (implement ด้วย Socket.IO ใน api/socket) */
export interface Notifier {
  ticketChanged(ticket: Ticket, kind: TicketChangeKind): void;
  ticketMessage(ticket: Ticket, message: TicketMessage): void;
  ticketMessageStatus(ticket: Ticket, changed: TicketMessage[]): void;
  alertAgent(agentId: string | null, alert: Alert): void;
  alertAllAgents(alert: Alert): void;
  convMessage(agentId: string, payload: { convId: string; title: string; message: ConvMessageView }): void;
  convStatus(agentId: string, payload: { convId: string; message: ConvMessageView }): void;
  convUpdated(agentIds: string[], convId: string): void;
}

export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}

export interface Presence {
  isOnline(agentId: string): boolean;
  onlineIds(): string[];
}

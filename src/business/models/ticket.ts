// ============================================================
// business/models — โครงสร้างข้อมูลและกฎที่ไม่ขึ้นกับ DB / HTTP
// ============================================================

export const STATUSES = ['open', 'in_progress', 'pending', 'resolved', 'closed'] as const;
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const CHANNELS = ['web', 'mobile', 'email', 'chat'] as const;

export type TicketStatus = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Channel = (typeof CHANNELS)[number];
export type Side = 'customer' | 'agent';
export type DeliveryStatus = 'sent' | 'delivered' | 'read';

export const isStatus = (v: unknown): v is TicketStatus => STATUSES.includes(v as TicketStatus);
export const isPriority = (v: unknown): v is Priority => PRIORITIES.includes(v as Priority);
export const isChannel = (v: unknown): v is Channel => CHANNELS.includes(v as Channel);

export const CLOSED_STATUSES: TicketStatus[] = ['resolved', 'closed'];
export const isClosed = (s: TicketStatus) => CLOSED_STATUSES.includes(s);

export interface Agent {
  id: string;
  name: string;
  role: 'agent' | 'supervisor';
  team: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface TicketMessage {
  id: string;
  from: Side;
  senderId: string;
  senderName: string;
  text: string;
  internal: boolean;
  at: string;
  status: DeliveryStatus;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface TicketEvent {
  id: string;
  type: string;
  detail: string;
  by: string;
  at: string;
}

export interface Ticket {
  id: string;
  number: string;
  subject: string;
  category: string;
  channel: Channel;
  priority: Priority;
  status: TicketStatus;
  customerId: string;
  customerName: string;
  customerEmail: string;
  assigneeId: string | null;
  /** join จากตาราง agents */
  assigneeName: string | null;
  escalated: boolean;
  escalationLevel: number;
  slaWarned: boolean;
  slaDueAt: string | null;
  slaResetAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
  events: TicketEvent[];
}

/** ฟิลด์ที่แก้ไขได้ผ่าน repository.update */
export type TicketPatch = Partial<
  Pick<
    Ticket,
    | 'status' | 'priority' | 'assigneeId' | 'escalated' | 'escalationLevel' | 'slaWarned'
    | 'slaDueAt' | 'slaResetAt' | 'firstResponseAt' | 'resolvedAt'
  >
>;

/** เพิ่ม priority ขึ้นหนึ่งระดับ (สูงสุด urgent) — ใช้ตอน escalate */
export function bumpPriority(p: Priority): Priority {
  const i = PRIORITIES.indexOf(p);
  return PRIORITIES[Math.min(i + 1, PRIORITIES.length - 1)];
}

/** หา ticket number จากหัวข้ออีเมล เช่น "Re: [TK-1002] บิลผิด" → "TK-1002" */
export function ticketNumberFromSubject(subject: string): string | null {
  const m = subject.match(/\[(TK-\d+)\]/);
  return m ? m[1] : null;
}

export const isValidEmail = (email: unknown): email is string =>
  typeof email === 'string' && /^\S+@\S+\.\S+$/.test(email);

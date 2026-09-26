import type { DeliveryStatus } from './ticket';

export type ConversationType = 'direct' | 'group';

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  members: string[];
  createdBy: string;
  createdAt: string;
}

export interface ConversationSummary extends Conversation {
  updatedAt: string;
  lastMessage: { text: string; senderName: string; at: string } | null;
  unread: number;
}

export interface ConvMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string;
  at: string;
  /** agentId → เวลาที่ได้รับ / อ่าน */
  deliveredTo: Record<string, string>;
  readBy: Record<string, string>;
}

/** มุมมองข้อความที่ส่งให้หน้าเว็บ */
export interface ConvMessageView {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  at: string;
  status: DeliveryStatus;
  deliveredCount: number;
  readCount: number;
  recipients: number;
}

/** สถานะรวมของข้อความใน 1:1 / group: ทุกคนอ่าน = read, ทุกคนได้รับ = delivered */
export function convMessageStatus(members: string[], m: ConvMessage): DeliveryStatus {
  const others = members.filter((id) => id !== m.senderId);
  if (!others.length) return 'read';
  if (others.every((id) => m.readBy[id])) return 'read';
  if (others.every((id) => m.deliveredTo[id])) return 'delivered';
  return 'sent';
}

export function toConvMessageView(members: string[], m: ConvMessage): ConvMessageView {
  const others = members.filter((id) => id !== m.senderId);
  return {
    id: m.id,
    senderId: m.senderId,
    senderName: m.senderName,
    text: m.text,
    at: m.at,
    status: convMessageStatus(members, m),
    deliveredCount: others.filter((id) => m.deliveredTo[id]).length,
    readCount: others.filter((id) => m.readBy[id]).length,
    recipients: others.length,
  };
}

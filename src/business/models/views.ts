// มุมมองข้อมูลที่ส่งให้ลูกค้า — ซ่อน internal note และ timeline ภายใน
import type { Ticket, TicketMessage } from './ticket';

export interface CustomerTicketView {
  id: string;
  number: string;
  subject: string;
  status: Ticket['status'];
  priority: Ticket['priority'];
  channel: Ticket['channel'];
  createdAt: string;
  agentName: string | null;
  messages: TicketMessage[];
}

export function toCustomerView(t: Ticket): CustomerTicketView {
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    channel: t.channel,
    createdAt: t.createdAt,
    agentName: t.assigneeName,
    messages: t.messages.filter((m) => !m.internal),
  };
}

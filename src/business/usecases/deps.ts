import type {
  AgentRepository, ConversationRepository, CustomerRepository, Mailer, Notifier, Presence,
  StatsRepository, TicketRepository,
} from '../ports';
import type { Clock } from '../../pkg/utils/time';

/** ทุกอย่างที่ usecases ต้องใช้ — ประกอบเข้ามาจาก cmd/server.ts (dependency injection) */
export interface Deps {
  agents: AgentRepository;
  customers: CustomerRepository;
  tickets: TicketRepository;
  conversations: ConversationRepository;
  stats: StatsRepository;
  notifier: Notifier;
  mailer: Mailer;
  presence: Presence;
  clock: Clock;
  /** 1 "นาที" ของ SLA = กี่ ms (SLA_DEMO ทำให้เป็น 1 วินาที) */
  slaUnitMs: number;
}

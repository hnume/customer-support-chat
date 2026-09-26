import type { Db } from '../pkg/db/client';
import { PgAgentRepository } from './agentRepo';
import { PgConversationRepository } from './conversationRepo';
import { PgCustomerRepository } from './customerRepo';
import { PgStatsRepository } from './statsRepo';
import { PgTicketRepository } from './ticketRepo';

export function makeRepositories(db: Db) {
  return {
    agents: new PgAgentRepository(db),
    customers: new PgCustomerRepository(db),
    tickets: new PgTicketRepository(db),
    conversations: new PgConversationRepository(db),
    stats: new PgStatsRepository(db),
  };
}

import { SLA_POLICY } from '../models/slaPolicy';
import { makeAgentUseCases } from './agents';
import { makeConversationUseCases } from './conversations';
import type { Deps } from './deps';
import { makeTicketUseCases } from './tickets';

export function makeUseCases(d: Deps) {
  return {
    agents: makeAgentUseCases(d),
    tickets: makeTicketUseCases(d),
    conversations: makeConversationUseCases(d),
    stats: { snapshot: () => d.stats.snapshot(d.clock()) },
    sla: { policy: () => ({ policy: SLA_POLICY, demoMode: d.slaUnitMs < 60_000 }) },
  };
}
export type UseCases = ReturnType<typeof makeUseCases>;
export type { Deps };

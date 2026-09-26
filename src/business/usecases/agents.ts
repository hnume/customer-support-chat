import type { Agent } from '../models/ticket';
import { unauthorized } from '../models/errors';
import type { Deps } from './deps';

export function makeAgentUseCases(d: Pick<Deps, 'agents' | 'presence'>) {
  return {
    async listWithPresence(): Promise<(Agent & { online: boolean })[]> {
      return (await d.agents.list()).map((a) => ({ ...a, online: d.presence.isOnline(a.id) }));
    },

    /** ตรวจว่า id นี้เป็น agent จริง (เดโม: ส่งมาทาง header — production ใช้ JWT / Keycloak) */
    async authenticate(agentId: string | undefined): Promise<Agent> {
      const agent = agentId ? await d.agents.get(agentId) : null;
      if (!agent) throw unauthorized('ต้องเข้าสู่ระบบในฐานะ agent');
      return agent;
    },
  };
}
export type AgentUseCases = ReturnType<typeof makeAgentUseCases>;

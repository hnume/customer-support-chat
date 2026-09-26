import type { Agent } from '../models/ticket';
import type { Deps } from './deps';

/**
 * Auto-assign: เลือก agent (role = agent) ที่ online และมีงานค้างน้อยที่สุด
 * ถ้าไม่มีใคร online เลย ให้เลือกจากทุกคน
 */
export async function pickAgent(d: Pick<Deps, 'agents' | 'tickets' | 'presence'>): Promise<Agent | null> {
  const all = (await d.agents.list()).filter((a) => a.role === 'agent');
  const online = all.filter((a) => d.presence.isOnline(a.id));
  const candidates = online.length ? online : all;
  if (!candidates.length) return null;
  const load = await d.tickets.openCountByAssignee();
  return [...candidates].sort((a, b) => (load[a.id] ?? 0) - (load[b.id] ?? 0))[0];
}

export async function findSupervisor(d: Pick<Deps, 'agents'>): Promise<Agent | null> {
  return (await d.agents.list()).find((a) => a.role === 'supervisor') ?? null;
}

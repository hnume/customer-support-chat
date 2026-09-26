import type { Db } from '../pkg/db/client';
import type { Agent } from '../business/models/ticket';
import type { AgentRepository } from '../business/ports';

export class PgAgentRepository implements AgentRepository {
  constructor(private db: Db) {}

  list(): Promise<Agent[]> {
    return this.db.query<Agent>('SELECT id, name, role, team FROM agents ORDER BY role, id');
  }

  async get(id: string): Promise<Agent | null> {
    const [a] = await this.db.query<Agent>('SELECT id, name, role, team FROM agents WHERE id = $1', [id]);
    return a ?? null;
  }
}

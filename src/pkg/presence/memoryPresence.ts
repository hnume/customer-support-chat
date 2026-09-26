// pkg/presence — เก็บว่า agent คนไหน online (นับจำนวน socket ต่อคน)
import type { Presence } from '../../business/ports';

export class MemoryPresence implements Presence {
  private counts = new Map<string, number>();

  connect(agentId: string): void {
    this.counts.set(agentId, (this.counts.get(agentId) ?? 0) + 1);
  }
  disconnect(agentId: string): void {
    const n = (this.counts.get(agentId) ?? 1) - 1;
    if (n <= 0) this.counts.delete(agentId);
    else this.counts.set(agentId, n);
  }
  isOnline(agentId: string): boolean {
    return this.counts.has(agentId);
  }
  onlineIds(): string[] {
    return [...this.counts.keys()];
  }
}

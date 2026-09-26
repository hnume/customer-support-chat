// ============================================================
// api/socket/handlers — รับ event จากหน้าเว็บ แล้วเรียก usecase
// ============================================================
import type { Server, Socket } from 'socket.io';
import type { UseCases } from '../../business/usecases';
import type { MemoryPresence } from '../../pkg/presence/memoryPresence';

const ids = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : undefined);

export function registerSocketHandlers(io: Server, uc: UseCases, presence: MemoryPresence) {
  const broadcastPresence = () => io.to('agents').emit('agents:presence', presence.onlineIds());

  io.on('connection', (socket: Socket) => {
    const agentId = (): string | undefined => socket.data.agentId;
    const side = () => (agentId() ? 'agent' : 'customer') as 'agent' | 'customer';
    // ลูกค้าแตะได้เฉพาะ ticket ที่ join ไว้
    const canAccess = (ticketId: string) => !!agentId() || socket.rooms.has(`ticket:${ticketId}:customer`);
    const safe = (fn: () => Promise<unknown>) => fn().catch((e) => console.error('[socket]', e));

    // ---------- Agent เข้าสู่ระบบ ----------
    socket.on('agent:online', ({ agentId: id } = {}) => safe(async () => {
      const agent = await uc.agents.authenticate(id).catch(() => null);
      if (!agent) return;
      socket.data.agentId = agent.id;
      socket.join(['agents', `agent:${agent.id}`]);
      presence.connect(agent.id);
      broadcastPresence();
      await uc.conversations.deliverPending(agent.id); // ข้อความที่ส่งมาตอน offline → delivered
    }));

    // ---------- เข้าห้องแชทของ ticket ----------
    socket.on('ticket:join', ({ ticketId } = {}) => safe(async () => {
      const t = await uc.tickets.resolveForJoin(String(ticketId ?? ''), !!agentId());
      if (!t) return;
      for (const r of socket.rooms) if (r.startsWith('ticket:')) socket.leave(r);
      socket.join([`ticket:${t.id}`, agentId() ? `ticket:${t.id}:agents` : `ticket:${t.id}:customer`]);
      await uc.tickets.markDelivered(t.id, side()); // เปิดห้อง = ได้รับข้อความที่ค้างอยู่
    }));

    socket.on('message:ack', ({ ticketId, messageIds } = {}) => safe(async () => {
      if (ticketId && canAccess(ticketId)) await uc.tickets.markDelivered(ticketId, side(), ids(messageIds));
    }));

    socket.on('ticket:read', ({ ticketId } = {}) => safe(async () => {
      if (ticketId && canAccess(ticketId)) await uc.tickets.markRead(ticketId, side());
    }));

    socket.on('typing', ({ ticketId, name, isTyping } = {}) => {
      if (ticketId && canAccess(ticketId)) socket.to(`ticket:${ticketId}`).emit('typing', { ticketId, name, isTyping });
    });

    // ---------- Team chat ----------
    socket.on('conv:ack', ({ convId, messageIds } = {}) => safe(async () => {
      const me = agentId();
      if (me && convId) await uc.conversations.markDelivered(me, convId, ids(messageIds));
    }));

    socket.on('conv:read', ({ convId } = {}) => safe(async () => {
      const me = agentId();
      if (me && convId) await uc.conversations.markRead(me, convId);
    }));

    socket.on('conv:typing', ({ convId, isTyping } = {}) => safe(async () => {
      const me = agentId();
      if (!me || !convId) return;
      const agent = await uc.agents.authenticate(me);
      for (const id of await uc.conversations.otherMembers(me, convId)) {
        io.to(`agent:${id}`).emit('conv:typing', { convId, name: agent.name, isTyping });
      }
    }));

    socket.on('disconnect', () => {
      const me = agentId();
      if (!me) return;
      presence.disconnect(me);
      broadcastPresence();
    });
  });
}

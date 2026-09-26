// ============================================================
// api/socket/socketNotifier — implement Notifier ด้วย Socket.IO
// รู้เรื่อง "ห้อง" ทั้งหมด usecases จึงไม่ต้องรู้จัก Socket.IO
//   agents                → agent ทุกคน
//   agent:<id>            → agent คนนั้น (ทุกแท็บ)
//   ticket:<id>:agents    → agent ที่เปิด ticket นี้อยู่
//   ticket:<id>:customer  → ลูกค้าเจ้าของ ticket
// ============================================================
import type { Server } from 'socket.io';
import { toCustomerView } from '../../business/models/views';
import type { Notifier } from '../../business/ports';

export function createSocketNotifier(io: Server): Notifier {
  return {
    ticketChanged(t, kind) {
      io.to('agents').emit('ticket:updated', { kind, ticket: t });
      io.to(`ticket:${t.id}:customer`).emit('ticket:status', toCustomerView(t));
    },

    ticketMessage(t, m) {
      const agentRooms = [`ticket:${t.id}:agents`];
      if (m.from === 'customer' && t.assigneeId) agentRooms.push(`agent:${t.assigneeId}`);
      io.to(agentRooms).emit('message:new', { ticketId: t.id, message: m });
      if (!m.internal) io.to(`ticket:${t.id}:customer`).emit('message:new', { ticketId: t.id, message: m });
    },

    ticketMessageStatus(t, changed) {
      const updates = changed.map((m) => ({ id: m.id, status: m.status, deliveredAt: m.deliveredAt, readAt: m.readAt }));
      const rooms = [`ticket:${t.id}:agents`, `ticket:${t.id}:customer`];
      if (t.assigneeId) rooms.push(`agent:${t.assigneeId}`);
      io.to(rooms).emit('message:status', { ticketId: t.id, updates });
    },

    alertAgent(agentId, alert) {
      if (agentId) io.to(`agent:${agentId}`).emit('notify', alert);
    },

    alertAllAgents(alert) {
      io.to('agents').emit('notify', alert);
    },

    convMessage(agentId, payload) {
      io.to(`agent:${agentId}`).emit('conv:message', payload);
    },

    convStatus(agentId, payload) {
      io.to(`agent:${agentId}`).emit('conv:status', payload);
    },

    convUpdated(agentIds, convId) {
      for (const id of agentIds) io.to(`agent:${id}`).emit('conv:updated', { convId });
    },
  };
}

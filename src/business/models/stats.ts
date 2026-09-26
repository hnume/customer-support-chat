export interface Stats {
  messaging: {
    totalMessages: number;
    messagesToday: number;
    messagesPerDay: Record<string, number>;
    avgDeliveryLatencySec: number;
    avgTimeToReadSec: number;
    pendingDelivery: number;
    deliveredRate: number;
    activeConversations: number;
  };
  total: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  byPriority: Record<string, number>;
  escalated: number;
  slaBreached: number;
  slaComplianceRate: number;
  avgFirstResponseMin: number;
  agentLoad: { id: string; name: string; open: number }[];
}

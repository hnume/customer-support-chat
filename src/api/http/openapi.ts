// ============================================================
// OpenAPI 3 spec — แสดงผลด้วย Swagger UI ที่ /api/docs
// JSON ดิบอยู่ที่ /api/openapi.json (import เข้า Postman / Insomnia ได้)
// ============================================================
import { CHANNELS, PRIORITIES, STATUSES } from '../../business/models/ticket';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object, example?: unknown) => ({
  'application/json': { schema, ...(example !== undefined ? { example } : {}) },
});
const ok = (description: string, schema: object) => ({ description, content: json(schema) });
const err = (description: string) => ({ description, content: json(ref('Error'), { error: description }) });
const agentAuth = [{ AgentId: [] }];
const idParam = (description: string) => ({
  name: 'id', in: 'path', required: true, description, schema: { type: 'string' },
});

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Customer Support Chat System API',
    version: '2.0.0',
    description:
      'REST API ของระบบบริการลูกค้า — ticket, แชท, SLA escalation และ Team chat\n\n' +
      '**Agent API** ต้องกดปุ่ม **Authorize** แล้วใส่รหัส agent: `a1`, `a2`, `a3` หรือ `s1` (หัวหน้าทีม)\n\n' +
      'เหตุการณ์ realtime (ข้อความใหม่, สถานะ ✓✓, แจ้งเตือน SLA) ส่งผ่าน Socket.IO — ดูตารางใน README',
  },
  servers: [{ url: '/api' }],
  tags: [
    { name: 'Customer', description: 'ฝั่งลูกค้า (ไม่ต้อง login)' },
    { name: 'Email', description: 'Webhook รับอีเมลเข้า' },
    { name: 'Tickets', description: 'ฝั่ง agent: จัดการ ticket' },
    { name: 'Team chat', description: 'แชท 1:1 และ Group ระหว่าง agent' },
    { name: 'Meta', description: 'ข้อมูลประกอบ / สถิติ' },
  ],
  components: {
    securitySchemes: {
      AgentId: { type: 'apiKey', in: 'header', name: 'x-agent-id', description: 'เดโม: รหัส agent (a1, a2, a3, s1)' },
    },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' } } },
      Agent: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'a1' },
          name: { type: 'string', example: 'สมชาย (Agent)' },
          role: { type: 'string', enum: ['agent', 'supervisor'] },
          team: { type: 'string', example: 'L1' },
          online: { type: 'boolean' },
        },
      },
      TicketMessage: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          from: { type: 'string', enum: ['customer', 'agent'] },
          senderId: { type: 'string' },
          senderName: { type: 'string' },
          text: { type: 'string' },
          internal: { type: 'boolean', description: 'internal note — ลูกค้ามองไม่เห็น' },
          at: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['sent', 'delivered', 'read'] },
          deliveredAt: { type: 'string', format: 'date-time', nullable: true },
          readAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      TicketEvent: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { type: 'string', example: 'escalated' },
          detail: { type: 'string' },
          by: { type: 'string' },
          at: { type: 'string', format: 'date-time' },
        },
      },
      Ticket: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          number: { type: 'string', example: 'TK-1001' },
          subject: { type: 'string' },
          category: { type: 'string' },
          channel: { type: 'string', enum: [...CHANNELS] },
          priority: { type: 'string', enum: [...PRIORITIES] },
          status: { type: 'string', enum: [...STATUSES] },
          customerId: { type: 'string', format: 'uuid' },
          customerName: { type: 'string' },
          customerEmail: { type: 'string' },
          assigneeId: { type: 'string', nullable: true },
          assigneeName: { type: 'string', nullable: true },
          escalated: { type: 'boolean' },
          escalationLevel: { type: 'integer' },
          slaWarned: { type: 'boolean' },
          slaDueAt: { type: 'string', format: 'date-time', nullable: true },
          firstResponseAt: { type: 'string', format: 'date-time', nullable: true },
          resolvedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          messages: { type: 'array', items: ref('TicketMessage') },
          events: { type: 'array', items: ref('TicketEvent') },
        },
      },
      CustomerTicket: {
        type: 'object',
        description: 'มุมมองของลูกค้า — ไม่มี internal note และ timeline ภายใน',
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ใช้เป็น secret ในการเข้าดู ticket' },
          number: { type: 'string', example: 'TK-1001' },
          subject: { type: 'string' },
          status: { type: 'string', enum: [...STATUSES] },
          priority: { type: 'string', enum: [...PRIORITIES] },
          channel: { type: 'string', enum: [...CHANNELS] },
          createdAt: { type: 'string', format: 'date-time' },
          agentName: { type: 'string', nullable: true },
          messages: { type: 'array', items: ref('TicketMessage') },
        },
      },
      NewTicket: {
        type: 'object',
        required: ['email'],
        properties: {
          name: { type: 'string', example: 'คุณเอ' },
          email: { type: 'string', format: 'email', example: 'a@example.com' },
          subject: { type: 'string', example: 'เข้าสู่ระบบไม่ได้' },
          message: { type: 'string', example: 'กดล็อกอินแล้วขึ้น error 500' },
          priority: { type: 'string', enum: [...PRIORITIES], default: 'normal' },
          category: { type: 'string', example: 'technical', default: 'general' },
          channel: { type: 'string', enum: [...CHANNELS], default: 'web' },
        },
      },
      TextBody: {
        type: 'object', required: ['text'], properties: { text: { type: 'string', example: 'สวัสดีครับ' } },
      },
      ConvMessage: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          senderId: { type: 'string' },
          senderName: { type: 'string' },
          text: { type: 'string' },
          at: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['sent', 'delivered', 'read'], description: 'ทุกคนอ่าน = read, ทุกคนได้รับ = delivered' },
          deliveredCount: { type: 'integer' },
          readCount: { type: 'integer' },
          recipients: { type: 'integer' },
        },
      },
      Conversation: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { type: 'string', enum: ['direct', 'group'] },
          name: { type: 'string', nullable: true },
          title: { type: 'string', description: 'ชื่อที่แสดง (1:1 = ชื่อคู่สนทนา)' },
          members: { type: 'array', items: { type: 'string' } },
          createdBy: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          unread: { type: 'integer' },
          lastMessage: {
            type: 'object', nullable: true,
            properties: { text: { type: 'string' }, senderName: { type: 'string' }, at: { type: 'string', format: 'date-time' } },
          },
        },
      },
      Stats: {
        type: 'object',
        description: 'ตัวเลข dashboard และ Business questions',
        properties: {
          total: { type: 'integer' },
          byStatus: { type: 'object', additionalProperties: { type: 'integer' } },
          byChannel: { type: 'object', additionalProperties: { type: 'integer' } },
          byPriority: { type: 'object', additionalProperties: { type: 'integer' } },
          escalated: { type: 'integer' },
          slaBreached: { type: 'integer' },
          slaComplianceRate: { type: 'integer', description: '%' },
          avgFirstResponseMin: { type: 'number' },
          agentLoad: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, open: { type: 'integer' } } } },
          messaging: {
            type: 'object',
            properties: {
              totalMessages: { type: 'integer' },
              messagesToday: { type: 'integer' },
              messagesPerDay: { type: 'object', additionalProperties: { type: 'integer' } },
              avgDeliveryLatencySec: { type: 'number' },
              avgTimeToReadSec: { type: 'number' },
              pendingDelivery: { type: 'integer' },
              deliveredRate: { type: 'integer', description: '%' },
              activeConversations: { type: 'integer' },
            },
          },
        },
      },
    },
  },
  paths: {
    // ---------------- Customer ----------------
    '/tickets': {
      post: {
        tags: ['Customer'],
        summary: 'ลูกค้าแจ้งปัญหา (สร้าง ticket + auto-assign)',
        requestBody: { required: true, content: json(ref('NewTicket')) },
        responses: { 201: ok('สร้างแล้ว', ref('CustomerTicket')), 400: err('ข้อมูลไม่ครบ / อีเมลไม่ถูกต้อง') },
      },
      get: {
        tags: ['Tickets'],
        summary: 'รายการ ticket',
        security: agentAuth,
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: [...STATUSES] } },
          { name: 'assigneeId', in: 'query', description: 'เช่น a1', schema: { type: 'string' } },
          { name: 'q', in: 'query', description: 'ค้นหาเลข ticket / หัวข้อ / ชื่อ / อีเมล', schema: { type: 'string' } },
        ],
        responses: { 200: ok('OK', { type: 'array', items: ref('Ticket') }), 401: err('ไม่ได้ Authorize') },
      },
    },
    '/public/tickets/{id}': {
      get: {
        tags: ['Customer'],
        summary: 'ลูกค้าดู ticket ของตัวเอง',
        parameters: [idParam('uuid ของ ticket (ได้ตอนสร้าง)')],
        responses: { 200: ok('OK', ref('CustomerTicket')), 404: err('ไม่พบ') },
      },
    },
    '/public/tickets/{id}/messages': {
      post: {
        tags: ['Customer'],
        summary: 'ลูกค้าส่งข้อความ (ticket ที่ปิดแล้วจะถูกเปิดใหม่)',
        parameters: [idParam('uuid ของ ticket')],
        requestBody: { required: true, content: json(ref('TextBody')) },
        responses: { 201: ok('ส่งแล้ว', ref('TicketMessage')), 400: err('ข้อความว่าง'), 404: err('ไม่พบ') },
      },
    },
    // ---------------- Email ----------------
    '/inbound/email': {
      post: {
        tags: ['Email'],
        summary: 'รับอีเมลเข้า — หัวข้อมี [TK-xxxx] จะต่อเข้า ticket เดิม',
        requestBody: {
          required: true,
          content: json(
            {
              type: 'object', required: ['from'],
              properties: { from: { type: 'string' }, name: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
            },
            { from: 'b@example.com', name: 'คุณบี', subject: 'บิลผิด', body: 'ยอดเงินไม่ตรง' }
          ),
        },
        responses: {
          200: ok('ต่อเข้า ticket เดิม', { type: 'object', properties: { ticket: { type: 'string' }, appended: { type: 'boolean' } } }),
          201: ok('สร้าง ticket ใหม่', { type: 'object', properties: { ticket: { type: 'string' }, appended: { type: 'boolean' } } }),
          400: err('ไม่มี from'),
        },
      },
    },
    // ---------------- Tickets (agent) ----------------
    '/tickets/{id}': {
      get: {
        tags: ['Tickets'],
        summary: 'รายละเอียด ticket (พร้อมข้อความและ timeline)',
        security: agentAuth,
        parameters: [idParam('uuid หรือเลข ticket เช่น TK-1001')],
        responses: { 200: ok('OK', ref('Ticket')), 401: err('ไม่ได้ Authorize'), 404: err('ไม่พบ') },
      },
      patch: {
        tags: ['Tickets'],
        summary: 'เปลี่ยนสถานะ / priority / ผู้รับผิดชอบ',
        security: agentAuth,
        parameters: [idParam('uuid หรือ TK-xxxx')],
        requestBody: {
          required: true,
          content: json(
            {
              type: 'object',
              properties: {
                status: { type: 'string', enum: [...STATUSES] },
                priority: { type: 'string', enum: [...PRIORITIES] },
                assigneeId: { type: 'string', nullable: true, description: 'null = ยกเลิกการมอบหมาย' },
              },
            },
            { status: 'in_progress', assigneeId: 'a2' }
          ),
        },
        responses: { 200: ok('OK', ref('Ticket')), 400: err('ค่าไม่ถูกต้อง'), 401: err('ไม่ได้ Authorize'), 404: err('ไม่พบ') },
      },
    },
    '/tickets/{id}/messages': {
      post: {
        tags: ['Tickets'],
        summary: 'agent ตอบลูกค้า หรือเขียน internal note',
        security: agentAuth,
        parameters: [idParam('uuid หรือ TK-xxxx')],
        requestBody: {
          required: true,
          content: json(
            { type: 'object', required: ['text'], properties: { text: { type: 'string' }, internal: { type: 'boolean', default: false } } },
            { text: 'ลองล้าง cache แล้วเข้าใหม่ได้ไหมครับ', internal: false }
          ),
        },
        responses: { 201: ok('ส่งแล้ว', ref('TicketMessage')), 400: err('ข้อความว่าง'), 401: err('ไม่ได้ Authorize'), 404: err('ไม่พบ') },
      },
    },
    '/tickets/{id}/escalate': {
      post: {
        tags: ['Tickets'],
        summary: 'Escalate ให้หัวหน้าทีม (เพิ่ม priority + เริ่มนับ SLA ใหม่)',
        security: agentAuth,
        parameters: [idParam('uuid หรือ TK-xxxx')],
        requestBody: { content: json({ type: 'object', properties: { reason: { type: 'string' } } }, { reason: 'ต้องการผู้เชี่ยวชาญ L2' }) },
        responses: { 200: ok('OK', ref('Ticket')), 401: err('ไม่ได้ Authorize'), 404: err('ไม่พบ') },
      },
    },
    // ---------------- Team chat ----------------
    '/conversations': {
      get: {
        tags: ['Team chat'],
        summary: 'ห้องแชทของฉัน (พร้อมจำนวนที่ยังไม่อ่าน)',
        security: agentAuth,
        responses: { 200: ok('OK', { type: 'array', items: ref('Conversation') }), 401: err('ไม่ได้ Authorize') },
      },
      post: {
        tags: ['Team chat'],
        summary: 'สร้างห้อง 1:1 (ไม่สร้างซ้ำ) หรือ Group',
        security: agentAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object', required: ['type', 'memberIds'],
                properties: {
                  type: { type: 'string', enum: ['direct', 'group'] },
                  name: { type: 'string', description: 'จำเป็นสำหรับ group' },
                  memberIds: { type: 'array', items: { type: 'string' } },
                },
              },
              examples: {
                direct: { summary: 'แชท 1:1', value: { type: 'direct', memberIds: ['a2'] } },
                group: { summary: 'Group', value: { type: 'group', name: 'ทีม L1', memberIds: ['a2', 'a3'] } },
              },
            },
          },
        },
        responses: { 201: ok('สร้างแล้ว', ref('Conversation')), 400: err('ข้อมูลไม่ถูกต้อง'), 401: err('ไม่ได้ Authorize') },
      },
    },
    '/conversations/{id}/messages': {
      get: {
        tags: ['Team chat'],
        summary: 'ประวัติการสนทนา (โหลดย้อนหลังด้วย before)',
        security: agentAuth,
        parameters: [
          idParam('uuid ของห้อง'),
          { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
        responses: {
          200: ok('OK', {
            type: 'object',
            properties: {
              id: { type: 'string' }, type: { type: 'string' }, title: { type: 'string' }, hasMore: { type: 'boolean' },
              members: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, online: { type: 'boolean' } } } },
              messages: { type: 'array', items: ref('ConvMessage') },
            },
          }),
          401: err('ไม่ได้ Authorize'), 404: err('ไม่พบ / ไม่ใช่สมาชิก'),
        },
      },
      post: {
        tags: ['Team chat'],
        summary: 'ส่งข้อความ (ส่งได้แม้ผู้รับ offline)',
        security: agentAuth,
        parameters: [idParam('uuid ของห้อง')],
        requestBody: { required: true, content: json(ref('TextBody')) },
        responses: { 201: ok('ส่งแล้ว', ref('ConvMessage')), 400: err('ข้อความว่าง'), 401: err('ไม่ได้ Authorize'), 404: err('ไม่พบ') },
      },
    },
    '/conversations/{id}/members': {
      post: {
        tags: ['Team chat'],
        summary: 'เพิ่ม / ลบสมาชิก group',
        security: agentAuth,
        parameters: [idParam('uuid ของห้อง')],
        requestBody: {
          required: true,
          content: json(
            { type: 'object', properties: { add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } } },
            { add: ['s1'], remove: ['a3'] }
          ),
        },
        responses: {
          200: ok('OK', { type: 'object', properties: { id: { type: 'string' }, members: { type: 'array', items: { type: 'string' } } } }),
          400: err('แก้ได้เฉพาะ group'), 401: err('ไม่ได้ Authorize'), 404: err('ไม่พบ'),
        },
      },
    },
    // ---------------- Meta ----------------
    '/agents': {
      get: { tags: ['Meta'], summary: 'รายชื่อ agent + สถานะ online', responses: { 200: ok('OK', { type: 'array', items: ref('Agent') }) } },
    },
    '/sla-policy': {
      get: {
        tags: ['Meta'],
        summary: 'SLA policy (นาที)',
        responses: { 200: ok('OK', { type: 'object', properties: { policy: { type: 'object' }, demoMode: { type: 'boolean' } } }) },
      },
    },
    '/stats': {
      get: { tags: ['Meta'], summary: 'สถิติ dashboard / Business questions', responses: { 200: ok('OK', ref('Stats')) } },
    },
  },
} as const;

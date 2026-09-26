# Customer Support Chat System

ระบบบริการลูกค้าแบบ real-time: ลูกค้าแจ้งปัญหา → สร้าง Ticket → กระจายงานให้ Agent → Agent ตอบ / เปลี่ยนสถานะ / assign / escalate เมื่อใกล้ผิด SLA
พร้อมระบบแชทที่มีสถานะข้อความ **sent / delivered / read**, ส่งหาคนที่ **offline** ได้ และ **Team chat แบบ 1:1 และ Group**

## วิธีรัน

```bash
npm install
npm start                 # http://localhost:3000
```

- หน้าลูกค้า: http://localhost:3000/
- Agent Dashboard: http://localhost:3000/agent.html (เปิดหลายแท็บแล้ว login คนละ agent เพื่อทดสอบ)

ทดสอบ SLA / escalate แบบเร็ว (เปลี่ยนหน่วยนาทีเป็นวินาที):

```bash
# macOS / Linux
SLA_DEMO=1 npm start
# Windows PowerShell
$env:SLA_DEMO=1; npm start
```

## Flow

```
Customer
   │ Submit issue
   ▼
Support Channel (Web / Mobile / Email / Chat)
   │
   ▼
Ticket Management ──► Auto-assign (agent ที่ online และมีงานน้อยสุด)
   │                        │
   │                        ▼
   │                  Customer Support Agent
   │                   ├─ ตอบลูกค้า (realtime) / Internal note
   │                   ├─ เปลี่ยนสถานะ open → in_progress → pending → resolved → closed
   │                   ├─ assign ให้คนอื่น
   │                   └─ escalate → Supervisor (L2)
   ▼
SLA Watcher ── เหลือ < 20% → เตือน ── เกินเวลา → escalate อัตโนมัติ + เพิ่ม priority
   ▼
Notification (Socket.IO toast / Email) + Analytics
```

## ฟีเจอร์

| กลุ่ม | รายละเอียด |
|---|---|
| Ticket | สร้างเลข `TK-xxxx`, หมวดหมู่, priority, สถานะ, timeline ของทุก event |
| Channel | Web / Mobile / Chat จากฟอร์ม, Email ผ่าน webhook `/api/inbound/email` (ตอบอีเมลที่หัวข้อมี `[TK-xxxx]` จะต่อเข้า ticket เดิม) |
| Assign | Auto-assign แบบ least-load, รับงานเอง, โอนงาน |
| SLA | ตอบครั้งแรก / แก้ไขเสร็จ แยกตาม priority, หยุดนับตอน `pending`, เริ่มรอบใหม่หลัง escalate |
| Escalation | Manual หรืออัตโนมัติเมื่อผิด SLA → ส่งให้ Supervisor + เพิ่ม priority |
| Chat | Realtime, typing indicator, internal note (ลูกค้าไม่เห็น), ลูกค้าตอบ ticket ที่ปิดแล้ว = เปิดใหม่ |
| สถานะข้อความ | ✓ sent → ✓✓ delivered (ผู้รับได้รับ) → ✓✓ read (ผู้รับเปิดอ่าน) |
| Offline | ข้อความถูกเก็บไว้ เมื่ออีกฝ่ายกลับมา online จะได้รับและสถานะเปลี่ยนเป็น delivered |
| Team chat | แชท 1:1 (ไม่สร้างห้องซ้ำ), Group chat + เพิ่ม/ลบสมาชิก, แสดงจำนวนคนอ่าน (เช่น 2/3), ประวัติย้อนหลัง |
| Analytics | `/api/stats` |

## SLA Policy (นาที) — แก้ได้ที่ `src/sla.js`

| Priority | ตอบครั้งแรก | แก้ไขเสร็จ |
|---|---|---|
| urgent | 15 | 240 |
| high | 60 | 480 |
| normal | 240 | 1440 |
| low | 1440 | 4320 |

## Business questions → Metrics (`GET /api/stats`)

| คำถาม | ฟิลด์ |
|---|---|
| มีข้อความถูกส่งกี่ข้อความต่อวัน? | `messaging.messagesPerDay`, `messaging.messagesToday` |
| ห้องไหน active? | `messaging.activeConversations` |
| Message delivery latency เท่าไร? | `messaging.avgDeliveryLatencySec` |
| กี่ % ที่ยังส่งไม่ถึง? | `messaging.deliveredRate`, `messaging.pendingDelivery` |
| ผู้ใช้อ่านข้อความหลังได้รับเฉลี่ยกี่วินาที? | `messaging.avgTimeToReadSec` |
| ทำตาม SLA ได้กี่ %? ตอบครั้งแรกเฉลี่ยกี่นาที? | `slaComplianceRate`, `avgFirstResponseMin` |
| งานกระจายตัวอย่างไร? | `agentLoad`, `byStatus`, `byChannel`, `byPriority` |

## REST API

ฝั่ง agent ต้องส่ง header `x-agent-id` (เดโม — production ให้เปลี่ยนเป็น JWT/Keycloak ที่ `requireAgent` ใน `server.js`)

| Method | Path | ใช้ทำอะไร |
|---|---|---|
| POST | `/api/tickets` | ลูกค้าแจ้งปัญหา `{name,email,subject,message,priority,category,channel}` |
| POST | `/api/inbound/email` | Email webhook `{from,name,subject,body}` |
| GET | `/api/public/tickets/:id` | ลูกค้าดู ticket ของตัวเอง |
| POST | `/api/public/tickets/:id/messages` | ลูกค้าส่งข้อความ |
| GET | `/api/tickets?status=&assigneeId=&q=` | agent ดูรายการ ticket |
| POST | `/api/tickets/:id/messages` | agent ตอบ `{text, internal}` |
| PATCH | `/api/tickets/:id` | เปลี่ยน `status` / `priority` / `assigneeId` |
| POST | `/api/tickets/:id/escalate` | escalate `{reason}` |
| GET/POST | `/api/conversations` | รายการห้อง / สร้าง `{type:'direct'|'group', name, memberIds}` |
| GET | `/api/conversations/:id/messages?before=&limit=` | ประวัติการสนทนา |
| POST | `/api/conversations/:id/messages` | ส่งข้อความ team chat |
| POST | `/api/conversations/:id/members` | `{add:[], remove:[]}` |
| GET | `/api/stats`, `/api/agents`, `/api/sla-policy` | ข้อมูลประกอบ |

## Socket.IO Events

| ทิศทาง | Event | ความหมาย |
|---|---|---|
| client → server | `agent:online` | agent เข้าระบบ (และรับข้อความที่ค้างตอน offline) |
| client → server | `ticket:join` | เข้าห้องแชทของ ticket |
| client → server | `message:ack` / `ticket:read` | แจ้งว่าได้รับ / อ่านแล้ว |
| client → server | `conv:ack` / `conv:read` / `conv:typing` | เหมือนกันสำหรับ team chat |
| server → client | `message:new`, `message:status` | ข้อความใหม่ / สถานะเปลี่ยน |
| server → client | `ticket:updated`, `ticket:status` | ticket เปลี่ยน (agent / ลูกค้า) |
| server → client | `conv:message`, `conv:status`, `conv:updated` | team chat |
| server → client | `notify`, `agents:presence`, `typing` | แจ้งเตือน / ใคร online / กำลังพิมพ์ |

## โครงสร้างไฟล์

```
server.js          REST API + Socket.IO + business logic
src/store.js       Data layer (JSON file: data/db.json) — เปลี่ยนเป็น DB จริงได้ที่ไฟล์นี้ไฟล์เดียว
src/sla.js         SLA policy, auto-assign, escalation, SLA watcher
public/index.html  หน้าลูกค้า (ฟอร์ม + แชท)
public/agent.html  Agent dashboard (Tickets + Team Chat)
public/js/*.js     Frontend logic
```

## ต่อยอดสำหรับ production

- Auth จริง (Keycloak / JWT) แทน `x-agent-id`
- PostgreSQL + Redis adapter ของ Socket.IO เพื่อรันหลาย instance
- ต่ออีเมลจริง (SendGrid / SES) ที่ฟังก์ชัน `sendEmail`
- แนบไฟล์ / รูปภาพ, CSAT หลังปิด ticket, Knowledge base

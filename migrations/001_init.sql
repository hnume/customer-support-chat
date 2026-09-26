-- ============================================================
-- Customer Support Chat System — schema
-- เปิดดูใน TablePlus ได้ทุกตาราง
-- ============================================================

CREATE TABLE agents (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  role  TEXT NOT NULL CHECK (role IN ('agent', 'supervisor')),
  team  TEXT NOT NULL
);

CREATE TABLE customers (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE ticket_number_seq START 1001;

CREATE TABLE tickets (
  id                UUID PRIMARY KEY,
  number            TEXT NOT NULL UNIQUE DEFAULT ('TK-' || nextval('ticket_number_seq')),
  subject           TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'general',
  channel           TEXT NOT NULL CHECK (channel IN ('web', 'mobile', 'email', 'chat')),
  priority          TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status            TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'pending', 'resolved', 'closed')),
  customer_id       UUID NOT NULL REFERENCES customers(id),
  assignee_id       TEXT REFERENCES agents(id),
  escalated         BOOLEAN NOT NULL DEFAULT false,
  escalation_level  INT NOT NULL DEFAULT 0,
  sla_warned        BOOLEAN NOT NULL DEFAULT false,
  sla_due_at        TIMESTAMPTZ,
  sla_reset_at      TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tickets_status_idx   ON tickets(status);
CREATE INDEX tickets_assignee_idx ON tickets(assignee_id);
CREATE INDEX tickets_updated_idx  ON tickets(updated_at DESC);

-- ข้อความในแชทของ ticket (ลูกค้า ↔ agent) พร้อมสถานะ sent / delivered / read
CREATE TABLE ticket_messages (
  id            UUID PRIMARY KEY,
  ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  from_side     TEXT NOT NULL CHECK (from_side IN ('customer', 'agent')),
  sender_id     TEXT NOT NULL,
  sender_name   TEXT NOT NULL,
  text          TEXT NOT NULL,
  internal      BOOLEAN NOT NULL DEFAULT false,
  status        TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
  delivered_at  TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ticket_messages_ticket_idx ON ticket_messages(ticket_id, created_at);

-- Timeline ของ ticket (created, assigned, escalated, sla_warning ...)
CREATE TABLE ticket_events (
  id          UUID PRIMARY KEY,
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  detail      TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT 'system',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ticket_events_ticket_idx ON ticket_events(ticket_id, created_at);

-- Team chat: 1:1 (direct) และ group ระหว่าง agent
CREATE TABLE conversations (
  id          UUID PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('direct', 'group')),
  name        TEXT,
  created_by  TEXT NOT NULL REFERENCES agents(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversation_members (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL REFERENCES agents(id),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, agent_id)
);
CREATE INDEX conversation_members_agent_idx ON conversation_members(agent_id);

CREATE TABLE conversation_messages (
  id              UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES agents(id),
  sender_name     TEXT NOT NULL,
  text            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX conversation_messages_conv_idx ON conversation_messages(conversation_id, created_at);

-- ใครได้รับ / อ่านข้อความไหนเมื่อไหร่ (1 แถวต่อ ข้อความ × ผู้รับ)
CREATE TABLE message_receipts (
  message_id    UUID NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  agent_id      TEXT NOT NULL REFERENCES agents(id),
  delivered_at  TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  PRIMARY KEY (message_id, agent_id)
);
CREATE INDEX message_receipts_agent_idx ON message_receipts(agent_id);

-- รายชื่อเจ้าหน้าที่เริ่มต้น (แก้ / เพิ่มใน TablePlus ได้)
INSERT INTO agents (id, name, role, team) VALUES
  ('a1', 'สมชาย (Agent)',            'agent',      'L1'),
  ('a2', 'สมหญิง (Agent)',           'agent',      'L1'),
  ('a3', 'วิชัย (Agent)',             'agent',      'L1'),
  ('s1', 'หัวหน้าทีม (Supervisor)',   'supervisor', 'L2')
ON CONFLICT (id) DO NOTHING;

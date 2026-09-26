# Backend Layered Dependency Diagram

โครงสร้างหลัง refactor เป็น TypeScript + PostgreSQL (v2) — ลูกศร = "import ได้"

```mermaid
flowchart TB
  entry["cmd/<br/>server.ts · app.ts · migrate.ts"]
  api["api/<br/>http routes · socket handlers · socketNotifier"]
  worker["workers/<br/>slaWatcher"]
  uc["business/usecases<br/>tickets · conversations · agents · assignment"]
  ports["business/ports<br/>interfaces"]
  domain["business/models<br/>Ticket · Conversation · slaPolicy"]
  repo["repositories/<br/>Pg*Repository (SQL)"]
  infra["pkg/<br/>db · config · mail · presence"]
  leaf["pkg/utils<br/>ids · time"]

  entry --> api & worker & uc & repo & infra
  api --> uc & domain & ports & infra
  worker --> uc
  uc --> ports & domain & leaf
  repo --> ports & domain & infra & leaf
  infra --> ports & domain & leaf
  ports --> domain
  domain --> leaf

  classDef layer fill:#EEEDFE,stroke:#534AB7,color:#3C3489
  classDef ext fill:#E1F5EE,stroke:#0F6E56,color:#085041
  classDef base fill:#F1EFE8,stroke:#5F5E5A,color:#444441
  class entry,api,worker,uc,repo layer
  class infra ext
  class ports,domain,leaf base
```

| Layer | โฟลเดอร์ | import ได้เฉพาะ |
|---|---|---|
| entry | `src/cmd/` | ทุก layer (ประกอบระบบ) |
| api | `src/api/` | usecases, models, ports, pkg |
| worker | `src/workers/` | usecases |
| usecases | `src/business/usecases/` | ports, models, pkg/utils — **ห้าม** express / socket.io / pg |
| repositories | `src/repositories/` | ports, models, pkg/db, pkg/utils |
| infra | `src/pkg/` | ports, models, pkg |
| models | `src/business/models/` | pkg/utils |

ต่างจากแผนภาพต้นแบบ: ไม่มี `repositories → usecases` — repository รู้จักแค่ interface ใน `business/ports.ts`
และมี `npm run lint:layers` ตรวจกฎนี้อัตโนมัติ (อยู่ใน `npm test` ด้วย)

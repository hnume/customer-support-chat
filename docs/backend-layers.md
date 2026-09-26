# Backend Layered Dependency Diagram

แผนภาพแบบ layer (entry → api → usecases → repositories → models / infra / utils) โดย map จากโค้ดจริง

```mermaid
flowchart TB
 entry["entry<br/>server.js · server.listen · npm start"]
 http["api/<br/>REST routes · Socket.IO handlers"]
 worker["sla watcher<br/>sla.startWatcher()"]
 uc["usecases<br/>openTicket · postMessage · escalate · pickAgent"]
 domain["models<br/>Ticket · Message · Conversation · SLA_POLICY"]
 repo["repositories<br/>src/store.js"]
 infra["infra<br/>express · socket.io · fs (data/db.json)"]
 leaf["utils<br/>uid · now · crypto · path"]

 entry --> http
 entry --> worker
 entry --> infra
 http --> uc
 http --> repo
 http --> domain
 http --> infra
 worker --> uc
 worker --> repo
 uc --> repo
 uc --> domain
 repo --> domain
 repo --> infra
 repo --> leaf
 infra --> leaf

 classDef layer fill:#EEEDFE,stroke:#534AB7,color:#3C3489
 classDef ext fill:#E1F5EE,stroke:#0F6E56,color:#085041
 classDef base fill:#F1EFE8,stroke:#5F5E5A,color:#444441
 class entry,http,worker,uc,repo layer
 class infra ext
 class domain,leaf base
```

| Layer | อยู่ในไฟล์ | สิ่งที่อยู่ข้างใน |
|---|---|---|
| entry | `server.js` (ท้ายไฟล์) | `server.listen`, เรียก `sla.startWatcher` |
| api/ | `server.js` | `app.get/post/patch(...)`, `io.on('connection')` |
| sla watcher | `src/sla.js` | `startWatcher()` ตรวจ SLA ทุก 30 วินาที |
| usecases | `server.js`, `src/sla.js` | `openTicket`, `postMessage`, `escalate`, `pickAgent`, `computeDue` |
| repositories | `src/store.js` | `createTicket`, `addMessage`, `markConv`, `stats` ฯลฯ |
| models | `src/store.js`, `src/sla.js` | โครงสร้าง Ticket / Message / Conversation, `SLA_POLICY` |
| infra | npm + Node | `express`, `socket.io`, `fs` → `data/db.json` |
| utils | `src/store.js` | `uid()`, `now()`, `crypto`, `path` |

ทิศทางการพึ่งพาเป็นทางเดียวจากบนลงล่าง ไม่มี repositories ย้อนกลับไปเรียก usecases

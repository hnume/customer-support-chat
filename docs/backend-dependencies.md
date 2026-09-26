# Backend Package Dependency Diagram

![Backend dependencies](backend-dependencies.svg)

โค้ด Mermaid (แก้ไขง่าย, GitHub แสดงเป็นรูปให้อัตโนมัติ):

```mermaid
flowchart TD
    server["server.js<br/><small>Entry: REST API + Socket.IO</small>"]
    sla["src/sla.js<br/><small>SLA, auto-assign, escalation</small>"]
    store["src/store.js<br/><small>Data layer</small>"]
    db[("data/db.json")]

    express(["express"])
    socketio(["socket.io"])
    nodeA["node: http, path"]
    nodeB["node: fs, path, crypto"]

    server --> nodeA
    server --> express
    server --> socketio
    server --> sla
    server --> store
    sla --> store
    store --> nodeB
    store -. read/write .-> db

    classDef internal fill:#EEEDFE,stroke:#534AB7,color:#3C3489
    classDef npm fill:#E1F5EE,stroke:#0F6E56,color:#085041
    classDef builtin fill:#F1EFE8,stroke:#5F5E5A,color:#444441
    class server,sla,store internal
    class express,socketio npm
    class nodeA,nodeB builtin
```

| โมดูล | พึ่งพา | หน้าที่ |
|---|---|---|
| `server.js` | express, socket.io, http, path, `src/sla.js`, `src/store.js` | REST API, realtime events, business logic |
| `src/sla.js` | `src/store.js` | SLA policy, auto-assign, escalation, SLA watcher |
| `src/store.js` | fs, path, crypto | อ่าน/เขียน `data/db.json` |

ทิศทางการพึ่งพาเป็นทางเดียว (server → sla → store) ไม่มี circular dependency
และ `store.js` เป็นจุดเดียวที่แตะข้อมูล จึงเปลี่ยนเป็น PostgreSQL / MongoDB ได้โดยไม่ต้องแก้ไฟล์อื่น

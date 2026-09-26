// ============================================================
// cmd/app — composition root: ประกอบทุก layer เข้าด้วยกัน
// (แยกจาก server.ts เพื่อให้ test สร้างระบบทั้งก้อนได้)
// ============================================================
import http from 'http';
import { Server } from 'socket.io';
import { createHttpApp } from '../api/http/app';
import { registerSocketHandlers } from '../api/socket/handlers';
import { createSocketNotifier } from '../api/socket/socketNotifier';
import { makeUseCases } from '../business/usecases';
import type { Config } from '../pkg/config';
import { connectDb, type Db } from '../pkg/db/client';
import { migrate } from '../pkg/db/migrate';
import { consoleMailer } from '../pkg/mail/consoleMailer';
import { MemoryPresence } from '../pkg/presence/memoryPresence';
import { systemClock, type Clock } from '../pkg/utils/time';
import { makeRepositories } from '../repositories';
import { startSlaWatcher } from '../workers/slaWatcher';

export interface AppHandle {
  server: http.Server;
  db: Db;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

export async function buildApp(config: Config, opts: { clock?: Clock; log?: (m: string) => void } = {}): Promise<AppHandle> {
  const log = opts.log ?? console.log;
  const db = await connectDb(config);
  await migrate(db, log);

  // ต้องใส่ request handler ก่อนสร้าง Socket.IO เพื่อให้ Socket.IO ดัก /socket.io/* ไปก่อน express
  let httpApp: http.RequestListener = (_req, res) => { res.statusCode = 503; res.end(); };
  const server = http.createServer((req, res) => httpApp(req, res));
  const io = new Server(server);
  const presence = new MemoryPresence();

  const uc = makeUseCases({
    ...makeRepositories(db),
    notifier: createSocketNotifier(io),
    mailer: consoleMailer,
    presence,
    clock: opts.clock ?? systemClock,
    slaUnitMs: config.slaUnitMs,
  });

  httpApp = createHttpApp(uc);
  registerSocketHandlers(io, uc, presence);
  const stopWatcher = startSlaWatcher(uc, config.slaCheckIntervalMs);

  return {
    server,
    db,
    listen: (port) =>
      new Promise((resolve) => server.listen(port, () => resolve((server.address() as { port: number }).port))),
    async close() {
      stopWatcher();
      io.close();
      await new Promise((r) => server.close(() => r(null)));
      await db.close();
    },
  };
}

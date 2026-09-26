import { io as ioc, type Socket } from 'socket.io-client';
import { buildApp, type AppHandle } from '../src/cmd/app';
import { loadConfig } from '../src/pkg/config';

export async function startTestApp(overrides: { slaUnitMs?: number; slaCheckIntervalMs?: number } = {}) {
  const app: AppHandle = await buildApp(
    loadConfig({ databaseUrl: null, pgliteDir: null, slaUnitMs: 60_000, slaCheckIntervalMs: 60_000, ...overrides }),
    { log: () => {} }
  );
  const port = await app.listen(0);
  const base = `http://localhost:${port}`;

  async function api<T = any>(path: string, opts: { method?: string; agent?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(base + path, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.agent ? { 'x-agent-id': opts.agent } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(`${res.status} ${data.error}`), { status: res.status });
    return data as T;
  }

  const sockets: Socket[] = [];
  function socket(): Socket {
    const s = ioc(base); // polling → websocket เหมือน browser จริง
    sockets.push(s);
    return s;
  }

  return {
    app, api, socket,
    async stop() { sockets.forEach((s) => s.close()); await app.close(); },
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** รอจนเงื่อนไขเป็นจริง (สูงสุด timeoutMs) */
export async function until(cond: () => boolean | Promise<boolean>, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(25);
  }
  throw new Error('timeout waiting for condition');
}

// ============================================================
// cmd/server — entry point (npm run dev / npm start)
// ============================================================
import { loadConfig } from '../pkg/config';
import { buildApp } from './app';

async function main() {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error('ไม่พบ DATABASE_URL — คัดลอก .env.example เป็น .env แล้วรัน npm run db:up');
  }
  const app = await buildApp(config);
  const port = await app.listen(config.port);

  console.log('\n🚀 Support Chat System พร้อมใช้งาน');
  console.log(`   ลูกค้า : http://localhost:${port}/`);
  console.log(`   Agent  : http://localhost:${port}/agent.html`);
  const url = new URL(config.databaseUrl);
  console.log(`   Database: PostgreSQL ${url.host}${url.pathname}`);
  console.log(`   SLA demo mode: ${config.slaDemo ? 'ON (นาที → วินาที)' : 'OFF'}\n`);

  const shutdown = async () => {
    console.log('\nกำลังปิดระบบ...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('เริ่มระบบไม่สำเร็จ:', e.message);
  if (/ECONNREFUSED|connect/i.test(e.message)) {
    console.error('→ ตรวจว่า PostgreSQL เปิดอยู่ (npm run db:up) และ DATABASE_URL ใน .env ถูกต้อง');
  }
  process.exit(1);
});

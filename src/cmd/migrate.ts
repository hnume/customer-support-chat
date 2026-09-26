// npm run db:migrate — สร้าง / อัปเดตตารางโดยไม่ต้องเปิดเซิร์ฟเวอร์
import { loadConfig } from '../pkg/config';
import { connectDb } from '../pkg/db/client';
import { migrate } from '../pkg/db/migrate';

(async () => {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error('ไม่พบ DATABASE_URL ใน .env');
  const db = await connectDb(config);
  const applied = await migrate(db, console.log);
  console.log(applied.length ? `เสร็จแล้ว (${applied.length} ไฟล์)` : 'ฐานข้อมูลเป็นเวอร์ชันล่าสุดแล้ว');
  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });

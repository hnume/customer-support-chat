// pkg/mail — จำลองการส่งอีเมล (เปลี่ยนเป็น SMTP / SendGrid / SES ได้ที่นี่)
import type { Mailer } from '../../business/ports';

export const consoleMailer: Mailer = {
  async send(to, subject, body) {
    console.log(`[email-out] to=${to} subject="${subject}"\n${body}\n`);
  },
};

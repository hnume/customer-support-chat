// ============================================================
// api/http — ประกอบ Express app (route บาง ๆ: ตรวจ input → เรียก usecase → ส่งผลลัพธ์)
// ============================================================
import path from 'path';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import type { UseCases } from '../../business/usecases';
import { errorHandler } from './helpers';
import { openApiSpec } from './openapi';
import { conversationRoutes } from './routes/conversations';
import { metaRoutes } from './routes/meta';
import { publicRoutes } from './routes/public';
import { ticketRoutes } from './routes/tickets';

export const PUBLIC_DIR = path.resolve(__dirname, '..', '..', '..', 'public');

export function createHttpApp(uc: UseCases) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(PUBLIC_DIR));

  // เอกสาร API: Swagger UI + OpenAPI JSON
  app.get('/api/openapi.json', (_req, res) => res.json(openApiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec as object, {
    customSiteTitle: 'Support Chat API',
    swaggerOptions: { persistAuthorization: true },
  }));

  app.use('/api', metaRoutes(uc));
  app.use('/api', publicRoutes(uc));
  app.use('/api/tickets', ticketRoutes(uc));
  app.use('/api/conversations', conversationRoutes(uc));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'ไม่พบ endpoint' }));
  app.use(errorHandler);
  return app;
}

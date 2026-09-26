import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../../business/models/errors';
import type { Agent } from '../../business/models/ticket';
import type { UseCases } from '../../business/usecases';

/** ให้ route เป็น async ได้ และส่ง error ต่อไปที่ errorHandler */
export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => fn(req, res).catch(next);

const STATUS: Record<AppError['code'], number> = { VALIDATION: 400, NOT_FOUND: 404, UNAUTHORIZED: 401 };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) return res.status(STATUS[err.code]).json({ error: err.message });
  console.error('[api] unexpected error', err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
}

/** เดโม: ระบุ agent ด้วย header x-agent-id (production เปลี่ยนเป็น JWT / Keycloak ที่นี่) */
export const requireAgent =
  (uc: UseCases): RequestHandler =>
  (req, res, next) => {
    uc.agents
      .authenticate(req.header('x-agent-id'))
      .then((agent) => { res.locals.agent = agent; next(); })
      .catch(next);
  };

export const agentOf = (res: Response): Agent => res.locals.agent as Agent;

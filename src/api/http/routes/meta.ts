// ข้อมูลประกอบ: รายชื่อ agent, SLA policy, สถิติ
import { Router } from 'express';
import type { UseCases } from '../../../business/usecases';
import { h } from '../helpers';

export function metaRoutes(uc: UseCases): Router {
  const r = Router();
  r.get('/agents', h(async (_req, res) => { res.json(await uc.agents.listWithPresence()); }));
  r.get('/sla-policy', h(async (_req, res) => { res.json(uc.sla.policy()); }));
  r.get('/stats', h(async (_req, res) => { res.json(await uc.stats.snapshot()); }));
  return r;
}

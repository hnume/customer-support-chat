// Route ฝั่ง agent: จัดการ ticket
import { Router } from 'express';
import { isStatus } from '../../../business/models/ticket';
import type { UseCases } from '../../../business/usecases';
import { agentOf, h, requireAgent } from '../helpers';

export function ticketRoutes(uc: UseCases): Router {
  const r = Router();
  r.use(requireAgent(uc));

  r.get('/', h(async (req, res) => {
    const { status, assigneeId, q } = req.query;
    res.json(await uc.tickets.list({
      status: isStatus(status) ? status : undefined,
      assigneeId: typeof assigneeId === 'string' && assigneeId ? assigneeId : undefined,
      q: typeof q === 'string' && q ? q : undefined,
    }));
  }));

  r.get('/:id', h(async (req, res) => {
    res.json(await uc.tickets.get(req.params.id));
  }));

  r.post('/:id/messages', h(async (req, res) => {
    res.status(201).json(await uc.tickets.postFromAgent(agentOf(res), req.params.id, req.body?.text, !!req.body?.internal));
  }));

  // เปลี่ยน status / priority / assigneeId
  r.patch('/:id', h(async (req, res) => {
    res.json(await uc.tickets.update(agentOf(res), req.params.id, req.body ?? {}));
  }));

  r.post('/:id/escalate', h(async (req, res) => {
    res.json(await uc.tickets.escalate(agentOf(res), req.params.id, req.body?.reason));
  }));

  return r;
}

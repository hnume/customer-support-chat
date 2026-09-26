// Route Team chat (1:1 / Group)
import { Router } from 'express';
import type { UseCases } from '../../../business/usecases';
import { agentOf, h, requireAgent } from '../helpers';

export function conversationRoutes(uc: UseCases): Router {
  const r = Router();
  r.use(requireAgent(uc));

  r.get('/', h(async (_req, res) => {
    res.json(await uc.conversations.list(agentOf(res)));
  }));

  r.post('/', h(async (req, res) => {
    res.status(201).json(await uc.conversations.create(agentOf(res), req.body ?? {}));
  }));

  r.get('/:id/messages', h(async (req, res) => {
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    res.json(await uc.conversations.history(agentOf(res), req.params.id, { before, limit: Number(req.query.limit) }));
  }));

  r.post('/:id/messages', h(async (req, res) => {
    res.status(201).json(await uc.conversations.send(agentOf(res), req.params.id, req.body?.text));
  }));

  r.post('/:id/members', h(async (req, res) => {
    res.json(await uc.conversations.updateMembers(agentOf(res), req.params.id, req.body ?? {}));
  }));

  return r;
}

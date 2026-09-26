// Route ฝั่งลูกค้า + Email webhook (ไม่ต้อง login)
import { Router } from 'express';
import { toCustomerView } from '../../../business/models/views';
import type { UseCases } from '../../../business/usecases';
import { h } from '../helpers';

export function publicRoutes(uc: UseCases): Router {
  const r = Router();

  // ลูกค้าแจ้งปัญหา (Web / Mobile / Chat)
  r.post('/tickets', h(async (req, res) => {
    const t = await uc.tickets.open(req.body ?? {});
    res.status(201).json(toCustomerView(t));
  }));

  // Email webhook — ต่อกับ SendGrid Inbound Parse / Mailgun Routes ได้
  r.post('/inbound/email', h(async (req, res) => {
    const result = await uc.tickets.inboundEmail(req.body ?? {});
    res.status(result.appended ? 200 : 201).json(result);
  }));

  r.get('/public/tickets/:id', h(async (req, res) => {
    res.json(await uc.tickets.getPublic(req.params.id));
  }));

  r.post('/public/tickets/:id/messages', h(async (req, res) => {
    res.status(201).json(await uc.tickets.postFromCustomer(req.params.id, req.body?.text));
  }));

  return r;
}

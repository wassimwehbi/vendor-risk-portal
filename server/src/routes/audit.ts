import { Router } from 'express';
import { listAudit } from '../services/store';
import { fail, ok, parseId } from './_helpers';

const router = Router();

router.get('/assessments/:id/audit', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid assessment id');
  ok(res, listAudit(id));
});

export default router;

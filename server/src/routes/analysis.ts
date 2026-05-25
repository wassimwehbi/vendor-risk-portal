import { Router } from 'express';
import { analyzeAssessment } from '../services/aiEngine';
import { getAssessment } from '../services/store';
import { fail, getScope, ok, parseId } from './_helpers';
import { requireTenantRole } from '../middleware/tenant';

const router = Router();

router.post('/assessments/:id/analyze', requireTenantRole('Analyst'), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid assessment id');
  const scope = getScope(req);
  if (!getAssessment(id, scope)) return fail(res, 404, 'Assessment not found');

  try {
    const result = await analyzeAssessment(id, scope);
    ok(res, result);
  } catch (err) {
    fail(res, 422, (err as Error).message);
  }
});

export default router;

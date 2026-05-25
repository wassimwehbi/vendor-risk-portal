import { Router } from 'express';
import { listScenarios, loadScenario } from '../services/demo';
import { fail, getScope, ok } from './_helpers';
import { requireTenantRole } from '../middleware/tenant';

const router = Router();

router.get('/demo/scenarios', (_req, res) => {
  ok(res, listScenarios());
});

router.post('/demo/scenarios/:key/load', requireTenantRole('Analyst'), (req, res) => {
  try {
    const assessment = loadScenario(req.params.key, getScope(req));
    if (!assessment) return fail(res, 404, 'Unknown scenario');
    ok(res, assessment, 201);
  } catch (err) {
    return fail(res, 400, (err as Error).message);
  }
});

export default router;

import { Router } from 'express';
import { listScenarios, loadScenario } from '../services/demo';
import { fail, getContext, ok } from './_helpers';

const router = Router();

router.get('/demo/scenarios', (_req, res) => {
  ok(res, listScenarios());
});

router.post('/demo/scenarios/:key/load', (req, res) => {
  const { actor, role } = getContext(req);
  if (role === 'Viewer') return fail(res, 403, 'Viewers cannot load demo scenarios');
  const assessment = loadScenario(req.params.key, actor, role);
  if (!assessment) return fail(res, 404, 'Unknown scenario');
  ok(res, assessment, 201);
});

export default router;

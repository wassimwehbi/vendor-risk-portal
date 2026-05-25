import { Router } from 'express';
import { analyzeAssessment } from '../services/aiEngine';
import { getAssessment } from '../services/store';
import { fail, getContext, ok, parseId } from './_helpers';

const router = Router();

router.post('/assessments/:id/analyze', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid assessment id');
  if (!getAssessment(id)) return fail(res, 404, 'Assessment not found');

  const { actor, role } = getContext(req);
  if (role === 'Viewer') return fail(res, 403, 'Viewers cannot run analysis');

  try {
    const result = await analyzeAssessment(id, actor, role);
    ok(res, result);
  } catch (err) {
    fail(res, 422, (err as Error).message);
  }
});

export default router;

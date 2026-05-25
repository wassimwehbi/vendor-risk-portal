import { Router } from 'express';
import { z } from 'zod';
import { createAssessment, getAssessmentDetail, listAssessments } from '../services/store';
import { fail, getContext, ok, parseId } from './_helpers';

const router = Router();

router.get('/assessments', (_req, res) => {
  ok(res, listAssessments());
});

const createSchema = z.object({
  vendor_name: z.string().min(1, 'vendor_name is required'),
  questionnaire_type: z.string().min(1).default('SIG'),
  date_submitted: z.string().min(1),
});

router.post('/assessments', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid request');
  const { actor, role } = getContext(req);
  if (role === 'Viewer') return fail(res, 403, 'Viewers cannot create assessments');
  const assessment = createAssessment(parsed.data, actor, role);
  ok(res, assessment, 201);
});

router.get('/assessments/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid assessment id');
  const detail = getAssessmentDetail(id);
  if (!detail) return fail(res, 404, 'Assessment not found');
  ok(res, detail);
});

export default router;

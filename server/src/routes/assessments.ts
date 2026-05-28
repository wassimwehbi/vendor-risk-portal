import { Router } from 'express';
import { z } from 'zod';
import { createAssessment, deleteAssessment, getAssessmentDetail, listAssessments } from '../services/store';
import { fail, getScope, ok, parseId } from './_helpers';
import { requireAdmin, requireTenantRole } from '../middleware/tenant';

const router = Router();

router.get('/assessments', (req, res) => {
  ok(res, listAssessments(getScope(req)));
});

const createSchema = z.object({
  vendor_name: z.string().min(1, 'vendor_name is required'),
  questionnaire_type: z.string().min(1).default('SIG'),
  date_submitted: z.string().min(1),
  internet_facing: z.boolean().optional(),
  personal_data_volume: z.enum(['low', 'medium', 'high']).optional(),
});

router.post('/assessments', requireTenantRole('Analyst', 'Submitter'), (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid request');
  try {
    const assessment = createAssessment(parsed.data, getScope(req));
    ok(res, assessment, 201);
  } catch (err) {
    // e.g. an admin in "all tenants" mode must select a tenant first.
    return fail(res, 400, (err as Error).message);
  }
});

router.get('/assessments/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid assessment id');
  const detail = getAssessmentDetail(id, getScope(req));
  if (!detail) return fail(res, 404, 'Assessment not found');
  ok(res, detail);
});

router.delete('/assessments/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid assessment id');
  const deleted = deleteAssessment(id, getScope(req));
  if (!deleted) return fail(res, 404, 'Assessment not found');
  ok(res, { deleted: true });
});

export default router;

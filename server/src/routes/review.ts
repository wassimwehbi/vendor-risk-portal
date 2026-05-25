import { Router } from 'express';
import { z } from 'zod';
import { patchAssessment, patchFinding } from '../services/store';
import { fail, getContext, ok, parseId } from './_helpers';

const router = Router();

const riskEnum = z.enum(['Low', 'Medium', 'High', 'Critical']);
const evidenceEnum = z.enum(['Sufficient', 'Insufficient', 'None', 'Expired', 'Misaligned']);

const findingSchema = z.object({
  control_domain: z.string().min(1).optional(),
  framework_mappings: z
    .array(z.object({ framework: z.string(), references: z.array(z.string()) }))
    .optional(),
  risk_level: riskEnum.optional(),
  evidence_sufficiency: evidenceEnum.optional(),
  follow_up_questions: z.array(z.string()).optional(),
  analyst_status: z.enum(['pending', 'accepted', 'overridden']).optional(),
});

router.patch('/findings/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid finding id');
  const parsed = findingSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid request');

  const { actor, role } = getContext(req);
  if (role === 'Viewer') return fail(res, 403, 'Viewers cannot edit findings');

  const updated = patchFinding(id, parsed.data, actor, role);
  if (!updated) return fail(res, 404, 'Finding not found');
  ok(res, updated);
});

const assessmentSchema = z.object({
  overall_risk: riskEnum.optional(),
  analyst_notes: z.string().optional(),
  validation_status: z.enum(['pending', 'approved']).optional(),
});

router.patch('/assessments/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid assessment id');
  const parsed = assessmentSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid request');

  const { actor, role } = getContext(req);
  if (role === 'Viewer') return fail(res, 403, 'Viewers cannot edit assessments');
  if (parsed.data.validation_status === 'approved' && role !== 'Analyst' && role !== 'Admin') {
    return fail(res, 403, 'Only an Analyst or Admin can approve an assessment');
  }

  const updated = patchAssessment(id, parsed.data, actor, role);
  if (!updated) return fail(res, 404, 'Assessment not found');
  ok(res, updated);
});

export default router;

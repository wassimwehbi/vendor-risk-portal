import { Router } from 'express';
import { z } from 'zod';
import { patchAssessment, patchFinding } from '../services/store';
import { fail, getScope, ok, parseId } from './_helpers';
import { requireTenantRole } from '../middleware/tenant';

const router = Router();

const riskEnum = z.enum(['Low', 'Medium', 'High', 'Critical']);
const evidenceEnum = z.enum(['Sufficient', 'Insufficient', 'None', 'Expired', 'Misaligned']);

const findingSchema = z.object({
  control_domain: z.string().min(1).optional(),
  framework_mappings: z.array(z.object({ framework: z.string(), references: z.array(z.string()) })).optional(),
  risk_level: riskEnum.optional(),
  evidence_sufficiency: evidenceEnum.optional(),
  follow_up_questions: z.array(z.string()).optional(),
  analyst_status: z.enum(['pending', 'accepted', 'overridden']).optional(),
});

// Reviewing/overriding findings and editing/approving assessments is Analyst (or
// Admin) work. Submitters and Viewers are blocked by requireTenantRole.
router.patch('/findings/:id', requireTenantRole('Analyst'), (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid finding id');
  const parsed = findingSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid request');

  try {
    const updated = patchFinding(id, parsed.data, getScope(req));
    if (!updated) return fail(res, 404, 'Finding not found');
    ok(res, updated);
  } catch (err) {
    return fail(res, 400, (err as Error).message);
  }
});

const assessmentSchema = z.object({
  overall_risk: riskEnum.optional(),
  analyst_notes: z.string().optional(),
  business_context: z.string().optional(),
  validation_status: z.enum(['pending', 'approved']).optional(),
});

router.patch('/assessments/:id', requireTenantRole('Analyst'), (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid assessment id');
  const parsed = assessmentSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid request');

  try {
    const updated = patchAssessment(id, parsed.data, getScope(req));
    if (!updated) return fail(res, 404, 'Assessment not found');
    ok(res, updated);
  } catch (err) {
    return fail(res, 400, (err as Error).message);
  }
});

export default router;

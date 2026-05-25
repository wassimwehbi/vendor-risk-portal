import { Router } from 'express';
import { getAssessment, listAudit } from '../services/store';
import { fail, getScope, ok, parseId } from './_helpers';
import { requireTenantRole } from '../middleware/tenant';

const router = Router();

// The audit trail is internal review tooling. Submitters are excluded (their
// "outcome" is the report); Analysts/Viewers/Admins see it, tenant-scoped.
router.get('/assessments/:id/audit', requireTenantRole('Analyst', 'Viewer'), (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid assessment id');
  // Verify access to the assessment before exposing its audit log.
  if (!getAssessment(id, getScope(req))) return fail(res, 404, 'Assessment not found');
  ok(res, listAudit(id));
});

export default router;

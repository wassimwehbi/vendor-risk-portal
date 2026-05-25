import { Router } from 'express';
import { buildReport } from '../services/store';
import { toCsv, toXlsx } from '../services/exporter';
import { fail, getScope, ok, parseId } from './_helpers';

const router = Router();

function safeName(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'vendor';
}

router.get('/assessments/:id/report', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid assessment id');
  const report = buildReport(id, getScope(req));
  if (!report) return fail(res, 404, 'Assessment not found');
  ok(res, report);
});

router.get('/assessments/:id/export.csv', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid assessment id');
  const report = buildReport(id, getScope(req));
  if (!report) return fail(res, 404, 'Assessment not found');
  const csv = toCsv(report);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName(report.vendor_name)}_risk_report.csv"`);
  res.send(csv);
});

router.get('/assessments/:id/export.xlsx', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return fail(res, 400, 'Invalid assessment id');
  const report = buildReport(id, getScope(req));
  if (!report) return fail(res, 404, 'Assessment not found');
  const buffer = toXlsx(report);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName(report.vendor_name)}_risk_report.xlsx"`);
  res.send(buffer);
});

export default router;

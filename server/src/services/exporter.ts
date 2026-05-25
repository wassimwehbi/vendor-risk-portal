import * as XLSX from 'xlsx';
import type { ReportData } from '../types';
import { effectiveFinding } from '../types';

const HEADERS = [
  'Question ID',
  'Question',
  'Control Area',
  'Vendor Response',
  'Response Type',
  'Framework Mapping',
  'AI Finding',
  'Control Strength',
  'Evidence',
  'Risk',
  'Analyst Status',
  'Follow-Up Questions',
];

function rowsFromReport(report: ReportData): string[][] {
  return report.controls.map(({ item, finding }) => {
    const eff = effectiveFinding(finding);
    const mapping = eff.framework_mappings.map((m) => `${m.framework}: ${m.references.join('; ')}`).join(' | ');
    return [
      item.question_id,
      item.question_text,
      eff.control_domain,
      item.response,
      item.response_type,
      mapping,
      finding.ai_finding,
      finding.control_strength,
      eff.evidence_sufficiency,
      eff.risk_level,
      finding.analyst_status,
      eff.follow_up_questions.join(' • '),
    ];
  });
}

function csvCell(value: string): string {
  const v = value ?? '';
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCsv(report: ReportData): string {
  const meta: string[][] = [
    ['Vendor', report.vendor_name],
    ['Questionnaire', report.questionnaire_type],
    ['Date submitted', report.date_submitted],
    ['Data processed', report.data_categories.join(', ')],
    ['Applicable frameworks', report.applicable_frameworks.join(', ')],
    ['Preliminary overall risk', report.overall_risk ?? 'n/a'],
    ['AI engine', report.ai_engine_used ?? 'n/a'],
    ['Framework mapping version', report.mapping_version ?? 'n/a'],
    ['Validation status', report.validation_status],
    ['Validated by', report.validated_by ?? ''],
    ['Analyst notes', report.analyst_notes ?? ''],
    ['NOTE', 'AI output is preliminary. Final decision is made by a human analyst.'],
    [],
  ];
  const all = [...meta, HEADERS, ...rowsFromReport(report)];
  return all.map((row) => row.map(csvCell).join(',')).join('\n');
}

export function toXlsx(report: ReportData): Buffer {
  const wb = XLSX.utils.book_new();

  const summary = [
    ['Vendor', report.vendor_name],
    ['Questionnaire', report.questionnaire_type],
    ['Date submitted', report.date_submitted],
    ['Data processed', report.data_categories.join(', ')],
    ['Applicable frameworks', report.applicable_frameworks.join(', ')],
    ['Preliminary overall risk', report.overall_risk ?? 'n/a'],
    ['AI engine', report.ai_engine_used ?? 'n/a'],
    ['Framework mapping version', report.mapping_version ?? 'n/a'],
    ['Validation status', report.validation_status],
    ['Validated by', report.validated_by ?? ''],
    ['Validated at', report.validated_at ?? ''],
    ['Analyst notes', report.analyst_notes ?? ''],
    ['Disclaimer', 'AI output is preliminary. Final vendor-risk decisions are made by a human analyst.'],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  const controlsSheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rowsFromReport(report)]);
  XLSX.utils.book_append_sheet(wb, controlsSheet, 'Controls');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

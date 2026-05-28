import * as XLSX from 'xlsx';
import type { ReportData, RiskLevel } from '../types';
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
    ['Business context', report.business_context ?? ''],
    ['NOTE', 'AI output is preliminary. Final decision is made by a human analyst.'],
    [],
  ];
  const all = [...meta, HEADERS, ...rowsFromReport(report)];
  return all.map((row) => row.map(csvCell).join(',')).join('\n');
}

export function toGrcJson(report: ReportData): string {
  const riskDistribution: Record<RiskLevel, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };

  const controls = report.controls.map(({ item, finding }) => {
    const eff = effectiveFinding(finding);
    riskDistribution[eff.risk_level] = (riskDistribution[eff.risk_level] ?? 0) + 1;
    return {
      question_id: item.question_id,
      question_text: item.question_text,
      control_domain: eff.control_domain,
      vendor_response: item.response,
      response_type: item.response_type,
      framework_mappings: eff.framework_mappings,
      ai_finding: finding.ai_finding,
      control_strength: finding.control_strength,
      completeness: finding.completeness,
      evidence_sufficiency: eff.evidence_sufficiency,
      risk_level: eff.risk_level,
      analyst_status: finding.analyst_status,
      follow_up_questions: eff.follow_up_questions,
      rationale: finding.ai_rationale,
    };
  });

  const obj = {
    schema_version: '1.0',
    disclaimer: 'AI output is preliminary. Final vendor-risk decisions are made by a human analyst.',
    vendor: report.vendor_name,
    assessment: {
      questionnaire_type: report.questionnaire_type,
      date_submitted: report.date_submitted,
      overall_risk: report.overall_risk,
      validation_status: report.validation_status,
      validated_by: report.validated_by,
      validated_at: report.validated_at,
      applicable_frameworks: report.applicable_frameworks,
      data_categories: report.data_categories,
      analyst_notes: report.analyst_notes,
      business_context: report.business_context,
      ai_engine: report.ai_engine_used,
      mapping_version: report.mapping_version,
      generated_at: report.generated_at,
    },
    summary: {
      control_count: controls.length,
      weak_or_missing_count: report.weak_or_missing.length,
      evidence_gap_count: report.evidence_gaps.length,
      follow_up_count: report.follow_ups.length,
      risk_distribution: riskDistribution,
    },
    controls,
    follow_up_questions: report.follow_ups,
  };

  return JSON.stringify(obj, null, 2);
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
    ['Business context', report.business_context ?? ''],
    ['Disclaimer', 'AI output is preliminary. Final vendor-risk decisions are made by a human analyst.'],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  const controlsSheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rowsFromReport(report)]);
  XLSX.utils.book_append_sheet(wb, controlsSheet, 'Controls');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

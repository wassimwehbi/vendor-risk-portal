import { getIdentity } from '../lib/role';
import type {
  Assessment,
  AssessmentDetail,
  AnalyzeResult,
  AuditEntry,
  Finding,
  ReportData,
  RiskLevel,
  ScenarioSummary,
} from '../types';

const BASE = '/api';

function authHeaders(): Record<string, string> {
  const id = getIdentity();
  return { 'X-Analyst': id.name, 'X-Role': id.role };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  });
  let body: { success: boolean; data?: T; error?: string };
  try {
    body = await res.json();
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body.data as T;
}

function get<T>(path: string): Promise<T> {
  return request<T>(path);
}
function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}
function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface HealthInfo {
  status: string;
  aiEngineAvailable: boolean;
}

export const api = {
  health: () => get<HealthInfo>('/health'),
  listScenarios: () => get<ScenarioSummary[]>('/demo/scenarios'),
  loadScenario: (key: string) => post<Assessment>(`/demo/scenarios/${key}/load`),

  listAssessments: () => get<Assessment[]>('/assessments'),
  createAssessment: (input: { vendor_name: string; questionnaire_type: string; date_submitted: string }) =>
    post<Assessment>('/assessments', input),
  getAssessment: (id: number) => get<AssessmentDetail>(`/assessments/${id}`),

  uploadFiles: async (id: number, questionnaire: File, evidence: File[]): Promise<{ assessment: Assessment; items: AssessmentDetail['items'] }> => {
    const form = new FormData();
    form.append('questionnaire', questionnaire);
    for (const f of evidence) form.append('evidence', f);
    const res = await fetch(`${BASE}/assessments/${id}/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.error || `Upload failed (${res.status})`);
    return body.data;
  },

  analyze: (id: number) => post<AnalyzeResult>(`/assessments/${id}/analyze`),

  patchFinding: (
    id: number,
    body: Partial<Pick<Finding, 'control_domain' | 'framework_mappings' | 'risk_level' | 'evidence_sufficiency' | 'follow_up_questions' | 'analyst_status'>>,
  ) => patch<Finding>(`/findings/${id}`, body),

  patchAssessment: (
    id: number,
    body: { overall_risk?: RiskLevel; analyst_notes?: string; validation_status?: 'pending' | 'approved' },
  ) => patch<Assessment>(`/assessments/${id}`, body),

  getReport: (id: number) => get<ReportData>(`/assessments/${id}/report`),
  getAudit: (id: number) => get<AuditEntry[]>(`/assessments/${id}/audit`),

  exportUrl: (id: number, format: 'csv' | 'xlsx') => `${BASE}/assessments/${id}/export.${format}`,
};

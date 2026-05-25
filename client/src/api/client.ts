import type {
  AdminUser,
  Assessment,
  AssessmentDetail,
  AnalyzeResult,
  AuthProviders,
  AuditEntry,
  Finding,
  Invite,
  MembershipRole,
  ReportData,
  RiskLevel,
  ScenarioSummary,
  SessionUser,
  Tenant,
} from '../types';

// API base. By default the client uses a SAME-ORIGIN relative path (`/api`):
//   - dev:  Vite proxies /api -> the server (no CORS/CORP; the session cookie still
//           flows because cookies are not port-scoped on localhost).
//   - prod: serve the SPA and API on the same origin.
// Set VITE_API_URL only to point at a SEPARATE API origin (which then also requires
// the server's CORS allow-list to include the SPA origin).
const ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export const API_BASE = `${ORIGIN}/api`;

/** Absolute URL to an auth endpoint (used for provider redirects / magic links). */
export function authUrl(path: string): string {
  return `${API_BASE}/auth/${path}`;
}

// CSRF token for state-changing requests; set by the auth layer after sign-in.
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

// Called when the API reports the session is gone (401), so the app can redirect.
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) headers['x-csrf-token'] = csrfToken;

  const res = await fetch(`${API_BASE}${path}`, { ...init, credentials: 'include', headers });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error('Your session has expired. Please sign in again.');
  }
  let body: { success: boolean; data?: T; error?: string };
  try {
    body = await res.json();
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }
  if (!res.ok || !body.success) throw new Error(body.error || `Request failed (${res.status})`);
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
function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

export interface HealthInfo {
  status: string;
  aiEngineAvailable: boolean;
}

export interface SessionInfo {
  user: SessionUser | null;
  csrfToken: string | null;
}

export const api = {
  health: () => get<HealthInfo>('/health'),

  // ---- Auth ----
  getSession: () => get<SessionInfo>('/auth/session'),
  getProviders: () => get<AuthProviders>('/auth/providers'),
  devLogin: (email: string, role?: string, name?: string, tenant?: string) =>
    post<{ user: SessionUser; csrfToken: string }>('/auth/dev-login', { email, role, name, tenant }),
  requestMagicLink: (email: string) => post<{ sent: boolean; devLink?: string }>('/auth/magic/request', { email }),
  signOut: () => post<{ signedOut: boolean }>('/auth/signout'),
  // Invite acceptance: a non-mutating preview (GET) then an explicit action (POST),
  // so unfurlers/prefetchers can't burn the single-use invite before the human confirms.
  getInviteInfo: (token: string) =>
    get<{ email: string; tenant_name: string; role: MembershipRole }>(`/auth/invite/info?token=${encodeURIComponent(token)}`),
  acceptInvite: (token: string) => post<{ user: SessionUser; csrfToken: string }>('/auth/invite/accept', { token }),
  // Switch the session's active tenant (null = admin "all tenants" mode).
  switchTenant: (tenant_id: number | null) => post<SessionInfo>('/auth/active-tenant', { tenant_id }),

  // ---- Admin (tenant + membership management) ----
  listTenants: () => get<Tenant[]>('/admin/tenants'),
  createTenant: (name: string) => post<Tenant>('/admin/tenants', { name }),
  deleteTenant: (id: number) => del<{ deleted: boolean }>(`/admin/tenants/${id}`),
  listAdminUsers: () => get<AdminUser[]>('/admin/users'),
  setUserAdmin: (userId: number, is_admin: boolean) => patch<AdminUser>(`/admin/users/${userId}`, { is_admin }),
  deleteUser: (userId: number) => del<{ deleted: boolean }>(`/admin/users/${userId}`),
  assignMembership: (userId: number, tenantId: number, role: MembershipRole) =>
    post<AdminUser>(`/admin/users/${userId}/memberships`, { tenantId, role }),
  revokeMembership: (userId: number, tenantId: number) =>
    del<AdminUser>(`/admin/users/${userId}/memberships/${tenantId}`),
  listInvites: () => get<Invite[]>('/admin/invites'),
  createInvite: (email: string, tenantId: number, role: MembershipRole) =>
    post<{ invite: Invite; link: string; emailed: boolean; devLink?: string }>('/admin/invites', { email, tenantId, role }),
  revokeInvite: (id: number) => del<{ revoked: boolean }>(`/admin/invites/${id}`),

  listScenarios: () => get<ScenarioSummary[]>('/demo/scenarios'),
  loadScenario: (key: string) => post<Assessment>(`/demo/scenarios/${key}/load`),

  listAssessments: () => get<Assessment[]>('/assessments'),
  createAssessment: (input: { vendor_name: string; questionnaire_type: string; date_submitted: string }) =>
    post<Assessment>('/assessments', input),
  getAssessment: (id: number) => get<AssessmentDetail>(`/assessments/${id}`),

  uploadFiles: async (
    id: number,
    questionnaire: File,
    evidence: File[],
  ): Promise<{ assessment: Assessment; items: AssessmentDetail['items']; evidence: AssessmentDetail['evidence']; analysis: AnalyzeResult | null }> => {
    const form = new FormData();
    form.append('questionnaire', questionnaire);
    for (const f of evidence) form.append('evidence', f);
    const res = await fetch(`${API_BASE}/assessments/${id}/upload`, {
      method: 'POST',
      credentials: 'include',
      headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
      body: form,
    });
    if (res.status === 401) {
      onUnauthorized?.();
      throw new Error('Your session has expired. Please sign in again.');
    }
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

  exportUrl: (id: number, format: 'csv' | 'xlsx') => `${API_BASE}/assessments/${id}/export.${format}`,
};

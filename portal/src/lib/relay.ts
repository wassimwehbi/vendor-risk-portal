// Calls the Render API: the GitHub device-flow relay (the server injects the OAuth client_id and a
// fixed public_repo scope) and the bearer-token-gated results endpoint.
import { API_BASE } from '../config';
import type { ExperimentResults } from '../types';

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the GitHub device-authorization flow via the relay. Calls onPrompt with the user_code +
 * verification URI for the human to enter, polls until GitHub returns a token, and resolves with it.
 */
export async function authorize(onPrompt: (d: DeviceCode) => void): Promise<string> {
  const codeRes = await fetch(`${API_BASE}/api/gh-device/code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const dc = (await codeRes.json()) as DeviceCode & { error?: string; error_description?: string };
  if (!codeRes.ok || dc.error) {
    throw new Error(dc.error_description || dc.error || `Couldn't start sign-in (${codeRes.status}).`);
  }
  onPrompt(dc);

  let interval = (dc.interval || 5) + 1; // pad to stay clear of GitHub's slow_down
  const deadline = Date.now() + (dc.expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const tokRes = await fetch(`${API_BASE}/api/gh-device/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: dc.device_code }),
    });
    const tok = (await tokRes.json()) as { access_token?: string; error?: string; error_description?: string };
    if (tok.access_token) return tok.access_token;
    if (tok.error === 'authorization_pending') continue;
    if (tok.error === 'slow_down') {
      interval += 5;
      continue;
    }
    throw new Error(tok.error_description || tok.error || 'Sign-in failed.');
  }
  throw new Error('Sign-in timed out — please try again.');
}

/**
 * Fetch aggregate results for an experiment. Authorized with the signed-in GitHub token — the
 * server verifies the user is a repo collaborator — so there's no separate read token.
 */
export async function fetchResults(key: string, token: string): Promise<ExperimentResults> {
  const res = await fetch(`${API_BASE}/api/experiments/${encodeURIComponent(key)}/results`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: ExperimentResults; error?: string };
  if (!res.ok || !body.success || !body.data) throw new Error(body.error || `Results unavailable (${res.status}).`);
  return body.data;
}

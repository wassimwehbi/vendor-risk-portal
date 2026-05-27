import { Router, type Response } from 'express';
import { z } from 'zod';
import { safeEqual } from '../middleware/auth';
import {
  assignVariant,
  computeResults,
  evaluateAll,
  experimentsConfig,
  getExperiment,
  recordEvent,
  recordExposure,
} from '../services/experiments';
import { fail, getScope, ok } from './_helpers';

// ---- Authenticated routes --------------------------------------------------
// Mounted AFTER requireAuth + requireCsrf + resolveTenant, so req.scope is present.
export const experimentsRouter = Router();

// The variants assigned to the current user, for all running + eligible experiments.
experimentsRouter.get('/flags', (req, res) => {
  ok(res, evaluateAll(getScope(req)));
});

// Record that the user actually rendered an experiment's variant (idempotent). The server
// recomputes the variant authoritatively — the client never gets to pick it.
experimentsRouter.post('/experiments/:key/expose', (req, res) => {
  const scope = getScope(req);
  const exp = getExperiment(req.params.key);
  if (!exp) return fail(res, 404, 'Unknown experiment');
  const variant = assignVariant(exp, scope);
  if (!variant) return ok(res, { recorded: false }); // user is not in this experiment
  recordExposure(exp.key, variant, scope);
  ok(res, { recorded: true, variant });
});

const eventSchema = z.object({ metric: z.string().min(1).max(64) });

// Record a conversion / metric event for the current user. recordEvent attributes it only to
// experiments the user was exposed to that declare this metric (returns the count attributed).
experimentsRouter.post('/events', (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid request');
  const recorded = recordEvent(parsed.data.metric, getScope(req));
  ok(res, { recorded }, 201);
});

// ---- Public routes ---------------------------------------------------------
// Mounted BEFORE requireAuth: the portal is a separate (GitHub Pages) origin with no app session.
// Results are token-gated; the device-flow relay is unauthenticated by design (it forwards to
// GitHub with a PUBLIC client_id and holds no secret). CORS for these is scoped in app.ts.
export const experimentsPublicRouter = Router();

// Aggregate results for the portal dashboard. Bearer-token gated (low-sensitivity, non-PII counts).
// Disabled (503) unless EXPERIMENTS_READ_TOKEN is configured. The token check is constant-time.
experimentsPublicRouter.get('/experiments/:key/results', (req, res) => {
  if (!experimentsConfig.readToken) return fail(res, 503, 'Results API not configured');
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token || !safeEqual(token, experimentsConfig.readToken)) return fail(res, 401, 'Invalid results token');
  const exp = getExperiment(req.params.key);
  if (!exp) return fail(res, 404, 'Unknown experiment');
  ok(res, computeResults(exp));
});

// GitHub device-flow relay. GitHub's device/token endpoints send no CORS headers, so a static SPA
// can't call them directly; these forward the calls and inject the public client_id from env. They
// carry no secret and return GitHub's native JSON (not the app's {success,data} envelope).
const GH_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GH_TIMEOUT_MS = 10_000;

/** POST `body` to a GitHub OAuth endpoint and relay the response — with a timeout and non-JSON safety. */
async function proxyToGitHub(res: Response, url: string, body: Record<string, string>): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GH_TIMEOUT_MS);
  try {
    const gh = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await gh.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return fail(res, 502, `GitHub returned a non-JSON response (status ${gh.status})`);
    }
    res.status(gh.status).json(data);
  } catch (err) {
    const msg = (err as Error).name === 'AbortError' ? 'request timed out' : (err as Error).message;
    fail(res, 502, `GitHub request failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

experimentsPublicRouter.post('/gh-device/code', async (_req, res) => {
  if (!experimentsConfig.ghClientId) return fail(res, 503, 'GitHub OAuth not configured');
  // Scope is FIXED server-side (never read from the request body) so the relay can't be used to
  // request escalated scopes under the app's OAuth identity. The portal only needs public_repo.
  await proxyToGitHub(res, GH_DEVICE_CODE_URL, { client_id: experimentsConfig.ghClientId, scope: 'public_repo' });
});

experimentsPublicRouter.post('/gh-device/token', async (req, res) => {
  if (!experimentsConfig.ghClientId) return fail(res, 503, 'GitHub OAuth not configured');
  const deviceCode = req.body?.device_code;
  if (typeof deviceCode !== 'string' || !deviceCode) return fail(res, 400, 'device_code is required');
  await proxyToGitHub(res, GH_TOKEN_URL, {
    client_id: experimentsConfig.ghClientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
});

import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
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

/** Constant-time string compare (avoids leaking the results token via timing). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ---- Authenticated routes --------------------------------------------------
// Mounted AFTER requireAuth + requireCsrf + resolveTenant, so req.scope is present.
export const experimentsRouter = Router();

// The variants assigned to the current user, for all running + eligible experiments.
experimentsRouter.get('/flags', (req, res) => {
  ok(res, evaluateAll(getScope(req)));
});

// Record that the user actually rendered an experiment's variant (idempotent). The
// server recomputes the variant authoritatively — the client never gets to pick it.
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

// Record a conversion / metric event for the current user.
experimentsRouter.post('/events', (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? 'Invalid request');
  recordEvent(parsed.data.metric, getScope(req));
  ok(res, { recorded: true }, 201);
});

// ---- Public routes ---------------------------------------------------------
// Mounted BEFORE requireAuth: the portal is a separate (GitHub Pages) origin with no
// app session. Results are token-gated; the device-flow relay is unauthenticated by
// design (it forwards to GitHub with a PUBLIC client_id and holds no secret).
export const experimentsPublicRouter = Router();

// Aggregate results for the portal dashboard. Bearer-token gated (low-sensitivity,
// non-PII counts). Disabled (503) unless EXPERIMENTS_READ_TOKEN is configured.
experimentsPublicRouter.get('/experiments/:key/results', (req, res) => {
  if (!experimentsConfig.readToken) return fail(res, 503, 'Results API not configured');
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token || !safeEqual(token, experimentsConfig.readToken)) return fail(res, 401, 'Invalid results token');
  const exp = getExperiment(req.params.key);
  if (!exp) return fail(res, 404, 'Unknown experiment');
  ok(res, computeResults(exp));
});

// GitHub device-flow relay. GitHub's device/token endpoints send no CORS headers, so
// a static SPA can't call them directly; these forward the calls and add CORS. They
// inject the public client_id from env, carry no secret, and return GitHub's native
// JSON (not the app's {success,data} envelope) so the portal can consume it directly.
const GH_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GH_TOKEN_URL = 'https://github.com/login/oauth/access_token';

experimentsPublicRouter.post('/gh-device/code', async (req, res) => {
  if (!experimentsConfig.ghClientId) return fail(res, 503, 'GitHub OAuth not configured');
  const scope = typeof req.body?.scope === 'string' ? req.body.scope : 'public_repo';
  try {
    const gh = await fetch(GH_DEVICE_CODE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: experimentsConfig.ghClientId, scope }),
    });
    res.status(gh.status).json(await gh.json());
  } catch (err) {
    fail(res, 502, `GitHub device-code request failed: ${(err as Error).message}`);
  }
});

experimentsPublicRouter.post('/gh-device/token', async (req, res) => {
  if (!experimentsConfig.ghClientId) return fail(res, 503, 'GitHub OAuth not configured');
  const deviceCode = req.body?.device_code;
  if (typeof deviceCode !== 'string' || !deviceCode) return fail(res, 400, 'device_code is required');
  try {
    const gh = await fetch(GH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: experimentsConfig.ghClientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    res.status(gh.status).json(await gh.json());
  } catch (err) {
    fail(res, 502, `GitHub token request failed: ${(err as Error).message}`);
  }
});

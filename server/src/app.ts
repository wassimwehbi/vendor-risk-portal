import express, { type Express, type Request } from 'express';
import cors, { type CorsOptionsDelegate } from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import passport from 'passport';
import SqliteStoreFactory from 'better-sqlite3-session-store';
import { db } from './db';
import { authConfig } from './services/auth';
import { configurePassport } from './auth/passport';
import { requireAuth, requireCsrf } from './middleware/auth';
import { resolveTenant, requireAdmin } from './middleware/tenant';
import vendorsRouter from './routes/vendors';
import assessmentsRouter from './routes/assessments';
import uploadRouter from './routes/upload';
import analysisRouter from './routes/analysis';
import reviewRouter from './routes/review';
import reportsRouter from './routes/reports';
import auditRouter from './routes/audit';
import demoRouter from './routes/demo';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import { experimentsPublicRouter, experimentsRouter } from './routes/experiments';
import { experimentsConfig } from './services/experiments';

const isProd = (process.env.NODE_ENV || 'development') === 'production';

/**
 * Builds the fully-configured Express app (middleware + routes) WITHOUT binding a
 * port. The production entrypoint (`index.ts`) calls this and then `listen`s;
 * integration tests mount the returned app directly with supertest, so no port is
 * opened and there is nothing to tear down. Keeping construction here (rather than
 * coupled to `app.listen`) is the only change required to make the API testable.
 *
 * This module deliberately does NOT `import './env'` — env loading is the caller's
 * job (the entrypoint `index.ts` imports `./env` first; tests set the env they need).
 * That keeps `createApp()` free of dotenv side effects so test runs stay deterministic
 * regardless of a developer's local `.env`.
 */
export function createApp(): Express {
  if (isProd && !process.env.AUTH_SECRET) {
    throw new Error('AUTH_SECRET must be set in production.');
  }
  // Dev login bypasses real authentication, so it must never be enabled in prod.
  if (isProd && authConfig.devMode) {
    throw new Error('AUTH_MODE=dev must not be used in production (dev login bypasses authentication).');
  }
  if (!process.env.AUTH_SECRET) {
    console.warn(
      '[vendor-risk-portal] AUTH_SECRET not set — using an insecure dev secret. Set AUTH_SECRET for any shared/prod use.',
    );
  }

  const app = express();
  app.set('trust proxy', 1);

  // Security headers. The SPA is hosted on a separate origin and reads this API via
  // fetch, so Cross-Origin-Resource-Policy must allow cross-origin (the helmet
  // default of `same-origin` would block the SPA → "Failed to fetch"). CORS below
  // still controls *who* may read responses.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // CORS. The app SPA gets CREDENTIALED access (prod: CLIENT_ORIGIN; dev: any localhost). The
  // experiments portal is a SEPARATE GitHub Pages origin with no app session, so it is granted
  // access ONLY to the two public experiment routes (results + device-flow relay) and WITHOUT
  // credentials — never to the authenticated/cookie API surface. EXPERIMENTS_PORTAL_ORIGIN is a
  // comma-separated allow-list (spec 0018) so a local portal dev server can be added alongside
  // production without juggling env between deploys; matching stays exact, not wildcard.
  const isLocalOrigin = (origin: string): boolean => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const isPortalPublicRoute = (path: string): boolean =>
    path.startsWith('/api/gh-device/') || /^\/api\/experiments\/[^/]+\/results$/.test(path);
  const corsDelegate: CorsOptionsDelegate<Request> = (req, cb) => {
    const origin = req.headers.origin;
    if (origin && experimentsConfig.portalOrigins.includes(origin)) {
      cb(null, isPortalPublicRoute(req.path) ? { origin: true, credentials: false } : { origin: false });
      return;
    }
    const allowed = !origin || origin === authConfig.clientOrigin || (authConfig.devMode && isLocalOrigin(origin));
    cb(null, { origin: allowed, credentials: true });
  };
  app.use(cors(corsDelegate));

  app.use(express.json({ limit: '2mb' }));

  // Server-side sessions persisted in SQLite (reuses the app DB).
  const SqliteStore = SqliteStoreFactory(session);
  app.use(
    session({
      name: 'vrp.sid',
      secret: authConfig.secret,
      resave: false,
      saveUninitialized: false,
      store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
      cookie: {
        httpOnly: true,
        // In production the SPA (Pages) and API (Render) are on different origins,
        // so the session cookie is cross-site: it must be SameSite=None (+Secure,
        // which browsers require for None) or the browser drops it and the user
        // appears logged out. Locally the SPA is same-origin via the Vite proxy,
        // so Lax is correct (and avoids needing HTTPS in dev).
        sameSite: isProd ? 'none' : 'lax',
        secure: isProd,
        maxAge: 8 * 60 * 60 * 1000, // 8h
      },
    }),
  );

  app.use(passport.initialize());
  configurePassport();

  // Generous limit across the whole API; stricter limits on the credential-
  // submitting auth endpoints are applied inside the auth router. Health is
  // registered first so it is not rate limited (probes).
  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      data: { status: 'ok', aiEngineAvailable: Boolean(process.env.ANTHROPIC_API_KEY) },
    });
  });

  const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 1000, standardHeaders: true, legacyHeaders: false });
  app.use('/api', apiLimiter);

  // Public auth endpoints (per-endpoint throttling for logins lives in the router).
  app.use('/api/auth', authRouter);

  // Experiment endpoints that must NOT require an app session: the portal (a separate
  // GitHub Pages origin) reads results with a bearer token, and the GitHub device-flow
  // relay runs pre-login. Mounted before requireAuth. The relay is rate-limited tighter
  // than the rest of the API since it makes outbound calls to GitHub.
  const deviceLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
  app.use('/api/gh-device', deviceLimiter);
  app.use('/api', experimentsPublicRouter);

  // Everything else requires an authenticated session + CSRF token on mutations.
  app.use('/api', requireAuth, requireCsrf);
  // Resolve the per-request tenant scope (req.scope) from the session + live
  // memberships. 403s unprovisioned non-admins.
  app.use('/api', resolveTenant);

  // Admin-only tenant/user management.
  app.use('/api/admin', requireAdmin, adminRouter);

  app.use('/api', vendorsRouter);
  app.use('/api', assessmentsRouter);
  app.use('/api', uploadRouter);
  app.use('/api', analysisRouter);
  app.use('/api', reviewRouter);
  app.use('/api', reportsRouter);
  app.use('/api', auditRouter);
  app.use('/api', demoRouter);
  app.use('/api', experimentsRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
  });

  return app;
}

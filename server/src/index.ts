import './env';
import { createApp } from './app';
import { authConfig } from './services/auth';
import { bootstrapMultiTenancy } from './services/bootstrap';
import { startR2UsageMonitor } from './services/r2UsageMonitor';

// One-time, idempotent data backfill for the multi-tenancy migration.
bootstrapMultiTenancy();

const app = createApp();

const PORT = Number(process.env.PORT) || 4100;
app.listen(PORT, () => {
  const p = [
    process.env.GOOGLE_CLIENT_ID ? 'google' : null,
    process.env.MICROSOFT_CLIENT_ID ? 'microsoft' : null,
    authConfig.smtpConfigured ? 'email' : null,
    authConfig.devMode ? 'dev-login' : null,
  ].filter(Boolean);
  console.log(`[vendor-risk-portal] server listening on http://localhost:${PORT}`);
  console.log(
    `[vendor-risk-portal] AI engine: ${process.env.ANTHROPIC_API_KEY ? 'Claude (key detected)' : 'rule-based fallback'}`,
  );
  console.log(`[vendor-risk-portal] auth providers: ${p.length ? p.join(', ') : 'none configured'}`);
  // Background R2 usage / overage monitor (inert unless configured).
  startR2UsageMonitor();
});

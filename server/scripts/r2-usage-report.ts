import '../src/env';
import { evaluateUsage, fetchR2Usage, sendAlert } from '../src/services/r2UsageMonitor';

/**
 * Manual live-validation for the R2 usage monitor. Queries the real Cloudflare
 * R2 Analytics API for the current month, prints the parsed usage and the
 * computed alert level / projected overage, and — with --send-test-alert —
 * actually sends the alert email so the full SMTP path can be validated too.
 *
 * Read-only against Cloudflare (analytics query only); it never changes R2 and,
 * unless --send-test-alert is passed, never sends email.
 *
 *   CLOUDFLARE_API_TOKEN=… R2_ACCOUNT_ID=… npm --prefix server run r2:check
 *   npm --prefix server run r2:check -- --send-test-alert
 *
 * Credentials are read from the project-root .env (see .env.example) like the
 * rest of the app.
 */
async function main(): Promise<void> {
  const sendTestAlert = process.argv.includes('--send-test-alert');
  const now = new Date();

  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.R2_ACCOUNT_ID) {
    console.error(
      'Missing CLOUDFLARE_API_TOKEN and/or R2_ACCOUNT_ID. Set them in the project-root .env\n' +
        '(token needs the "Account Analytics: Read" permission) and re-run.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('[r2:check] querying Cloudflare R2 analytics for the current month…');
  const usage = await fetchR2Usage(now);
  if (!usage) {
    console.error(
      '[r2:check] no usage returned — see the [r2-monitor] error logged above.\n' +
        'Most likely the token lacks "Account Analytics: Read" or R2_ACCOUNT_ID is wrong.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('[r2:check] raw month-to-date usage:');
  console.log(`           storageBytes=${usage.storageBytes}  classA=${usage.classA}  classB=${usage.classB}`);

  const wp = Number(process.env.R2_ALERT_WARN_PERCENT);
  const warnPercent = Number.isFinite(wp) && wp >= 0 && wp <= 100 ? wp : 80;
  const report = evaluateUsage(usage, now, warnPercent);
  console.log(`\n${report.summary}\n`);

  if (!sendTestAlert) {
    console.log('[r2:check] read-only check complete. Re-run with --send-test-alert to also send the alert email.');
    return;
  }

  console.log('[r2:check] sending a test alert email (validates the SMTP path)…');
  const dispatched = await sendAlert(report);
  if (dispatched) {
    console.log('[r2:check] test alert dispatched via SMTP.');
  } else {
    console.error(
      '[r2:check] alert NOT sent — SMTP is not configured or no recipient is set.\n' +
        'Configure SMTP_* and R2_ALERT_EMAIL (or ADMIN_EMAILS) to validate delivery.',
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[r2:check] failed: ${(err as Error).message}`);
  process.exitCode = 1;
});

// Generic UX regression runner — iterates the declarative manifest × viewports and
// asserts each scenario's invariants. To extend coverage, edit scenarios.ts only.
//
// Auth: each scenario reuses a role's session via storageState (minted once by the
// `setup` project, auth.setup.ts), so the suite never trips the login rate limit.
// Public scenarios (e.g. /login) run unauthenticated.
//
// PR check (blocking): structural + a11y invariants, no pixels.
// Nightly (advisory): UX_VISUAL=1 also runs toHaveScreenshot pixel diffs for `snapshot`
// scenarios. Baselines are generated on Linux CI only (see specs/0012, ux-regression.yml).
import { ROLE_STATE } from './auth';
import { SCENARIOS } from './scenarios';
import { expect, test } from './harness';

const VISUAL = process.env.UX_VISUAL === '1';

for (const s of SCENARIOS) {
  test.describe(s.id, () => {
    // Reuse the role's saved session; public scenarios stay signed out.
    test.use({ storageState: s.public ? undefined : ROLE_STATE[s.role] });

    for (const vp of s.viewports) {
      test(`${s.title} @ ${vp}`, async ({ page, uxHarness, consoleErrors }) => {
        await uxHarness.setViewport(vp);

        let assessmentId: string | null = null;

        for (const step of s.steps) {
          switch (step.kind) {
            case 'goto':
              await page.goto(step.path);
              break;
            case 'loadScenario': {
              await page.goto('/showcase');
              await page
                .getByRole('button', { name: 'Load & Analyze' })
                .nth(step.index ?? 0)
                .click();
              await expect(page).toHaveURL(/\/assessments\/\d+$/, { timeout: 30_000 });
              assessmentId = page.url().match(/\/assessments\/(\d+)/)?.[1] ?? null;
              break;
            }
            case 'gotoAssessmentSub':
              expect(assessmentId, 'gotoAssessmentSub requires a prior loadScenario').not.toBeNull();
              await page.goto(`/assessments/${assessmentId}/${step.sub}`);
              break;
            case 'click':
              await page.getByRole(step.role, { name: step.name }).click();
              break;
            case 'expectVisibleText':
              await expect(page.getByText(step.text).first()).toBeVisible();
              break;
          }
        }

        // Let the SPA settle before measuring layout / a11y.
        await page.waitForLoadState('networkidle');

        const has = (i: (typeof s.invariants)[number]) => s.invariants.includes(i);
        if (has('noHorizontalOverflow')) await uxHarness.expectNoHorizontalOverflow(`${s.id} @ ${vp}`);
        if (has('focusVisibleRing')) await uxHarness.expectFocusRing();
        if (has('printNoToolbar')) await uxHarness.expectPrintHidesChrome();
        if (has('axeClean')) await uxHarness.expectAxeClean();
        if (has('noConsoleErrors')) expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);

        if (s.snapshot && VISUAL) {
          await expect(page).toHaveScreenshot(`${s.id}-${vp}.png`, {
            fullPage: true,
            maxDiffPixelRatio: 0.01,
            animations: 'disabled',
          });
        }
      });
    }
  });
}

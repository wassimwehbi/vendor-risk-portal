// Playwright fixture + invariant helpers for the scenario-driven UX harness.
//
// All invariants here are deterministic and cross-platform-stable on purpose — they
// measure facts about the rendered DOM (a number, a list of a11y violations, a CSS
// box-shadow), never pixels. Pixel comparison lives in ux.spec.ts behind UX_VISUAL=1.
// Sign-in is handled once per role via storageState (auth.setup.ts), not here.
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';
import { VIEWPORTS, type ViewportName } from './scenarios';

// Pre-existing a11y debt in the current app — these axe rules fail pervasively today and
// are NOT regressions introduced by a PR. Baselining them (rule-level) keeps the harness a
// usable blocking gate while still catching every OTHER WCAG2A/AA rule. Burning this debt
// down and re-enabling these is a tracked follow-up (see specs/0012-ux-tasks-harness.md):
//   - color-contrast: muted slate-400 text (#94a3b8) on slate-50 (#f8fafc) ≈ 2.45:1.
//   - scrollable-region-focusable: the responsive `overflow-x-auto` table containers
//     (spec 0005) aren't keyboard-focusable.
export const KNOWN_AXE_DEBT = ['color-contrast', 'scrollable-region-focusable'];

export interface UxHarness {
  setViewport(v: ViewportName): Promise<void>;
  /** Page-level horizontal overflow ≤ 1px. Page-level on purpose: spec 0005 keeps wide
   *  tables in inner `overflow-x-auto` containers, which are expected, not failures. */
  expectNoHorizontalOverflow(label: string): Promise<void>;
  /** No serious/critical WCAG2A/AA violations (axe-core), excluding KNOWN_AXE_DEBT. */
  expectAxeClean(): Promise<void>;
  /** A shared styled control (a .btn-* or .input), when focused, shows the brand focus ring. */
  expectFocusRing(): Promise<void>;
  /** Under print media, no `.no-print` element is rendered (display:none). */
  expectPrintHidesChrome(): Promise<void>;
}

interface Fixtures {
  /** console.error / pageerror collected across the whole test (minus a known ignore-list). */
  consoleErrors: string[];
  uxHarness: UxHarness;
}

// Pre-existing, benign noise we don't want to fail the suite on. Keep this list tight.
const CONSOLE_IGNORE: RegExp[] = [
  /React Router Future Flag/i,
  /Download the React DevTools/i,
  /\[vite\] connect(ed|ing)/i,
];

export const test = base.extend<Fixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !CONSOLE_IGNORE.some((re) => re.test(m.text()))) {
        errors.push(m.text());
      }
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await use(errors);
  },

  uxHarness: async ({ page }, use) => {
    const harness: UxHarness = {
      async setViewport(v) {
        await page.setViewportSize(VIEWPORTS[v]);
      },

      async expectNoHorizontalOverflow(label) {
        // On failure, name the widest elements crossing the right edge so a regression
        // points straight at the offending node instead of just a pixel count.
        const { overflow, offenders } = await page.evaluate(() => {
          const root = document.scrollingElement || document.documentElement;
          // clientWidth excludes the scrollbar gutter, so a vertical scrollbar can't
          // masquerade as horizontal overflow on classic-scrollbar hosts.
          const w = document.documentElement.clientWidth;
          const overflow = root.scrollWidth - w;
          const offenders: string[] = [];
          if (overflow > 1) {
            for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
              const r = el.getBoundingClientRect();
              if (r.right <= w + 1 || r.width === 0) continue;
              const cls =
                typeof el.className === 'string'
                  ? el.className
                  : ((el.className as { baseVal?: string })?.baseVal ?? '');
              offenders.push(
                `${el.tagName.toLowerCase()}.${cls.split(/\s+/).slice(0, 3).join('.')} right=${Math.round(r.right)} w=${Math.round(r.width)}`,
              );
              if (offenders.length >= 8) break;
            }
          }
          return { overflow, offenders };
        });
        expect(
          overflow,
          `page-level horizontal overflow ${overflow}px (${label})${offenders.length ? `\n  offenders:\n   ${offenders.join('\n   ')}` : ''}`,
        ).toBeLessThanOrEqual(1);
      },

      async expectAxeClean() {
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa'])
          .disableRules(KNOWN_AXE_DEBT)
          .analyze();
        const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        const detail = blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
        expect(blocking, `axe serious/critical violations: ${JSON.stringify(detail, null, 2)}`).toEqual([]);
      },

      async expectFocusRing() {
        const result = await page.evaluate(() => {
          const sel = '.btn-primary, .btn-secondary, .btn-ghost, .input';
          const els = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(
            (el) => el.offsetParent !== null && !(el as HTMLInputElement).disabled,
          );
          if (els.length === 0) return { checked: false, ok: true, box: '' };
          const el = els[0];
          el.focus();
          const cs = getComputedStyle(el);
          // Utilities use focus:ring-* (a box-shadow). Outline is a fallback signal.
          return { checked: true, ok: cs.boxShadow !== 'none' || cs.outlineStyle !== 'none', box: cs.boxShadow };
        });
        expect(result.ok, `focus ring missing on first shared control (boxShadow="${result.box}")`).toBe(true);
      },

      async expectPrintHidesChrome() {
        await page.emulateMedia({ media: 'print' });
        try {
          const visible = await page.evaluate(
            () =>
              Array.from(document.querySelectorAll('.no-print')).filter(
                (el) => getComputedStyle(el as Element).display !== 'none',
              ).length,
          );
          expect(visible, '.no-print elements still visible in print media').toBe(0);
        } finally {
          await page.emulateMedia({ media: 'screen' });
        }
      },
    };
    await use(harness);
  },
});

export { expect };

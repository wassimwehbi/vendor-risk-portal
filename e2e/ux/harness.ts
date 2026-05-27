// Playwright fixture + invariant helpers for the scenario-driven UX harness.
//
// All invariants here are deterministic and cross-platform-stable on purpose — they
// measure facts about the rendered DOM (a number, a list of a11y violations, a CSS
// box-shadow), never pixels. Pixel comparison lives in ux.spec.ts behind UX_VISUAL=1.
// Sign-in is handled once per role via storageState (auth.setup.ts), not here.
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';
import { VIEWPORTS, type ViewportName } from './scenarios';

export interface UxHarness {
  setViewport(v: ViewportName): Promise<void>;
  /** Page-level horizontal overflow ≤ 1px. Page-level on purpose: spec 0005 keeps wide
   *  tables in inner `overflow-x-auto` containers, which are expected, not failures. */
  expectNoHorizontalOverflow(label: string): Promise<void>;
  /** No serious/critical WCAG2A/AA violations (axe-core). No rules are disabled. */
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

export const test = base.extend<Fixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    // No ignore-list: every console error / page error is a failure.
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
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
            // Name the widest elements crossing the right edge, skipping those inside an
            // overflow-clipping ancestor (their un-clipped rect extends past the edge but
            // they don't actually widen the page) — so a regression points at the real node.
            const clipsX = (el: Element) => {
              const ox = getComputedStyle(el).overflowX;
              return ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip';
            };
            const insideClip = (el: HTMLElement) => {
              for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
                if (clipsX(p)) return true;
              }
              return false;
            };
            for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
              const r = el.getBoundingClientRect();
              if (r.right <= w + 1 || r.width === 0 || insideClip(el)) continue;
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
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        const detail = blocking.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({
            target: n.target?.join(' '),
            msg: (n.any?.[0]?.message || n.failureSummary || '').slice(0, 180),
          })),
        }));
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

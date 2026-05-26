# E2E Test — Date Input Alignment (Issue #18)

Verify that the **Date submitted** input on the New Assessment form is left-aligned
and does not overflow the card on a mobile viewport (390×844).

## Steps

1. Sign in as a developer analyst:
   - Navigate to `/login`.
   - Click **Developer sign-in (local only)**.
   - Fill email `e2e-analyst@example.test`, role `Analyst`, tenant `E2E Co`.
   - Click **Sign in**.

2. Resize the viewport to **390×844** (iPhone 14 Pro).

3. Navigate to `/new`.

4. Assert the Date submitted input is visible and within card bounds:
   - Locate `input[type="date"].input` (the Date submitted field).
   - Assert it is visible.
   - Assert its `getBoundingClientRect().right` does not exceed the card container's `getBoundingClientRect().right` (no horizontal overflow).

5. Assert left-alignment via computed style:
   ```js
   const align = await page.evaluate(() => {
     const el = document.querySelector('input[type="date"].input');
     return window.getComputedStyle(el).textAlign;
   });
   expect(align).toBe('left');
   ```
   > Note: `getComputedStyle` on the host element returns the inherited `text-align`;
   > the WebKit pseudo-element fix ensures the shadow DOM respects it.

6. Take a screenshot of the form at mobile viewport:
   - `await page.screenshot({ path: 'e2e/screenshots/date-input-alignment.png' })`.

## Expected Result

- The Date submitted input is visible and fully contained within the card.
- The computed `text-align` of the date input is `left`.
- The screenshot shows the date value left-aligned, consistent with the other form fields.

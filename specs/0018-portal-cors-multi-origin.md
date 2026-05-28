# Spec 0018 — Experiments portal CORS: accept multiple origins

- **Status:** Implemented (2026-05-28)
- **Branch:** `feat/0018-portal-cors-multi-origin`
- **Location:**
  - `server/src/services/experiments.ts` — new `parsePortalOrigins` helper; `experimentsConfig.portalOrigin` (string) becomes `portalOrigins` (string[]).
  - `server/src/app.ts` — CORS delegate uses `portalOrigins.includes(origin)` instead of `=== portalOrigin`.
  - `.env.example` — documents the comma-separated format with the local-dev example.
  - `server/test/experiments.test.ts` — new `parsePortalOrigins` unit test.
- **Related docs:**
  `specs/0015-experimentation-platform.md` (the platform whose CORS gate this widens),
  `specs/0017-adw-experiment-authoring.md` (the spec whose local-dev workflow this unblocks).

## 1. Problem / Objective

The experiments portal lives on a separate origin from the API (GitHub Pages → Render). Spec
0015 introduced a CORS scope that allows exactly one portal origin — the one named in
`EXPERIMENTS_PORTAL_ORIGIN`. The deployed env holds `https://wassimwehbi.github.io`, which
lets the production portal hit `/api/gh-device/*` and `/api/experiments/:key/results`.

Running the portal locally during spec 0017 development surfaced the gap: the local Vite dev
server (defaults to `:5173`, falls back to `:5174` when 5173 is taken) is a distinct origin.
The server compares with `===`, so the deployed allow-list misses on every local request, the
`Access-Control-Allow-Origin` header isn't emitted, and the browser blocks the device-flow
fetch with "Failed to fetch". Confirmed with `curl -i -H 'Origin: …'`: the prod origin gets the
header, localhost does not.

There's no good single-origin workaround:
- Adding the localhost URL to the env *replaces* the prod one (breaking prod).
- Manually swapping the env between deploys is brittle and reverses every time `git push` to
  main triggers a redeploy.
- Asking developers to paste a personal access token into `sessionStorage` works for one-off
  UI testing but kills the device-flow path itself from local validation.

**Objective:** let one Render deployment carry a multi-origin allow-list — production + zero
or more localhost ports — without re-architecting CORS or weakening the exact-match contract.

## 2. Approach & Changes

One-line behavior change at the seam (server/src/app.ts:72): the gate that decided whether the
incoming `Origin` belongs to "the" portal now consults a small list of permitted origins
instead of a single string. Everything downstream (the public-route scoping, the
`credentials: false` lock, the per-route response shape) is unchanged.

### `parsePortalOrigins(raw)`

A pure helper at the top of `services/experiments.ts`:

```ts
export function parsePortalOrigins(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}
```

Splits on commas, trims, drops empties. `experimentsConfig.portalOrigins` calls it once at
module load. Absent env → empty list → `.includes(origin)` always returns false → the closed
default the prior code already produced.

### CORS delegate

```diff
- if (origin && experimentsConfig.portalOrigin && origin === experimentsConfig.portalOrigin) {
+ if (origin && experimentsConfig.portalOrigins.includes(origin)) {
```

The two facts that the prior code relied on stay:
- **Exact match only** — `Array.prototype.includes` uses strict equality, identical semantics
  to the old `===`. No wildcards, no substrings, no port loose-match. A typo in the env value
  is still a CORS failure rather than a silent accept.
- **Empty list = nobody** — `[].includes(anything)` is false, so an unconfigured server
  rejects portal traffic exactly like before.

### `.env.example`

Documents the new format with both shapes (single, prod + local) and the explicit warning
that matching is exact (no wildcards) and port-sensitive.

### Test

A unit test on `parsePortalOrigins` covers the env shapes the gate actually sees: single,
comma-separated with humanish spacing, stray-comma / blank-entry input, and absent env.
No integration CORS test because the existing test fixture deliberately doesn't set
`EXPERIMENTS_PORTAL_ORIGIN` (so the device-relay 503 path is the right shape to assert),
and adding one would require reloading the app with new env — bigger surface than the
one-line semantic change warrants.

## 3. Key Decisions & Rationale

### Comma-separated list, not a regex or wildcard

A regex would let the env owner accept ranges (e.g. `https?://localhost:.*`), which is
strictly less safe and would invite "I'll just allow `.*`" responses to the next dev-env
question. The explicit comma list keeps the security model identical to before, multiplied
by N origins rather than 1.

### Same env var name, additive semantics

`EXPERIMENTS_PORTAL_ORIGIN` keeps its name. A single-origin value (the production form) is
still valid because `'X'.split(',')` is `['X']` — old deploys don't break on the format change.

### CSV not JSON

`https://wassimwehbi.github.io,http://localhost:5174` is what someone would type from
muscle memory; the Render env UI is a single-line input. JSON (`'["…","…"]'`) would
require escape rules around quotes in the input form. CSV is the right ergonomic match for
the surface.

### No follow-up to "make this regex" or "accept HTTP for localhost only"

If the env owner wants localhost-only loose matching, the right place is *next to* the
existing `isLocalOrigin` regex used for the main client SPA. That's a different design
decision (loose-match by hostname pattern, not by exact equality) and would need a separate
review.

## 4. Verification

- `npm --prefix server run typecheck` — clean.
- `npm --prefix server test` — full suite passes including the new
  `parsePortalOrigins handles the env shapes the CORS gate actually sees` case.
- After Render redeploy with
  `EXPERIMENTS_PORTAL_ORIGIN=https://wassimwehbi.github.io,http://localhost:5174`:
  - `curl -i -X POST https://api.vendor-risk.wehbi.me/api/gh-device/code -H 'Origin:
    http://localhost:5174' -d '{}' -H content-type:application/json` returns
    `access-control-allow-origin: http://localhost:5174` (was: header absent on this branch
    point pre-PR).
  - Production portal (`https://wassimwehbi.github.io/vendor-risk-portal/`) still signs in.
  - A different localhost port (e.g. `http://localhost:5175`) gets no allow header — exact
    match preserved.

## 5. Known limitations / follow-ups

- **Each port has to be listed explicitly.** Vite's default is `:5173` and it auto-bumps to
  `:5174` / `:5175` when ports are busy; adding all three covers the common case. If this
  becomes annoying for contributors it's worth revisiting with an `isLocalOrigin`-style loose
  match scoped to the portal allow-list, but only after a deliberate review.
- **The list is whitespace-tolerant but not comment-tolerant.** A `# comment` in the env value
  is treated as a literal origin and never matches. Acceptable — Render's env UI is
  single-line and doesn't invite comments.
- **No env-time validation of malformed origins.** A garbage entry just never matches a real
  request; it doesn't crash boot. Tradeoff for keeping the helper a 3-line pure function.

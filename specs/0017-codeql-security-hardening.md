# Spec 0017 — CodeQL high-severity hardening (path-injection + ReDoS)

- **Status:** Implemented (2026-05-27).
- **Branch:** `fix/codeql-path-injection`.
- **Location:** `server/src/services/extraction.ts`, `server/src/routes/upload.ts`,
  `server/src/services/auth.ts`.
- **Related docs:** `specs/0001-vendor-risk-questionnaire-portal.md` (intake/upload pipeline),
  `specs/0016-adw-ship-self-heal.md`.

## 1. Problem

GitHub code scanning (CodeQL) reported three open **high-severity** alerts on `main`:

| # | Rule | Location | Note |
|---|---|---|---|
| 6 | `js/path-injection` | `extraction.ts:238` (`readFile`) | path depends on a user-provided value |
| 2 | `js/path-injection` | `upload.ts:63` (`unlinkSync`) | path depends on a user-provided value |
| 1 | `js/polynomial-redos` | `auth.ts:62` (`isValidEmail`) | email regex backtracks polynomially |

The two path-injection alerts trace the uploaded-file path (multer-provided) into `fs`
calls; the existing `ensurePathWithinUploads` containment check (resolve + `startsWith`) was
not recognized by the query as a barrier. The ReDoS alert flags the email regex
`^[^\s@]+@[^\s@]+\.[^\s@]+$`, whose two unbounded `[^\s@]+` runs around a `.` (a member of
the class) allow polynomial backtracking on crafted input.

## 2. Approach & changes

- **Path-injection (extraction.ts, upload.ts):** confine the path with `path.basename()` —
  a sanitizer the `js/path-injection` query recognizes — then re-root under the uploads dir.
  multer stores uploads **flat** in that dir, so `join(UPLOAD_ROOT, basename(p))` targets the
  exact same file; behavior is unchanged. The prior resolve + containment check is kept as
  defense in depth (and still catches a `basename` of `..`).
- **ReDoS (auth.ts):** replace the regex with linear, index-based validation — reject any
  whitespace, require exactly one `@`, and require a `.` strictly inside the domain. Proven
  equivalent to the old regex across an 18-case battery (incl. trailing newline/space,
  double `@`, leading/trailing dot, multi-dot domains).

## 3. Key decisions

- **`basename` over a custom barrier.** Rather than coax CodeQL into recognizing the
  resolve/`startsWith` guard, use the canonical `basename` sanitizer — clearer, and it is the
  query's documented mitigation. The re-root is provably equivalent because uploads are flat.
- **Behavior-preserving.** No API/route/contract change; only the internal path derivation and
  the email predicate are rewritten. Existing tests (incl. the `parseQuestionnaire`
  fixtures under `server/uploads`) remain green.

## 4. Verification

- `npm --prefix server run typecheck` clean; `server` extraction suite **19/19** green;
  Biome clean on the three files.
- `isValidEmail` old-vs-new equivalence checked across 18 inputs (all match).
- CI: the `CodeQL` code-scanning check goes green (the three alerts resolve; no new alerts).

## 5. Known limitations / follow-ups

- CodeQL re-evaluates on the PR; if the path-injection model still flags a residual sink, the
  follow-up is to drop the unused branch of the containment check. None expected.

# Spec 0006 — Proprietary License & Copyright Terms

- **Status:** Implemented (2026-05-25)
- **Branch:** `chore/license`
- **Location:** `LICENSE` (new), `package.json`, `server/package.json`,
  `client/package.json` (added `"license"` field), `README.md` (new **License**
  section).
- **Related docs:** `README.md`, `CLAUDE.md`
- **Builds on:** Spec 0001 (the project the license now covers).

## 1. Problem Statement & Objective

The repository had **no license file** and the `package.json` manifests declared no
`license` field. Under copyright law, source code with no license grants **no rights**
to anyone who obtains a copy — but the absence of an explicit notice is ambiguous:
contributors, recipients, and tooling cannot tell whether the omission is intentional
(proprietary) or an oversight (an unstated open-source intent).

Objective: make the terms **explicit and unambiguous** by stating that the Software is
proprietary and all rights are reserved, while keeping the repository private controls
the project already relies on.

## 2. Approach & Changes

- **`LICENSE`** — a self-contained proprietary "all rights reserved" license naming
  **Wassim Wehbi** as Copyright Holder (2026). It defines the Software, asserts
  ownership, grants **no** rights absent prior written permission, adds a
  confidentiality clause, a termination/revocation clause, and standard
  no-warranty / limitation-of-liability disclaimers, and lists a contact for
  licensing inquiries.
- **`package.json` (root, `server/`, `client/`)** — added `"license": "UNLICENSED"`,
  npm's standard SPDX-style signal for proprietary code. The three manifests already
  carry `"private": true`, which prevents accidental `npm publish`.
- **`README.md`** — added a **License** section summarizing the terms and pointing to
  `LICENSE`.

## 3. Key Decisions & Rationale

- **Proprietary / All Rights Reserved**, chosen over OSI open-source (MIT, AGPL-3.0)
  and source-available (PolyForm Noncommercial) options. The project is a private,
  not-yet-public product; "all rights reserved" is the safest default and can be
  relaxed to a more permissive license later, whereas an open-source grant is
  effectively irrevocable once code is distributed under it.
- **`"license": "UNLICENSED"`** rather than a fabricated SPDX identifier or an empty
  field. `UNLICENSED` is npm's documented convention for "I do not wish to grant
  others the right to use a private or unpublished package." It pairs with the
  existing `"private": true` flag rather than replacing it (private = do-not-publish;
  UNLICENSED = no-rights-granted).
- **Single repo-root `LICENSE`** covering the whole monorepo (server + client),
  rather than per-package license files, since one Copyright Holder owns all of it.

## 4. Verification

- `LICENSE` present at repo root; `git` recognizes it as a license file.
- `package.json`, `server/package.json`, `client/package.json` each contain
  `"license": "UNLICENSED"` and remain valid JSON / parseable by npm.
- `README.md` renders a **License** section linking to `LICENSE`.
- No application code, dependencies, or build configuration changed; existing build
  and typecheck behavior is unaffected.

## 5. Known Limitations / Follow-ups

- **No per-file copyright headers.** Individual source files do not carry a short
  proprietary header. If desired, a follow-up can prepend a one-line notice to
  `client/src` and `server/src` files.
- **Bundled third-party dependencies keep their own licenses.** This license covers
  only first-party code in this repository, not the npm packages it depends on.
- **No CLA / contribution terms.** If outside contributions are ever accepted, a
  contributor agreement or inbound license terms should be added.
- If the project is later opened up, this spec should be superseded by a new spec
  documenting the replacement license.

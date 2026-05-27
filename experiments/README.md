# Experiments — config-as-code

This directory is the **single source of truth** for the A/B testing platform
(see [`specs/0015-experimentation-platform.md`](../specs/0015-experimentation-platform.md)).
Each `*.yml` file defines one experiment; [`schema.json`](./schema.json) is the contract.

## Lifecycle

```
propose (PR / portal)  →  CI validates  →  merge to main  →  Render redeploys  →  variants served
```

- Editing an experiment means **opening a PR** that changes a file here. The
  `experiments` CI check ([`.github/workflows/validate-experiments.yml`](../.github/workflows/validate-experiments.yml))
  must be green to merge.
- **Pausing / killing** a live experiment = merge a change setting `status: paused`.
  It goes live on the next deploy (a few minutes — there is no instant kill-switch by design).
- Only `status: running` experiments assign variants. `draft`, `paused`, and
  `completed` all serve the **control** (the first variant) to everyone.

## Rules enforced by CI

- Each file matches `schema.json` (types, enums, required fields).
- `key` is unique and **equals the filename** (e.g. `dashboard-cta.yml` → `key: dashboard-cta`).
- Variant `weight`s **sum to 100**; variant keys are unique.
- `start` ≤ `end` when both are set.
- No two `running` experiments target **overlapping audiences on the same `surface`**.

## Authoring locally

```bash
node scripts/experiments.mjs validate   # same check CI runs
node scripts/experiments.mjs build       # emit server/src/data/experiments.json (used by the server)
```

# Experiments portal

The custom-UX **experimentation portal** for the Vendor Risk Portal A/B platform
(spec [`0015`](../specs/0015-experimentation-platform.md), phase 4). A standalone
Vite + React SPA, deployed to **GitHub Pages** by
[`.github/workflows/portal-pages.yml`](../.github/workflows/portal-pages.yml).

It is the management plane for experiments — but **GitHub stays the source of truth**: the portal
authors changes by opening pull requests against [`experiments/`](../experiments), which the
`experiments` CI check validates and which redeploy the app on merge.

## What it does

- **Sign in with GitHub** via the OAuth **device flow**, relayed through the server's
  `/api/gh-device/*` (no client secret in the browser). The token lives in `sessionStorage`.
- **Reads** the experiment YAML straight from the repo (GitHub Contents API) and **live results**
  from the server's `GET /api/experiments/:key/results` (bearer token entered once in Settings,
  stored in `localStorage`).
- **Authors** experiments — New / Edit / Pause compose the YAML and **open a PR**. Nothing is
  written directly; every change is reviewed + CI-validated + auto-deployed on merge.

## Develop

```bash
npm --prefix portal install
npm --prefix portal run dev        # defaults to the prod API + repo (see src/config.ts)
npm --prefix portal run build      # tsc --noEmit && vite build
```

Build-time env (injected by the Pages workflow; defaults target prod):

| Var | Default | Purpose |
|-----|---------|---------|
| `VITE_API_BASE` | `https://api.vendor-risk.wehbi.me` | Render API: device-flow relay + results |
| `VITE_REPO` | `wassimwehbi/vendor-risk-portal` | repo the portal reads YAML from / opens PRs against |

## Server prerequisites (set on Render)

The portal is inert until the API has: `GH_OAUTH_CLIENT_ID` (the OAuth app, device flow enabled),
`EXPERIMENTS_READ_TOKEN` (gates results), and `EXPERIMENTS_PORTAL_ORIGIN` (CORS allow-list for the
Pages origin). See spec 0015.

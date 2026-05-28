// Build-time config (injected by the Pages deploy workflow; defaults target prod so the portal
// works without env). API_BASE is the Render API (device-flow relay + results); REPO is where
// the experiment YAML lives and PRs are opened.
export const API_BASE = (import.meta.env.VITE_API_BASE ?? 'https://api.vendor-risk.wehbi.me').replace(/\/+$/, '');
export const REPO = import.meta.env.VITE_REPO ?? 'wassimwehbi/vendor-risk-portal';
export const EXPERIMENTS_DIR = 'experiments';
// Label that triggers the repo's ADW pipeline (.github/workflows/adw-zte.yml fires on issue
// `opened`/`labeled` events whose labels contain this string). Used by the "Create with AI" flow.
export const ADW_LABEL = 'adw:zte';

// GitHub REST client (browser): reads the experiment YAML from the repo and opens PRs to author
// changes. Authenticated with the device-flow token (5000 req/h; reads also work unauthenticated at
// 60 req/h). api.github.com supports CORS for these calls.
import { EXPERIMENTS_DIR, REPO } from '../config';
import type { Catalog, LoadedExperiment } from '../types';
import { parseCatalog, parseExperiment } from './yaml';

const GH = 'https://api.github.com';

interface GhInit {
  method?: string;
  body?: unknown;
  token?: string;
}

async function gh<T>(path: string, init: GhInit = {}): Promise<T> {
  const res = await fetch(`${GH}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `GitHub ${res.status}`);
  return data as T;
}

function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface Viewer {
  login: string;
  avatar_url: string;
}

export function getViewer(token: string): Promise<Viewer> {
  return gh<Viewer>('/user', { token });
}

/**
 * Repo-level permissions for the signed-in user. We only care about `push` — it mirrors the
 * server's collaborator gate for results, and the `adw-zte.yml` workflow's `author_association`
 * gate (OWNER/MEMBER/COLLABORATOR). The portal hides the "Create with AI" CTA when push is
 * false so a non-collaborator doesn't silently file an issue ADW will then ignore.
 */
export function getRepoPermissions(token: string): Promise<{ push: boolean }> {
  return gh<{ permissions?: { push?: boolean } }>(`/repos/${REPO}`, { token }).then((r) => ({
    push: r.permissions?.push === true,
  }));
}

/**
 * Fetch + parse experiments/catalog.yml. The catalog is the source of truth for what's available
 * to A/B test today (spec 0017 refinement). On any failure (404, decode, parse, shape), throws —
 * the caller (App) turns the error into the fail-closed banner. We deliberately don't fall back
 * to file-path pickers: the catalog IS the contract.
 */
export async function fetchCatalog(token?: string): Promise<Catalog> {
  const file = await gh<FileContent>(`/repos/${REPO}/contents/${EXPERIMENTS_DIR}/catalog.yml`, { token });
  return parseCatalog(decodeBase64(file.content));
}

/**
 * Create a GitHub issue with labels in a single call. `adw-zte.yml` fires on `issues: opened` AND
 * checks the labels array on the same event, so creating with `labels: ['adw:zte']` triggers ADW
 * directly — no separate label call needed.
 */
export function createIssue(
  token: string,
  opts: { title: string; body: string; labels: string[] },
): Promise<{ html_url: string; number: number }> {
  return gh<{ html_url: string; number: number }>(`/repos/${REPO}/issues`, {
    token,
    method: 'POST',
    body: opts,
  });
}

interface ContentItem {
  name: string;
  type: string;
}
interface FileContent {
  content: string;
  sha: string;
}

// Filenames in experiments/ that are valid YAML but are NOT experiment cards (catalog.yml is
// a distinct schema — see spec 0019). Mirrors RESERVED_NAMES in scripts/experiments.mjs so the
// portal's dashboard doesn't try to parse them as Experiments and crash on the missing fields.
const RESERVED_EXPERIMENT_FILES = new Set(['catalog.yml', 'catalog.yaml']);

/** List + parse every experiment YAML in the repo's experiments/ directory. */
export async function listExperiments(token?: string): Promise<LoadedExperiment[]> {
  const items = await gh<ContentItem[]>(`/repos/${REPO}/contents/${EXPERIMENTS_DIR}`, { token });
  const ymls = items
    .filter((i) => i.type === 'file' && /\.ya?ml$/.test(i.name) && !RESERVED_EXPERIMENT_FILES.has(i.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const loaded = await Promise.all(
    ymls.map(async ({ name }) => {
      const file = await gh<FileContent>(`/repos/${REPO}/contents/${EXPERIMENTS_DIR}/${name}`, { token });
      try {
        return { file: name, exp: parseExperiment(decodeBase64(file.content)) };
      } catch (e) {
        throw new Error(`${name}: ${(e as Error).message}`); // surface which file is invalid
      }
    }),
  );
  return loaded;
}

interface RefResponse {
  object: { sha: string };
}

/**
 * Open a PR that creates or updates experiments/<key>.yml. Branches off main, commits the file,
 * and opens the PR — so every change flows through review + the `experiments` CI check +
 * auto-redeploy on merge. Returns the PR URL.
 */
export async function openExperimentPR(
  token: string,
  key: string,
  yamlContent: string,
  opts: { title: string; body: string },
): Promise<string> {
  const base = await gh<RefResponse>(`/repos/${REPO}/git/ref/heads/main`, { token });
  const branch = `portal/exp-${key}-${Date.now()}`;
  await gh(`/repos/${REPO}/git/refs`, {
    token,
    method: 'POST',
    body: { ref: `refs/heads/${branch}`, sha: base.object.sha },
  });

  // If the file already exists on main, we must pass its blob sha to update it.
  let sha: string | undefined;
  try {
    const existing = await gh<FileContent>(`/repos/${REPO}/contents/${EXPERIMENTS_DIR}/${key}.yml?ref=main`, { token });
    sha = existing.sha;
  } catch {
    /* new file */
  }

  await gh(`/repos/${REPO}/contents/${EXPERIMENTS_DIR}/${key}.yml`, {
    token,
    method: 'PUT',
    body: { message: opts.title, content: encodeBase64(yamlContent), branch, sha },
  });

  const pr = await gh<{ html_url: string }>(`/repos/${REPO}/pulls`, {
    token,
    method: 'POST',
    body: { title: opts.title, head: branch, base: 'main', body: opts.body },
  });
  return pr.html_url;
}

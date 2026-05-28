// GitHub REST client (browser): reads the experiment YAML from the repo and opens PRs to author
// changes. Authenticated with the device-flow token (5000 req/h; reads also work unauthenticated at
// 60 req/h). api.github.com supports CORS for these calls.
import { EXPERIMENTS_DIR, REPO } from '../config';
import type { LoadedExperiment } from '../types';
import { parseExperiment } from './yaml';

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

interface ContentItem {
  name: string;
  type: string;
}
interface FileContent {
  content: string;
  sha: string;
}

/** List + parse every experiment YAML in the repo's experiments/ directory. */
export async function listExperiments(token?: string): Promise<LoadedExperiment[]> {
  const items = await gh<ContentItem[]>(`/repos/${REPO}/contents/${EXPERIMENTS_DIR}`, { token });
  const ymls = items.filter((i) => i.type === 'file' && /\.ya?ml$/.test(i.name)).sort((a, b) => a.name.localeCompare(b.name));
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

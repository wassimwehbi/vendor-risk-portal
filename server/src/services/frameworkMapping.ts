import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FrameworkMapping } from '../types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS_PATH = join(__dirname, '..', 'data', 'frameworks.json');

type FrameworkFile = Record<string, Record<string, string[]>> & { _version?: string };

let cache: FrameworkFile | null = null;

function load(): FrameworkFile {
  if (cache) return cache;
  cache = JSON.parse(readFileSync(FRAMEWORKS_PATH, 'utf8')) as FrameworkFile;
  return cache;
}

/**
 * Returns the framework references mapped to a given control domain.
 * The mapping library is configurable via server/src/data/frameworks.json.
 */
export function getMapping(domain: string): FrameworkMapping[] {
  const data = load();
  const entry = data[domain] ?? data['Uncategorized'] ?? {};
  const mappings: FrameworkMapping[] = [];
  for (const [framework, references] of Object.entries(entry)) {
    if (framework.startsWith('_')) continue;
    if (Array.isArray(references) && references.length > 0) {
      mappings.push({ framework, references });
    }
  }
  return mappings;
}

export function getMappingVersion(): string {
  return load()._version ?? 'unversioned';
}

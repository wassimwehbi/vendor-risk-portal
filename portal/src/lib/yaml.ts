import yaml from 'js-yaml';
import type { Catalog, CatalogPage, Experiment } from '../types';

/**
 * Parse an experiment YAML file. JSON_SCHEMA keeps dates as strings (matches the server/validator).
 * Validates the basic shape and throws a clear error on empty/invalid YAML, so the caller can
 * surface *which* file is broken rather than crashing later on `exp.key`/`exp.variants`.
 */
export function parseExperiment(raw: string): Experiment {
  const data = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('not a valid experiment (YAML did not parse to an object)');
  }
  const exp = data as Partial<Experiment>;
  if (typeof exp.key !== 'string' || typeof exp.name !== 'string' || !Array.isArray(exp.variants)) {
    throw new Error('missing required fields (key, name, variants[])');
  }
  return exp as Experiment;
}

/**
 * Serialize an experiment to YAML for a PR. Emits keys in a stable, readable order with the
 * editor schema hint; block style is valid config-as-code (the `experiments` CI check validates the
 * PR authoritatively). Empty optional sections are omitted.
 */
export function toYaml(exp: Experiment): string {
  const doc: Record<string, unknown> = { key: exp.key, name: exp.name };
  if (exp.hypothesis) doc.hypothesis = exp.hypothesis;
  if (exp.owner) doc.owner = exp.owner;
  if (exp.surface) doc.surface = exp.surface;
  doc.status = exp.status;
  if (exp.created) doc.created = exp.created;
  if (exp.start) doc.start = exp.start;
  if (exp.end) doc.end = exp.end;
  doc.variants = exp.variants;
  if (exp.targeting && (exp.targeting.roles?.length || exp.targeting.tenants?.length)) doc.targeting = exp.targeting;
  if (exp.metrics?.primary) doc.metrics = exp.metrics;
  if (exp.tracking_issue) doc.tracking_issue = exp.tracking_issue;

  const body = yaml.dump(doc, { lineWidth: 100, quotingType: '"', schema: yaml.JSON_SCHEMA });
  return `# yaml-language-server: $schema=./schema.json\n${body}`;
}

/**
 * Parse experiments/catalog.yml. Shape-validates the basic structure (version + pages array of
 * objects with id/title/actions). Authoritative validation happens in CI via the JSON Schema;
 * this client-side check exists so the portal can fail-closed cleanly when the catalog is
 * malformed at runtime, and so a parse error names the offending field instead of crashing.
 */
export function parseCatalog(raw: string): Catalog {
  const data = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('catalog.yml did not parse to an object');
  }
  const c = data as Partial<Catalog>;
  if (c.version !== 1) throw new Error('catalog.yml: unsupported version (expected 1)');
  if (!Array.isArray(c.pages)) throw new Error('catalog.yml: missing pages[]');
  for (const page of c.pages) {
    if (!page || typeof page !== 'object' || Array.isArray(page)) throw new Error('catalog.yml: a page is not an object');
    const p = page as Partial<CatalogPage>;
    if (typeof p.id !== 'string' || typeof p.title !== 'string' || !Array.isArray(p.actions)) {
      throw new Error(`catalog.yml: page "${p.id ?? '?'}" is missing id/title/actions`);
    }
  }
  return c as Catalog;
}

import yaml from 'js-yaml';
import type { Catalog, CatalogAction, CatalogMetric, CatalogPage, Experiment } from '../types';

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
 * Parse experiments/catalog.yml. Shape-validates the whole tree — version + each page + each
 * action + each metric — so a malformed row doesn't silently render as a 'Live' picker option
 * and then fail somewhere downstream with an opaque error. The contract here mirrors
 * experiments/catalog.schema.json (the JSON Schema is the authoritative validator in CI);
 * keeping these two in sync is the trade-off of doing client-side shape-checks at all.
 *
 * The promise this function makes — and that the App's fail-closed banner relies on — is that
 * a parse failure names the offending field instead of crashing somewhere later.
 */
const VALID_METRIC_STATUS: ReadonlySet<string> = new Set<string>(['instrumented', 'proposed']);

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
    const where = `page "${p.id}"`;
    for (const action of p.actions) {
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        throw new Error(`catalog.yml: ${where} has an action that is not an object`);
      }
      const a = action as Partial<CatalogAction>;
      if (typeof a.id !== 'string' || typeof a.title !== 'string' || typeof a.description !== 'string') {
        throw new Error(`catalog.yml: ${where} action "${a.id ?? '?'}" is missing id/title/description`);
      }
      if (a.metric !== undefined) {
        if (!a.metric || typeof a.metric !== 'object' || Array.isArray(a.metric)) {
          throw new Error(`catalog.yml: ${where} action "${a.id}" has a non-object metric`);
        }
        const m = a.metric as Partial<CatalogMetric>;
        if (typeof m.key !== 'string' || m.key === '') {
          throw new Error(`catalog.yml: ${where} action "${a.id}" metric is missing key`);
        }
        if (typeof m.fires_in !== 'string' || m.fires_in === '') {
          throw new Error(`catalog.yml: ${where} action "${a.id}" metric "${m.key}" is missing fires_in`);
        }
        if (typeof m.status !== 'string' || !VALID_METRIC_STATUS.has(m.status)) {
          throw new Error(`catalog.yml: ${where} action "${a.id}" metric "${m.key}" has invalid status "${m.status}" (expected instrumented | proposed)`);
        }
        if (m.handler_hint !== undefined && typeof m.handler_hint !== 'string') {
          throw new Error(`catalog.yml: ${where} action "${a.id}" metric "${m.key}" handler_hint must be a string`);
        }
      }
    }
  }
  return c as Catalog;
}

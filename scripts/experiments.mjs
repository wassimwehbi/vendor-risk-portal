#!/usr/bin/env node
/**
 * Experiment registry tool — validate and build the A/B testing config-as-code.
 * See specs/0015-experimentation-platform.md.
 *
 *   node scripts/experiments.mjs validate   CI gate: schema + cross-file invariants (exit 1 on error)
 *   node scripts/experiments.mjs build       emit server/src/data/experiments.json (validates first)
 *
 * Pure Node + js-yaml + ajv; runs at the repo root, no app build required.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPERIMENTS_DIR = join(ROOT, 'experiments');
const SCHEMA_PATH = join(EXPERIMENTS_DIR, 'schema.json');
const CATALOG_PATH = join(EXPERIMENTS_DIR, 'catalog.yml');
const CATALOG_SCHEMA_PATH = join(EXPERIMENTS_DIR, 'catalog.schema.json');
const OUTPUT_PATH = join(ROOT, 'server', 'src', 'data', 'experiments.json');
const CLIENT_SRC = join(ROOT, 'client', 'src');

/** Read and parse every experiment YAML in the directory (sorted, stable order). */
function loadExperiments() {
  // catalog.yml lives in the same directory but is a distinct schema — exclude it.
  const RESERVED_NAMES = new Set(['catalog.yml', 'catalog.yaml']);
  const files = readdirSync(EXPERIMENTS_DIR)
    .filter((f) => (f.endsWith('.yml') || f.endsWith('.yaml')) && !RESERVED_NAMES.has(f))
    .sort();
  return files.map((file) => {
    try {
      // JSON_SCHEMA (not the default) keeps `2026-05-27` a string instead of a Date, and avoids
      // YAML 1.1 surprises like unquoted `yes`/`no` becoming booleans — predictable config types.
      const data = yaml.load(readFileSync(join(EXPERIMENTS_DIR, file), 'utf8'), { schema: yaml.JSON_SCHEMA });
      return { file, data, parseError: null };
    } catch (err) {
      return { file, data: null, parseError: err.message };
    }
  });
}

/**
 * Two audiences overlap when their roles AND tenants both intersect. An omitted OR EMPTY
 * facet means "everyone", so it overlaps with anything.
 *
 * NB: this "empty/omitted = everyone" rule is intentionally mirrored in the server's
 * `eligible()` (server/src/services/experiments.ts). The JSON Schema only checks shape, not
 * these semantics — keep the two in sync (a shared test would be the deeper fix; see spec 0015).
 */
function audiencesOverlap(a = {}, b = {}) {
  const everyone = (arr) => !arr || arr.length === 0;
  const rolesOverlap = everyone(a.roles) || everyone(b.roles) || a.roles.some((r) => b.roles.includes(r));
  const tenantsOverlap = everyone(a.tenants) || everyone(b.tenants) || a.tenants.some((t) => b.tenants.includes(t));
  return rolesOverlap && tenantsOverlap;
}

/**
 * Load + validate every experiment. Returns the error list and the experiments that PASSED
 * schema validation (semantic checks + the build output only ever consider these, so a
 * schema-invalid file can never crash a later check or leak into the compiled registry).
 */
function collect() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const validateSchema = new Ajv({ allErrors: true }).compile(schema);
  const loaded = loadExperiments();
  const errors = [];
  const keyToFile = new Map();
  const valid = []; // [{ file, data }] that passed JSON Schema

  for (const { file, data, parseError } of loaded) {
    if (parseError) {
      errors.push(`${file}: YAML parse error — ${parseError}`);
      continue;
    }
    if (!validateSchema(data)) {
      for (const e of validateSchema.errors) errors.push(`${file}: ${e.instancePath || '/'} ${e.message}`);
      continue; // schema-invalid: skip the semantic checks below (they assume a well-formed shape)
    }

    const expectedKey = basename(file).replace(/\.(yml|yaml)$/, '');
    if (data.key !== expectedKey) errors.push(`${file}: key "${data.key}" must equal filename "${expectedKey}"`);

    if (keyToFile.has(data.key)) errors.push(`${file}: duplicate key "${data.key}" (also in ${keyToFile.get(data.key)})`);
    else keyToFile.set(data.key, file);

    const sum = data.variants.reduce((acc, v) => acc + v.weight, 0);
    if (sum !== 100) errors.push(`${file}: variant weights sum to ${sum}, must be 100`);

    const variantKeys = data.variants.map((v) => v.key);
    if (new Set(variantKeys).size !== variantKeys.length) errors.push(`${file}: duplicate variant keys`);

    if (data.start && data.end && data.start > data.end) errors.push(`${file}: start (${data.start}) is after end (${data.end})`);

    valid.push({ file, data });
  }

  // No two running experiments may collide on the same surface for overlapping audiences.
  // Only schema-valid entries are considered, so targeting shapes here are well-formed.
  const running = valid.filter(({ data }) => data.status === 'running' && data.surface);
  for (let i = 0; i < running.length; i++) {
    for (let j = i + 1; j < running.length; j++) {
      const a = running[i];
      const b = running[j];
      if (a.data.surface === b.data.surface && audiencesOverlap(a.data.targeting, b.data.targeting)) {
        errors.push(`${a.file} & ${b.file}: two running experiments overlap on surface "${a.data.surface}"`);
      }
    }
  }

  // Dead-experiment guard (spec 0017): an experiment is two artifacts in two languages — a YAML
  // card AND a product-code `useVariant('<key>')` / `trackEvent('<metric>')` wiring — with no
  // typed link between them. A typo silently serves control forever and ships green. Catch it here.
  // Errors only for `running` (a live experiment that's inert is the worst, silent failure);
  // drafts/paused/completed and unwired SECONDARY metrics are warnings, so the autonomous draft PR
  // stays green and the human draft→running Edit PR is the gate that protects the live flip.
  const warnings = [];
  const clientSource = readClientSource();
  const sourceByFile = clientSource !== null ? readClientSourceByFile() : null;
  if (clientSource === null) {
    warnings.push('client/src not found — skipping dead-experiment guard (key/metric ↔ code linkage)');
  } else {
    for (const { data } of valid) {
      const severity = data.status === 'running' ? 'error' : 'warning';
      const sink = severity === 'error' ? errors : warnings;
      if (!hasLiteralCall(clientSource, ['useVariant', 'useFlag'], data.key)) {
        sink.push(`${data.key}: no useVariant('${data.key}') or useFlag('${data.key}') in client/src (${severity} — status: ${data.status})`);
      }
      if (data.metrics?.primary && !hasLiteralCall(clientSource, ['trackEvent'], data.metrics.primary)) {
        sink.push(`${data.key}: primary metric "${data.metrics.primary}" is not fired via trackEvent in client/src (${severity} — status: ${data.status})`);
      }
      // Secondary metrics: warning regardless of status — they're often aspirational.
      for (const metric of data.metrics?.secondary ?? []) {
        if (!hasLiteralCall(clientSource, ['trackEvent'], metric)) {
          warnings.push(`${data.key}: secondary metric "${metric}" is not fired via trackEvent in client/src (warning)`);
        }
      }
    }
  }

  // Catalog drift checks (spec 0017 refinement). The catalog is the PM-facing contract for the
  // "Create with AI" picker — every entry must be grounded in code, and conversely every code
  // trackEvent should publish itself to PMs via a catalog row. See experiments/catalog.yml.
  const { data: catalog, errors: catalogErrors, missing: catalogMissing } = loadCatalog();
  errors.push(...catalogErrors);
  if (catalogMissing) {
    warnings.push('experiments/catalog.yml not found — skipping catalog drift checks (the portal will fail-closed)');
  } else if (catalog && sourceByFile) {
    const { errors: ce, warnings: cw } = crossCheckCatalog(catalog, sourceByFile, clientSource);
    errors.push(...ce);
    warnings.push(...cw);
  } else if (catalog && !sourceByFile) {
    // catalog parsed cleanly but client/src is missing. The dead-experiment block above already
    // warned about its own skip; emit a symmetric warning here so an operator can't conclude
    // (silently) that the catalog passed bidirectional validation when in fact it was never
    // cross-checked. Matches the asymmetry the prior code accidentally introduced.
    warnings.push('client/src not found — skipping catalog drift checks (catalog↔code linkage unverified)');
  }

  return { errors, warnings, experiments: valid.map((v) => v.data) };
}

/**
 * Load + schema-validate the catalog. Missing catalog is a soft state (caller decides severity);
 * schema-invalid catalog is an error. The schema read + Ajv.compile are also try/catch'd so a
 * missing or corrupt catalog.schema.json produces a curated error rather than crashing the
 * validator with a raw stack trace. Returns { data, errors, missing }.
 */
function loadCatalog() {
  if (!existsSync(CATALOG_PATH)) return { data: null, errors: [], missing: true };
  let parsed;
  try {
    parsed = yaml.load(readFileSync(CATALOG_PATH, 'utf8'), { schema: yaml.JSON_SCHEMA });
  } catch (err) {
    return { data: null, errors: [`catalog.yml: YAML parse error — ${err.message}`], missing: false };
  }
  let validate;
  try {
    const schema = JSON.parse(readFileSync(CATALOG_SCHEMA_PATH, 'utf8'));
    validate = new Ajv({ allErrors: true }).compile(schema);
  } catch (err) {
    return { data: null, errors: [`catalog.schema.json could not be loaded — ${err.message}`], missing: false };
  }
  if (!validate(parsed)) {
    return { data: null, errors: validate.errors.map((e) => `catalog.yml: ${e.instancePath || '/'} ${e.message}`), missing: false };
  }
  return { data: parsed, errors: [], missing: false };
}

/**
 * Bidirectional catalog ↔ code drift checks. Errors when the catalog *lies* (claims to be
 * instrumented but isn't); warnings everywhere else, so the autonomous ADW PR stays green and
 * humans iterate via subsequent PRs. The reverse direction (code-without-catalog) nudges
 * engineers to publish new metrics for PM use.
 */
function crossCheckCatalog(catalog, sourceByFile, clientSource) {
  const errors = [];
  const warnings = [];
  const declaredMetricKeys = new Set();
  const pageIds = new Set();
  const actionIdsByPage = new Map();

  for (const page of catalog.pages) {
    // Uniqueness of page ids (the schema enforces shape, not uniqueness).
    if (pageIds.has(page.id)) errors.push(`catalog.yml: duplicate page id "${page.id}"`);
    pageIds.add(page.id);

    // page.file must exist on disk. Resolved against the repo root.
    const pageAbs = join(ROOT, page.file);
    if (!existsSync(pageAbs)) errors.push(`catalog.yml: page "${page.id}" references missing file ${page.file}`);

    const seenActions = new Set();
    actionIdsByPage.set(page.id, seenActions);
    for (const action of page.actions) {
      if (seenActions.has(action.id)) errors.push(`catalog.yml: duplicate action id "${page.id}/${action.id}"`);
      seenActions.add(action.id);

      const m = action.metric;
      if (!m) continue;
      declaredMetricKeys.add(m.key);

      const firesInAbs = join(ROOT, m.fires_in);
      if (!existsSync(firesInAbs)) {
        errors.push(`catalog.yml: ${page.id}/${action.id} metric "${m.key}" fires_in references missing file ${m.fires_in}`);
        continue;
      }
      const firesInSource = sourceByFile.get(m.fires_in) ?? '';
      const literalInFires = hasLiteralCall(firesInSource, ['trackEvent'], m.key);
      const literalAnywhere = hasLiteralCall(clientSource, ['trackEvent'], m.key);

      if (m.status === 'instrumented' && !literalInFires) {
        // The catalog promises something code doesn't deliver — PM picker would lie. Hard error.
        errors.push(
          `catalog.yml: ${page.id}/${action.id} metric "${m.key}" is marked instrumented but trackEvent('${m.key}') was not found in ${m.fires_in} (error)`,
        );
      }
      if (m.status === 'proposed' && literalAnywhere) {
        warnings.push(
          `catalog.yml: ${page.id}/${action.id} metric "${m.key}" is marked proposed but trackEvent('${m.key}') already exists in client/src — flip status to instrumented (warning)`,
        );
      }
    }
  }

  // Reverse direction: code-without-catalog. Encourages engineers to publish new metrics for PMs.
  // Warning, not error — so a new metric committed without a catalog row keeps the autonomous PR
  // green; the human catalog-update PR resolves the warning.
  for (const key of findAllTrackEventKeys(clientSource)) {
    if (!declaredMetricKeys.has(key)) {
      warnings.push(`client/src fires trackEvent('${key}') but no catalog action declares it — add to experiments/catalog.yml for PM use (warning)`);
    }
  }

  return { errors, warnings };
}

// Test files are excluded from the walker: a `trackEvent('foo')` in a unit-test mock would
// otherwise (a) silence the reverse-direction "no catalog action declares it" warning with a
// false positive, and (b) let a stale literal that only exists in a test satisfy the
// dead-experiment guard, masking the absence of real production wiring.
const TEST_FILE_RX = /\.test\.(ts|tsx)$/;

/** Concatenate every production .ts/.tsx file under client/src into one string for cheap grep. */
function readClientSource() {
  if (!existsSync(CLIENT_SRC)) return null;
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        if (name === '__tests__') continue;
        walk(path);
      } else if (/\.(ts|tsx)$/.test(name) && !TEST_FILE_RX.test(name)) {
        out.push(stripJsComments(readFileSync(path, 'utf8')));
      }
    }
  };
  walk(CLIENT_SRC);
  return out.join('\n');
}

/**
 * Per-file source map keyed by the repo-root-relative path with FORWARD slashes (e.g.
 * 'client/src/pages/Dashboard.tsx'). Used by the catalog forward-direction check ("the literal
 * must appear in THIS file"). Key normalization matters: the catalog uses forward slashes, but
 * Node's path.join on Win32 produces backslashes — without the toPosix conversion below, every
 * sourceByFile.get(catalog.fires_in) would miss on Windows. Test files are excluded for the
 * same reason as readClientSource above.
 */
function readClientSourceByFile() {
  if (!existsSync(CLIENT_SRC)) return null;
  const out = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        if (name === '__tests__') continue;
        walk(path);
      } else if (/\.(ts|tsx)$/.test(name) && !TEST_FILE_RX.test(name)) {
        const rel = path.slice(ROOT.length + 1).split(sep).join('/'); // normalize for catalog lookup
        out.set(rel, stripJsComments(readFileSync(path, 'utf8')));
      }
    }
  };
  walk(CLIENT_SRC);
  return out;
}

/** Strip line and block comments before scanning, so a commented-out `// useVariant('foo')`
 *  breadcrumb can't satisfy the dead-experiment guard. The regex is intentionally simple — it
 *  won't perfectly handle every JS edge case (e.g. comments-in-string-literals) but it's good
 *  enough to eliminate the most common false-negative: a commented-out call literal.
 */
function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* ... */
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1'); // // ... (avoid stripping URL protocols like https:)
}

/** True if any of `fns` is called with `literal` as a single quoted/template arg in `source`.
 *  The (?<![A-Za-z_$]) lookbehind prevents a longer-name function like `myUseVariant(...)` or
 *  `cacheKey_trackEvent_x(...)` from matching when the caller wanted `useVariant`/`trackEvent`. */
function hasLiteralCall(source, fns, literal) {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z_$])(?:${fns.join('|')})\\s*\\(\\s*['"\`]${escaped}['"\`]`);
  return re.test(source);
}

/**
 * All literal keys passed to trackEvent(...) anywhere in `source`. Used by the reverse-direction
 * catalog check. Mirrors hasLiteralCall's word-boundary lookbehind so JSDoc-style mentions
 * (`MytrackEvent(...)`, or `@example trackEvent(...)` in a comment that survived stripJsComments)
 * don't slip in as spurious keys.
 */
function findAllTrackEventKeys(source) {
  const keys = new Set();
  const re = /(?<![A-Za-z_$])trackEvent\s*\(\s*['"`]([^'"`)\\]+)['"`]/g;
  let m;
  while ((m = re.exec(source)) !== null) keys.add(m[1]);
  return keys;
}

function printErrors(errors) {
  console.error(`✖ ${errors.length} experiment validation error(s):\n`);
  for (const e of errors) console.error(`  - ${e}`);
}

function printWarnings(warnings) {
  console.warn(`⚠ ${warnings.length} experiment warning(s):\n`);
  for (const w of warnings) console.warn(`  - ${w}`);
}

function validate() {
  const { errors, warnings, experiments } = collect();
  if (warnings.length) printWarnings(warnings);
  if (errors.length) {
    printErrors(errors);
    process.exit(1);
  }
  console.log(`✓ ${experiments.length} experiment(s) valid.`);
}

function build() {
  // Build validates first so a schema-invalid definition can never reach the compiled
  // registry (the Docker image runs `build` directly — see Dockerfile). Warnings are surfaced
  // but never block a build — only running-experiment errors do.
  const { errors, warnings, experiments } = collect();
  if (warnings.length) printWarnings(warnings);
  if (errors.length) {
    console.error('✖ refusing to build — run `validate` to see the errors:');
    printErrors(errors);
    process.exit(1);
  }
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify({ generated: new Date().toISOString(), experiments }, null, 2)}\n`);
  console.log(`✓ wrote ${experiments.length} experiment(s) → ${OUTPUT_PATH}`);
}

const mode = process.argv[2];
if (mode === 'validate') validate();
else if (mode === 'build') build();
else {
  console.error('usage: node scripts/experiments.mjs <validate|build>');
  process.exit(2);
}

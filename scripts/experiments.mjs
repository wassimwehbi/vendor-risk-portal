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
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPERIMENTS_DIR = join(ROOT, 'experiments');
const SCHEMA_PATH = join(EXPERIMENTS_DIR, 'schema.json');
const OUTPUT_PATH = join(ROOT, 'server', 'src', 'data', 'experiments.json');

/** Read and parse every experiment YAML in the directory (sorted, stable order). */
function loadExperiments() {
  const files = readdirSync(EXPERIMENTS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
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
 * facet means "everyone" (matching the server's `eligible()` and the schema docs), so it
 * overlaps with anything.
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

  return { errors, experiments: valid.map((v) => v.data) };
}

function printErrors(errors) {
  console.error(`✖ ${errors.length} experiment validation error(s):\n`);
  for (const e of errors) console.error(`  - ${e}`);
}

function validate() {
  const { errors, experiments } = collect();
  if (errors.length) {
    printErrors(errors);
    process.exit(1);
  }
  console.log(`✓ ${experiments.length} experiment(s) valid.`);
}

function build() {
  // Build validates first so a schema-invalid definition can never reach the compiled
  // registry (the Docker image runs `build` directly — see Dockerfile).
  const { errors, experiments } = collect();
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

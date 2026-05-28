// Mirrors the server contract (server/src/types.ts) for the experiment platform.
export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed';
export type Role = 'Analyst' | 'Admin' | 'Viewer' | 'Submitter';

export interface ExperimentVariant {
  key: string;
  weight: number;
}

export interface ExperimentTargeting {
  roles?: Role[];
  tenants?: number[];
}

export interface Experiment {
  key: string;
  name: string;
  hypothesis?: string;
  owner?: string;
  surface?: string;
  status: ExperimentStatus;
  created?: string;
  start?: string;
  end?: string;
  variants: ExperimentVariant[];
  targeting?: ExperimentTargeting;
  metrics?: { primary: string; secondary?: string[] };
  tracking_issue?: number;
}

// A parsed experiment plus the file it came from (for editing / showing source).
export interface LoadedExperiment {
  file: string;
  exp: Experiment;
}

// ---- Experiment catalog (spec 0017 refinement) ---------------------------------------------
// The catalog (experiments/catalog.yml) is the PM-facing source of truth for what's available
// to A/B test. The portal reads it via the GitHub Contents API and renders the action-centric
// picker from it. Shape mirrors experiments/catalog.schema.json.

export type MetricStatus = 'instrumented' | 'proposed';

export interface CatalogMetric {
  key: string;
  fires_in: string; // file path; internal only — never shown to PMs
  status: MetricStatus;
  handler_hint?: string; // load-bearing for TEMPLATE B safe wiring
}

export interface CatalogAction {
  id: string;
  title: string;
  description: string;
  metric?: CatalogMetric;
}

export interface CatalogPage {
  id: string;
  title: string;
  description: string;
  file: string; // internal only — never shown to PMs
  surface: string;
  experimentable: boolean;
  actions: CatalogAction[];
}

export interface Catalog {
  version: 1;
  pages: CatalogPage[];
}

export interface VariantResult {
  key: string;
  exposed: number;
  converted: number;
  rate: number;
}

export interface VariantComparison {
  variant: string;
  control: string;
  z: number | null;
  pValue: number | null;
  ciLow: number | null;
  ciHigh: number | null;
}

export interface ExperimentResults {
  key: string;
  name: string;
  status: ExperimentStatus;
  metric: string | null;
  variants: VariantResult[];
  comparisons: VariantComparison[];
}

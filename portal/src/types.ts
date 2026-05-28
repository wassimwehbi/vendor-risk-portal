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

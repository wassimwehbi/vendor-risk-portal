import type { ExperimentResults, LoadedExperiment } from '../types';
import { StatusPill, pct, significanceLabel } from './ui';

type ResultState = ExperimentResults | { error: string } | undefined;

interface Props {
  experiments: LoadedExperiment[];
  results: Record<string, ResultState>;
  onNew: () => void;
  onEdit: (e: LoadedExperiment) => void;
  onPause: (e: LoadedExperiment) => void;
}

export function Dashboard({ experiments, results, onNew, onEdit, onPause }: Props) {
  return (
    <div className="stack">
      <div className="between">
        <div>
          <h2>Experiments</h2>
          <p className="caption">{experiments.length} defined in experiments/ · every change opens a pull request</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onNew}>
          + New experiment
        </button>
      </div>

      {experiments.length === 0 ? (
        <div className="card card-pad muted">No experiments defined yet.</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Experiment</th>
                <th>Status</th>
                <th>Variants</th>
                <th>Targeting</th>
                <th>Results</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {experiments.map((loaded) => {
                const { exp } = loaded;
                const targeted = exp.targeting?.roles?.length || exp.targeting?.tenants?.length;
                return (
                  <tr key={exp.key}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{exp.name}</div>
                      <div className="mono caption">{exp.key}</div>
                      {exp.surface && <div className="caption">surface: {exp.surface}</div>}
                    </td>
                    <td>
                      <StatusPill status={exp.status} />
                      {(exp.start || exp.end) && (
                        <div className="caption">
                          {exp.start ?? '…'} → {exp.end ?? '…'}
                        </div>
                      )}
                    </td>
                    <td>
                      {exp.variants.map((v) => (
                        <div key={v.key} className="caption">
                          {v.key} <b>{v.weight}%</b>
                        </div>
                      ))}
                    </td>
                    <td>
                      {exp.targeting?.roles?.map((r) => (
                        <span key={r} className="chip">
                          {r}
                        </span>
                      ))}
                      {exp.targeting?.tenants?.map((t) => (
                        <span key={t} className="chip">
                          tenant {t}
                        </span>
                      ))}
                      {!targeted && <span className="caption">everyone</span>}
                    </td>
                    <td>
                      <ResultsCell state={results[exp.key]} />
                    </td>
                    <td>
                      <div className="row">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(loaded)}>
                          Edit
                        </button>
                        {exp.status === 'running' && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPause(loaded)}>
                            Pause
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResultsCell({ state }: { state: ResultState }) {
  if (state === undefined) return <span className="caption">…</span>;
  if ('error' in state) {
    return (
      <span className="caption" title={state.error}>
        unavailable
      </span>
    );
  }
  return (
    <div>
      {state.variants.map((v) => (
        <div key={v.key} className="caption">
          {v.key}: {v.converted}/{v.exposed} ({pct(v.rate)})
        </div>
      ))}
      {state.comparisons.map((c) => (
        <div key={c.variant} className="caption">
          {c.variant} vs {c.control}: {significanceLabel(c)}
        </div>
      ))}
    </div>
  );
}

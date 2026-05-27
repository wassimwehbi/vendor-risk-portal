import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BrandMark } from './components/BrandMark';
import { Dashboard } from './components/Dashboard';
import { ExperimentForm } from './components/ExperimentForm';
import { SignIn } from './components/SignIn';
import { Banner, Spinner } from './components/ui';
import { getViewer, listExperiments, openExperimentPR, type Viewer } from './lib/github';
import { fetchResults } from './lib/relay';
import { session } from './lib/session';
import { toYaml } from './lib/yaml';
import type { Experiment, ExperimentResults, LoadedExperiment } from './types';

type ResultState = ExperimentResults | { error: string } | undefined;

export function App() {
  const [token, setToken] = useState<string | null>(session.getToken());
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [readToken, setReadToken] = useState(session.getReadToken());
  const [experiments, setExperiments] = useState<LoadedExperiment[] | null>(null);
  const [results, setResults] = useState<Record<string, ResultState>>({});
  const [view, setView] = useState<'dashboard' | 'form'>('dashboard');
  const [editing, setEditing] = useState<Experiment | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<ReactNode>(null);
  const [showSettings, setShowSettings] = useState(false);

  const loadExperiments = useCallback(async (tok: string) => {
    setError('');
    try {
      setExperiments(await listExperiments(tok));
    } catch (e) {
      setError((e as Error).message);
      setExperiments([]);
    }
  }, []);

  // After sign-in: fetch the viewer + the experiment list.
  useEffect(() => {
    if (!token) return;
    getViewer(token)
      .then(setViewer)
      .catch(() => undefined);
    loadExperiments(token);
  }, [token, loadExperiments]);

  // Fetch live results once we have experiments + a read token (best-effort, per experiment).
  useEffect(() => {
    if (!experiments || !readToken) return;
    let cancelled = false;
    for (const { exp } of experiments) {
      fetchResults(exp.key, readToken)
        .then((r) => !cancelled && setResults((m) => ({ ...m, [exp.key]: r })))
        .catch((e) => !cancelled && setResults((m) => ({ ...m, [exp.key]: { error: (e as Error).message } })));
    }
    return () => {
      cancelled = true;
    };
  }, [experiments, readToken]);

  function signOut() {
    session.setToken(null);
    setToken(null);
    setViewer(null);
    setExperiments(null);
    setResults({});
  }

  function saveReadToken(value: string) {
    const t = value.trim();
    session.setReadToken(t);
    setReadToken(t);
    setResults({});
    setShowSettings(false);
  }

  async function pause(loaded: LoadedExperiment) {
    if (!token) return;
    try {
      const url = await openExperimentPR(token, loaded.exp.key, toYaml({ ...loaded.exp, status: 'paused' }), {
        title: `experiment(${loaded.exp.key}): pause`,
        body: `Pause \`${loaded.exp.key}\` — opened from the experiments portal.`,
      });
      setNotice(
        <>
          Pause PR opened:{' '}
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        </>,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!token) return <SignIn onSignedIn={setToken} />;

  return (
    <div className="shell">
      <header className="header">
        <BrandMark size={26} />
        <strong>Experiments</strong>
        <span className="grow" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSettings((s) => !s)}>
          Settings
        </button>
        {viewer && <span className="caption">@{viewer.login}</span>}
        <button type="button" className="btn btn-secondary btn-sm" onClick={signOut}>
          Sign out
        </button>
      </header>

      <main className="main">
        {error && <Banner kind="error">{error}</Banner>}
        {notice && <Banner kind="ok">{notice}</Banner>}

        {showSettings && <SettingsCard initial={readToken} onSave={saveReadToken} onClose={() => setShowSettings(false)} />}

        {view === 'form' ? (
          <ExperimentForm
            token={token}
            initial={editing}
            onCancel={() => {
              setView('dashboard');
              setEditing(null);
            }}
            onDone={(url) => {
              setView('dashboard');
              setEditing(null);
              setNotice(
                <>
                  PR opened:{' '}
                  <a href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>{' '}
                  — merge it to apply (the app redeploys on merge).
                </>,
              );
            }}
          />
        ) : experiments === null ? (
          <div className="row">
            <Spinner /> Loading experiments…
          </div>
        ) : (
          <Dashboard
            experiments={experiments}
            results={results}
            hasReadToken={!!readToken}
            onNew={() => {
              setEditing(null);
              setView('form');
            }}
            onEdit={(l) => {
              setEditing(l.exp);
              setView('form');
            }}
            onPause={pause}
          />
        )}
      </main>
    </div>
  );
}

function SettingsCard({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (t: string) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(initial);
  return (
    <div className="card card-pad stack" style={{ marginBottom: '1rem' }}>
      <div className="between">
        <h2>Settings</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="s-token">
          Results read token
        </label>
        <input
          id="s-token"
          className="input mono"
          type="password"
          value={val}
          placeholder="EXPERIMENTS_READ_TOKEN"
          onChange={(e) => setVal(e.target.value)}
        />
        <p className="caption">Stored in this browser only. Lets the portal read aggregate results from the API.</p>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onSave(val)}>
          Save
        </button>
      </div>
    </div>
  );
}

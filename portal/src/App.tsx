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
  const [experiments, setExperiments] = useState<LoadedExperiment[] | null>(null);
  const [results, setResults] = useState<Record<string, ResultState>>({});
  const [view, setView] = useState<'dashboard' | 'form'>('dashboard');
  const [editing, setEditing] = useState<Experiment | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<ReactNode>(null);

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

  // Live results, authorized by the signed-in GitHub token (the server checks repo-collaborator
  // access). No separate read token — best-effort, per experiment.
  useEffect(() => {
    if (!experiments || !token) return;
    let cancelled = false;
    for (const { exp } of experiments) {
      fetchResults(exp.key, token)
        .then((r) => !cancelled && setResults((m) => ({ ...m, [exp.key]: r })))
        .catch((e) => !cancelled && setResults((m) => ({ ...m, [exp.key]: { error: (e as Error).message } })));
    }
    return () => {
      cancelled = true;
    };
  }, [experiments, token]);

  function signOut() {
    session.setToken(null);
    setToken(null);
    setViewer(null);
    setExperiments(null);
    setResults({});
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
        {viewer && <span className="caption">@{viewer.login}</span>}
        <button type="button" className="btn btn-secondary btn-sm" onClick={signOut}>
          Sign out
        </button>
      </header>

      <main className="main">
        {error && <Banner kind="error">{error}</Banner>}
        {notice && <Banner kind="ok">{notice}</Banner>}

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

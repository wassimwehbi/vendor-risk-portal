import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BrandMark } from './components/BrandMark';
import { CreateWithAI } from './components/CreateWithAI';
import { Dashboard } from './components/Dashboard';
import { ExperimentForm } from './components/ExperimentForm';
import { SignIn } from './components/SignIn';
import { Banner, Spinner } from './components/ui';
import { getRepoPermissions, getViewer, listExperiments, listPageFiles, openExperimentPR, type Viewer } from './lib/github';
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
  const [view, setView] = useState<'dashboard' | 'form' | 'ai'>('dashboard');
  const [editing, setEditing] = useState<Experiment | null>(null);
  // canCreate gates the "Create with AI" CTA. Mirrors the `adw-zte.yml` author gate (push access ==
  // OWNER/MEMBER/COLLABORATOR) so we don't surface a button that quietly no-ops for non-collaborators.
  const [canCreate, setCanCreate] = useState(false);
  const [pageFiles, setPageFiles] = useState<string[]>([]);
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

  // After sign-in: fetch the viewer + the experiment list, plus the inputs the "Create with AI"
  // flow needs (push-permission to gate the CTA, page-file dropdowns). Both lookups are best-effort
  // and never break the dashboard if they fail (the CTA simply stays hidden / dropdowns empty).
  useEffect(() => {
    if (!token) return;
    getViewer(token)
      .then(setViewer)
      .catch(() => undefined);
    loadExperiments(token);
    getRepoPermissions(token)
      .then((p) => setCanCreate(p.push))
      .catch(() => setCanCreate(false));
    listPageFiles(token)
      .then(setPageFiles)
      .catch(() => setPageFiles([]));
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
    setCanCreate(false);
    setPageFiles([]);
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
        ) : view === 'ai' ? (
          <CreateWithAI
            token={token}
            pageFiles={pageFiles}
            existingKeys={(experiments ?? []).map((l) => l.exp.key)}
            onCancel={() => setView('dashboard')}
            onDone={(url, number) => {
              setView('dashboard');
              setNotice(
                <>
                  ADW is building this experiment — issue{' '}
                  <a href={url} target="_blank" rel="noreferrer">
                    #{number}
                  </a>
                  . It'll appear in this list once the pull request merges (usually 10–20 min).
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
            canCreate={canCreate}
            onNew={() => {
              setEditing(null);
              setView('form');
            }}
            onCreateWithAI={() => setView('ai')}
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

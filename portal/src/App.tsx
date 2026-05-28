import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BrandMark } from './components/BrandMark';
import { CreateWithAI } from './components/CreateWithAI';
import { Dashboard } from './components/Dashboard';
import { ExperimentForm } from './components/ExperimentForm';
import { SignIn } from './components/SignIn';
import { Banner, Spinner } from './components/ui';
import { fetchCatalog, getRepoPermissions, getViewer, listExperiments, openExperimentPR, type Viewer } from './lib/github';
import { fetchResults } from './lib/relay';
import { session } from './lib/session';
import { toYaml } from './lib/yaml';
import type { Catalog, Experiment, ExperimentResults, LoadedExperiment } from './types';

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
  // The catalog is the source of truth for the AI form (spec 0017 refinement). null = still
  // loading; { error: ... } = failed → the AI flow goes fail-closed (the CTA stays visible but
  // clicking it surfaces the error banner instead of the form).
  const [catalog, setCatalog] = useState<Catalog | { error: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<ReactNode>(null);

  // Returns the parsed list (callers set state). Made cancellation-friendly by NOT touching
  // state directly — the caller checks its `cancelled` flag before publishing.
  const loadExperiments = useCallback((tok: string) => listExperiments(tok), []);

  // After sign-in: fetch the viewer + the experiment list, plus the inputs the "Create with AI"
  // flow needs (push-permission gating, the experiment catalog). The lookups are best-effort
  // and never break the dashboard if they fail; the CTA gate / fail-closed banner handles fallout.
  // Cancellation: a rapid sign-out → sign-in (or any token change) shouldn't let a stale fetch
  // resolve and overwrite the new session's state. Mirrors the cancellation pattern in the
  // results effect below.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setError('');
    getViewer(token)
      .then((v) => !cancelled && setViewer(v))
      .catch(() => undefined);
    loadExperiments(token)
      .then((list) => !cancelled && setExperiments(list))
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setExperiments([]);
      });
    getRepoPermissions(token)
      .then((p) => !cancelled && setCanCreate(p.push))
      .catch(() => !cancelled && setCanCreate(false));
    fetchCatalog(token)
      .then((c) => !cancelled && setCatalog(c))
      .catch((e: Error) => !cancelled && setCatalog({ error: e.message }));
    return () => {
      cancelled = true;
    };
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
    setCatalog(null);
    // Reset transient UI state too — otherwise a second user signing in on the same browser
    // lands on the previous user's mid-edit / AI form / stale notice (and the previous user's
    // draft text would still be in the textareas).
    setView('dashboard');
    setEditing(null);
    setError('');
    setNotice(null);
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
          <CreateWithAIView
            token={token}
            catalog={catalog}
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

/**
 * Three-state shim around CreateWithAI. The catalog is the contract for the AI flow — when it's
 * missing or malformed we deliberately do NOT fall back to file-path inputs (that would re-create
 * the v1 problem the catalog solves). Surfacing the issue clearly is the right call.
 */
function CreateWithAIView({
  token,
  catalog,
  existingKeys,
  onCancel,
  onDone,
}: {
  token: string;
  catalog: Catalog | { error: string } | null;
  existingKeys: string[];
  onCancel: () => void;
  onDone: (issueUrl: string, issueNumber: number) => void;
}) {
  if (catalog === null) {
    return (
      <div className="row">
        <Spinner /> Loading the experiment catalog…
      </div>
    );
  }
  if ('error' in catalog) {
    return (
      <div className="stack">
        <div className="between">
          <h2>Create with AI</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            ← Back
          </button>
        </div>
        <Banner kind="error">
          The experiment catalog could not be loaded ({catalog.error}). Ask an engineer to confirm{' '}
          <span className="mono">experiments/catalog.yml</span> exists on the default branch and matches{' '}
          <span className="mono">experiments/catalog.schema.json</span>.
        </Banner>
      </div>
    );
  }
  return (
    <CreateWithAI
      token={token}
      catalog={catalog}
      existingKeys={existingKeys}
      onCancel={onCancel}
      onDone={onDone}
    />
  );
}

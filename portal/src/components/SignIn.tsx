import { useState } from 'react';
import { BrandMark } from './BrandMark';
import { getViewer } from '../lib/github';
import { authorize, type DeviceCode } from '../lib/relay';
import { session } from '../lib/session';
import { Banner, Spinner } from './ui';

/** Device-flow sign-in: get a code, show it, poll until GitHub returns a token. */
export function SignIn({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [prompt, setPrompt] = useState<DeviceCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setBusy(true);
    setError('');
    setPrompt(null);
    try {
      const token = await authorize(setPrompt);
      await getViewer(token); // sanity-check the token before storing it
      session.setToken(token);
      onSignedIn(token);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setPrompt(null);
    }
  }

  return (
    <div className="center">
      <BrandMark size={44} />
      <div>
        <h1>Experiments</h1>
        <p className="muted">A/B experiment portal · Vendor Risk Portal</p>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      {prompt ? (
        <div className="card card-pad stack" style={{ maxWidth: '22rem' }}>
          <p>Enter this code at GitHub to authorize:</p>
          <div className="code-box">{prompt.user_code}</div>
          <a className="btn btn-primary" href={prompt.verification_uri} target="_blank" rel="noreferrer">
            Open github.com/login/device →
          </a>
          <p className="caption row">
            <Spinner /> Waiting for authorization…
          </p>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
          {busy && <Spinner />} Sign in with GitHub
        </button>
      )}
      <p className="caption" style={{ maxWidth: '24rem' }}>
        Authorizes read + pull-request access to open experiment changes as PRs. The first sign-in on a cold server
        can take a few seconds while it wakes.
      </p>
    </div>
  );
}

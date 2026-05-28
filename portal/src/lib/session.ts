// Token storage. The GitHub token is per-tab (sessionStorage) so it doesn't linger; the results
// read token is low-sensitivity (aggregate, non-PII counts) and persisted (localStorage) so the
// admin enters it once.
const GH_TOKEN_KEY = 'vrp.portal.gh_token';
const READ_TOKEN_KEY = 'vrp.portal.read_token';

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(storage: Storage, key: string, value: string | null): void {
  try {
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch {
    /* storage unavailable (private mode / quota) — non-fatal */
  }
}

export const session = {
  getToken: (): string | null => safeGet(sessionStorage, GH_TOKEN_KEY),
  setToken: (t: string | null): void => safeSet(sessionStorage, GH_TOKEN_KEY, t),
  getReadToken: (): string => safeGet(localStorage, READ_TOKEN_KEY) ?? '',
  setReadToken: (t: string): void => safeSet(localStorage, READ_TOKEN_KEY, t),
};

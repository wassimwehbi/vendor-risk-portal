// GitHub token storage. Per-tab (sessionStorage) so it doesn't linger; results are authorized with
// this same signed-in token (the server verifies repo-collaborator access), so there's no separate
// read token to manage.
const GH_TOKEN_KEY = 'vrp.portal.gh_token';

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null): void {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable (private mode / quota) — non-fatal */
  }
}

export const session = {
  getToken: (): string | null => safeGet(GH_TOKEN_KEY),
  setToken: (t: string | null): void => safeSet(GH_TOKEN_KEY, t),
};

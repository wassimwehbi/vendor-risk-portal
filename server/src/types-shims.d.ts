// Minimal ambient declarations for dependencies that ship without types.

declare module 'passport-microsoft' {
  export interface MicrosoftStrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    tenant?: string;
    scope?: string | string[];
    authorizationURL?: string;
    tokenURL?: string;
    passReqToCallback?: boolean;
  }
  export interface MicrosoftProfile {
    id: string;
    displayName?: string;
    emails?: Array<{ value: string }>;
    _json?: { mail?: string; userPrincipalName?: string; displayName?: string };
  }
  export type VerifyCallback = (
    accessToken: string,
    refreshToken: string,
    profile: MicrosoftProfile,
    done: (err: unknown, user?: unknown, info?: unknown) => void,
  ) => void;
  // Implements passport's Strategy contract (incl. authenticate()).
  export class Strategy {
    constructor(options: MicrosoftStrategyOptions, verify: VerifyCallback);
    name: string;
    authenticate(req: unknown, options?: unknown): void;
  }
}

declare module 'better-sqlite3-session-store' {
  import type { Store } from 'express-session';
  interface Options {
    client: unknown;
    expired?: { clear?: boolean; intervalMs?: number };
  }
  function factory(session: { Store: typeof Store }): new (options: Options) => Store;
  export default factory;
}

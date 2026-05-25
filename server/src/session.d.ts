import 'express-session';
import type { SessionUser } from './types';

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    csrfToken?: string;
    // Where to send the browser after an OAuth round-trip (defaults to client origin).
    returnTo?: string;
  }
}

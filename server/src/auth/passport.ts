import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as MicrosoftStrategy } from 'passport-microsoft';
import { authConfig, upsertUserOnLogin } from '../services/auth';
import type { SessionUser } from '../types';

/**
 * Registers OAuth/OIDC strategies for any provider whose credentials are
 * present. We use Passport only for the OAuth handshake (`session: false`); the
 * server session is established by our own middleware afterwards. The verify
 * callbacks upsert the user and apply the domain/role policy — a disallowed
 * domain surfaces as an auth failure (info.message), not a thrown 500.
 */
export function configurePassport(): void {
  if (authConfig.google.id && authConfig.google.secret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: authConfig.google.id,
          clientSecret: authConfig.google.secret,
          callbackURL: `${authConfig.publicUrl}/api/auth/google/callback`,
          scope: ['profile', 'email'],
        },
        (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value ?? '';
            const user = upsertUserOnLogin({ email, name: profile.displayName });
            done(null, user as SessionUser);
          } catch (err) {
            done(null, false, { message: (err as Error).message });
          }
        },
      ),
    );
  }

  if (authConfig.microsoft.id && authConfig.microsoft.secret) {
    passport.use(
      new MicrosoftStrategy(
        {
          clientID: authConfig.microsoft.id,
          clientSecret: authConfig.microsoft.secret,
          callbackURL: `${authConfig.publicUrl}/api/auth/microsoft/callback`,
          tenant: authConfig.microsoft.tenant,
          scope: ['user.read'],
        },
        (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value || profile._json?.mail || profile._json?.userPrincipalName || '';
            const user = upsertUserOnLogin({ email, name: profile.displayName ?? profile._json?.displayName });
            done(null, user as SessionUser);
          } catch (err) {
            done(null, false, { message: (err as Error).message });
          }
        },
      ),
    );
  }
}

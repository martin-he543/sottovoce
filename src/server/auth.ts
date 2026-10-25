import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { bearer } from 'better-auth/plugins';
import type { Db } from 'mongodb';

/**
 * better-auth stores users, accounts, sessions and verifications in the same MongoDB database as everything else.
 * Cookies serve the web build; the `bearer` plugin hands the Tauri shells a token instead (their origin can't
 * hold a first-party cookie for the API host).
 */
export function createAuth(db: Db, trustedOrigins: string[], onDeleteUser: (userId: string) => Promise<void>) {
  const google =
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          // Keep the name and profile picture in step with Google's on every sign-in, so a new photo shows up here too.
          overrideUserInfoOnSignIn: true,
        }
      : undefined;

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) console.warn('BETTER_AUTH_SECRET is not set; set a long random string before deploying (openssl rand -base64 32).');

  return betterAuth({
    database: mongodbAdapter(db),
    baseURL: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
    secret: secret || 'dev-only-insecure-secret-change-me-please-0123456789',
    trustedOrigins,
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    socialProviders: google ? { google } : {},
    // Signing in with Google on an email-and-password account with the same (Google-verified) address links the two,
    // and brings over the Google profile picture.
    account: { accountLinking: { enabled: true, trustedProviders: ['google'], updateUserInfoOnLink: true } },
    user: {
      deleteUser: { enabled: true, beforeDelete: async (user) => onDeleteUser(user.id) },
    },
    plugins: [bearer()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

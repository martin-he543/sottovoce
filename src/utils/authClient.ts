import { createAuthClient } from 'better-auth/react';

/**
 * Web build: same-origin cookies. Native (Tauri) build: the API lives on another origin, so the bearer token the
 * server returns on sign-in is stored and sent as an Authorization header instead.
 */
const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/+$/, '');
const TOKEN_KEY = 'sottovoce.auth.token';

const token = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};

export const authClient = createAuthClient({
  baseURL: API_BASE || (typeof window !== 'undefined' ? window.location.origin : undefined),
  fetchOptions: {
    credentials: 'include',
    auth: { type: 'Bearer', token },
    onSuccess: (ctx) => {
      const t = ctx.response.headers.get('set-auth-token');
      if (t) {
        try {
          localStorage.setItem(TOKEN_KEY, t);
        } catch {
          /* cookie still works on the web */
        }
      }
    },
  },
});

export const clearAuthToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to clear */
  }
};
export const authToken = token;
export const apiUrl = (path: string) => API_BASE + path;

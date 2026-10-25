/**
 * Glue for running the web build inside the Tauri shell (Android / iOS / macOS).
 * In a normal browser none of this does anything.
 */

/** True inside the Tauri webview. */
export const isNativeShell = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * The web build calls the Express backend with same-origin paths like `/api/state`.
 * A native bundle has no backend on its own origin, so set VITE_API_BASE_URL at build time
 * (e.g. `https://sottovoce.example.com`) and `/api/*` requests are sent there instead.
 * Without it the app still runs on its built-in seed data (every call site already falls back).
 */
const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/+$/, '');

function installApiBase() {
  if (!API_BASE) return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    nativeFetch(typeof input === 'string' && input.startsWith('/api/') ? API_BASE + input : input, init);
}

/** Webviews ignore `target="_blank"`; hand external http(s) links to the system browser instead. */
function installExternalLinks() {
  document.addEventListener(
    'click',
    (e) => {
      const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || e.defaultPrevented) return;
      const url = new URL(anchor.href, window.location.href);
      if (!/^https?:$/.test(url.protocol) || url.origin === window.location.origin) return;
      e.preventDefault();
      import('@tauri-apps/plugin-opener')
        .then(({ openUrl }) => openUrl(url.href))
        .catch(() => {
          window.open(url.href, '_blank', 'noopener');
        });
    },
    true
  );
}

export function installNativeShell() {
  installApiBase();
  if (isNativeShell) installExternalLinks();
}

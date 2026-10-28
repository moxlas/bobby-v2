const env = (import.meta as any).env ?? {};

/** Room server host, e.g. `bobby-rooms.<subdomain>.workers.dev` in production. */
export const ROOMS_HOST: string = env.VITE_ROOMS_HOST || (env.DEV ? 'localhost:1999' : '');

/** The room server binding name (kebab-cased `Main` in wrangler.jsonc). */
export const ROOMS_PARTY: string = env.VITE_ROOMS_PARTY || 'main';

export const ONLINE_CONFIGURED = ROOMS_HOST.length > 0;

export function buildShareUrl(code: string): string {
  if (typeof window === 'undefined') return `/join/${code}`;
  return `${window.location.origin}/join/${code}`;
}

/** Read `/join/ABC123` (and the dev hash fallback) from the current URL. */
export function readJoinCodeFromLocation(): string | null {
  if (typeof window === 'undefined') return null;

  const pathMatch = window.location.pathname.match(/\/join\/([A-Za-z0-9-]+)/);
  if (pathMatch) return pathMatch[1];

  const hashMatch = window.location.hash.match(/\/join\/([A-Za-z0-9-]+)/);
  return hashMatch ? hashMatch[1] : null;
}

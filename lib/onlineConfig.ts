const env = (import.meta as any).env ?? {};

/** PartyKit host, e.g. `bobby-rooms.username.partykit.dev` in production. */
export const PARTYKIT_HOST: string = env.VITE_PARTYKIT_HOST || (env.DEV ? 'localhost:1999' : '');

/** The party name from partykit.json. */
export const PARTYKIT_PARTY: string = env.VITE_PARTYKIT_PARTY || 'main';

export const ONLINE_CONFIGURED = PARTYKIT_HOST.length > 0;

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

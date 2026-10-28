const NAME_KEY = 'bobby-online-name';
const TOKEN_PREFIX = 'bobby-room-token:';
const ACTIVE_ROOM_KEY = 'bobby-active-room';

export interface ActiveRoom {
  code: string;
  name: string;
}

export function loadOnlineName(): string {
  try {
    return localStorage.getItem(NAME_KEY)?.slice(0, 12) ?? '';
  } catch {
    return '';
  }
}

export function saveOnlineName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 12));
  } catch {
    // storage may be unavailable in private mode
  }
}

export function loadRoomToken(code: string): string | null {
  try {
    return sessionStorage.getItem(TOKEN_PREFIX + code);
  } catch {
    return null;
  }
}

export function saveRoomToken(code: string, token: string): void {
  try {
    sessionStorage.setItem(TOKEN_PREFIX + code, token);
  } catch {
    // reconnection will fall back to joining as a new seat
  }
}

export function clearRoomToken(code: string): void {
  try {
    sessionStorage.removeItem(TOKEN_PREFIX + code);
  } catch {
    // ignore
  }
}

/**
 * Remembers which room this tab is in so a refresh can rejoin it.
 *
 * The seat token in sessionStorage is what actually proves identity; this only
 * restores the screen, so it is cleared whenever the player leaves on purpose.
 */
export function loadActiveRoom(): ActiveRoom | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_ROOM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveRoom>;
    if (typeof parsed.code !== 'string' || typeof parsed.name !== 'string') return null;
    return { code: parsed.code, name: parsed.name };
  } catch {
    return null;
  }
}

export function saveActiveRoom(code: string, name: string): void {
  try {
    sessionStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify({ code, name }));
  } catch {
    // refresh will simply return to the menu
  }
}

export function clearActiveRoom(): void {
  try {
    sessionStorage.removeItem(ACTIVE_ROOM_KEY);
  } catch {
    // ignore
  }
}

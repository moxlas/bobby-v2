import {
  MAX_ROOM_SPECTATORS,
  type PublicRoomSummary,
  type RoomPhase,
} from '../types/online';

/** How often the entry screen refreshes the public room list. */
export const ROOM_LIST_POLL_MS = 8_000;

/** Public rooms re-publish themselves on the room TTL alarm at this interval. */
export const ROOM_LIST_HEARTBEAT_MS = 60_000;

/** Allow a missed heartbeat before hiding an entry that has gone quiet. */
export const ROOM_LIST_STALE_MS = ROOM_LIST_HEARTBEAT_MS * 2 + 5_000;

/** Hard cap so a pathological directory can never return an unbounded list. */
export const MAX_PUBLIC_ROOMS = 100;

export type RoomBrowserAction = 'join' | 'watch' | 'nextRound' | 'full';

const PHASE_ORDER: Record<RoomPhase, number> = {
  lobby: 0,
  playing: 1,
  finished: 2,
};

/** A listing older than a couple of heartbeats is treated as gone. */
export function isListingFresh(
  room: PublicRoomSummary,
  now = Date.now(),
  staleMs = ROOM_LIST_STALE_MS,
): boolean {
  return room.updatedAt > 0 && now - room.updatedAt <= staleMs;
}

/**
 * Decide what joining this room would do:
 * - lobby: take a seat,
 * - playing: watch as a spectator,
 * - finished: take a seat for the next round,
 * - full: no room for another participant.
 */
export function getRoomAction(room: PublicRoomSummary): RoomBrowserAction {
  if (room.phase === 'playing') {
    return room.spectators >= MAX_ROOM_SPECTATORS ? 'full' : 'watch';
  }

  const seats = room.humans + room.ai;
  if (seats >= room.maxSeats) return 'full';

  return room.phase === 'finished' ? 'nextRound' : 'join';
}

/** Lobbies first, then running games, then finished tables. Busier rooms win ties. */
export function sortPublicRooms(rooms: PublicRoomSummary[]): PublicRoomSummary[] {
  return [...rooms].sort((a, b) => {
    const phaseDiff = PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
    if (phaseDiff !== 0) return phaseDiff;

    const humansDiff = b.humans - a.humans;
    if (humansDiff !== 0) return humansDiff;

    return b.createdAt - a.createdAt;
  });
}

/** Drop stale and duplicate entries, then apply the hard cap. */
export function prunePublicRooms(
  rooms: PublicRoomSummary[],
  now = Date.now(),
): PublicRoomSummary[] {
  const seen = new Set<string>();
  const fresh = rooms.filter((room) => {
    if (!isListingFresh(room, now)) return false;
    if (seen.has(room.code)) return false;
    seen.add(room.code);
    return true;
  });

  return sortPublicRooms(fresh).slice(0, MAX_PUBLIC_ROOMS);
}

/**
 * The public directory endpoint is read-only.
 *
 * Rooms publish and remove their own entries through the Durable Object
 * binding. Only reads (and their CORS preflight) may pass through the worker,
 * so a visitor cannot spam listings or delete someone else's room.
 */
export function isPublicDirectoryRequest(method: string, pathname: string): boolean {
  return pathname === '/rooms' && (method === 'GET' || method === 'OPTIONS');
}

/** Insert or refresh one room, stamping it with the listing time. */
export function upsertPublicRoom(
  rooms: PublicRoomSummary[],
  room: PublicRoomSummary,
  now = Date.now(),
): PublicRoomSummary[] {
  const next = rooms.filter((entry) => entry.code !== room.code);
  next.push({ ...room, updatedAt: now });
  return prunePublicRooms(next, now);
}

import { DurableObject } from 'cloudflare:workers';
import {
  MAX_ROOM_SEATS,
  MAX_ROOM_SPECTATORS,
  MIN_ROOM_SEATS,
  type PublicRoomSummary,
} from '../types/online';
import { isValidRoomCode } from '../utils/roomCode';
import { prunePublicRooms, upsertPublicRoom } from '../utils/roomBrowser';

const STORAGE_KEY = 'rooms';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json;charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function asCount(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.floor(value), max));
}

/** Only accept what a room could actually publish; anything else is ignored. */
function sanitizeListing(input: unknown): PublicRoomSummary | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<PublicRoomSummary>;

  if (typeof raw.code !== 'string' || !isValidRoomCode(raw.code)) return null;
  if (raw.phase !== 'lobby' && raw.phase !== 'playing' && raw.phase !== 'finished') {
    return null;
  }

  const hostName = typeof raw.hostName === 'string'
    ? raw.hostName.trim().slice(0, 12)
    : '';

  return {
    code: raw.code,
    hostName: hostName || 'Host',
    phase: raw.phase,
    humans: asCount(raw.humans, MAX_ROOM_SEATS),
    ai: asCount(raw.ai, MAX_ROOM_SEATS),
    spectators: asCount(raw.spectators, MAX_ROOM_SPECTATORS),
    maxSeats: Math.max(
      MIN_ROOM_SEATS,
      Math.min(asCount(raw.maxSeats, MAX_ROOM_SEATS) || MAX_ROOM_SEATS, MAX_ROOM_SEATS),
    ),
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * A single global registry of rooms that opted into the public browser.
 *
 * Rooms are the only writers: they publish on create and phase changes, refresh
 * on their 60s heartbeat, and remove themselves when they close. The directory
 * never talks back to a room, so a stale entry can only ever exist for one
 * missed heartbeat window.
 */
export class RoomDirectory extends DurableObject {
  private rooms: PublicRoomSummary[] | null = null;

  private async load(): Promise<PublicRoomSummary[]> {
    if (this.rooms) return this.rooms;

    const stored = await this.ctx.storage.get<PublicRoomSummary[]>(STORAGE_KEY);
    this.rooms = Array.isArray(stored) ? stored : [];
    return this.rooms;
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, this.rooms ?? []);
  }

  /** Prune stale entries lazily; reads and writes both keep the list tidy. */
  private async prune(): Promise<PublicRoomSummary[]> {
    const before = await this.load();
    const after = prunePublicRooms(before);
    this.rooms = after;

    if (after.length !== before.length) {
      await this.persist();
    }
    return after;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/rooms') {
      return json({ error: 'notFound' }, 404);
    }

    switch (request.method) {
      case 'GET': {
        const rooms = await this.prune();
        return json({ rooms, updatedAt: Date.now() });
      }

      case 'POST': {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalidBody' }, 400);
        }

        const listing = sanitizeListing(
          body && typeof body === 'object' && 'room' in body
            ? (body as { room: unknown }).room
            : body,
        );
        if (!listing) return json({ error: 'invalidListing' }, 400);

        const rooms = await this.load();
        this.rooms = upsertPublicRoom(rooms, listing);
        await this.persist();
        return json({ ok: true });
      }

      case 'DELETE': {
        const code = url.searchParams.get('code') ?? '';
        if (!isValidRoomCode(code)) return json({ error: 'invalidCode' }, 400);

        const rooms = await this.load();
        this.rooms = rooms.filter((room) => room.code !== code);
        await this.persist();
        return json({ ok: true });
      }

      default:
        return json({ error: 'methodNotAllowed' }, 405);
    }
  }
}

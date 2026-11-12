import { describe, expect, it } from 'vitest';
import type { PublicRoomSummary } from '../types/online';
import {
  ROOM_LIST_STALE_MS,
  getRoomAction,
  isListingFresh,
  isPublicDirectoryRequest,
  prunePublicRooms,
  sortPublicRooms,
  upsertPublicRoom,
} from './roomBrowser';

const room = (overrides: Partial<PublicRoomSummary> = {}): PublicRoomSummary => ({
  code: 'ABC234',
  hostName: 'Host',
  phase: 'lobby',
  humans: 1,
  ai: 0,
  spectators: 0,
  maxSeats: 8,
  createdAt: 1_000,
  updatedAt: 10_000,
  ...overrides,
});

describe('getRoomAction', () => {
  it('joins an open lobby', () => {
    expect(getRoomAction(room())).toBe('join');
  });

  it('watches a game in progress', () => {
    expect(getRoomAction(room({ phase: 'playing' }))).toBe('watch');
  });

  it('joins a finished room for the next round', () => {
    expect(getRoomAction(room({ phase: 'finished' }))).toBe('nextRound');
  });

  it('disables a lobby with every seat taken', () => {
    expect(getRoomAction(room({ humans: 5, ai: 3 }))).toBe('full');
  });

  it('disables a finished room with every seat taken', () => {
    expect(getRoomAction(room({ phase: 'finished', humans: 8 }))).toBe('full');
  });

  it('disables a running game once the spectator rail is full', () => {
    expect(getRoomAction(room({ phase: 'playing', spectators: 8 }))).toBe('full');
    expect(getRoomAction(room({ phase: 'playing', spectators: 7 }))).toBe('watch');
  });
});

describe('isListingFresh', () => {
  it('keeps entries within the stale window', () => {
    expect(isListingFresh(room({ updatedAt: 10_000 }), 10_000 + ROOM_LIST_STALE_MS)).toBe(true);
  });

  it('drops entries that missed their heartbeats', () => {
    expect(isListingFresh(room({ updatedAt: 10_000 }), 10_001 + ROOM_LIST_STALE_MS)).toBe(false);
  });

  it('treats a missing timestamp as stale', () => {
    expect(isListingFresh(room({ updatedAt: 0 }))).toBe(false);
  });
});

describe('sortPublicRooms', () => {
  it('orders lobbies, then running games, then finished tables', () => {
    const sorted = sortPublicRooms([
      room({ code: 'FIN234', phase: 'finished' }),
      room({ code: 'PLA234', phase: 'playing' }),
      room({ code: 'LOB234', phase: 'lobby' }),
    ]);

    expect(sorted.map(entry => entry.code)).toEqual(['LOB234', 'PLA234', 'FIN234']);
  });

  it('prefers busier rooms and then newer ones', () => {
    const sorted = sortPublicRooms([
      room({ code: 'OLD234', humans: 1, createdAt: 5_000 }),
      room({ code: 'BIG234', humans: 4, createdAt: 1_000 }),
      room({ code: 'NEW234', humans: 1, createdAt: 9_000 }),
    ]);

    expect(sorted.map(entry => entry.code)).toEqual(['BIG234', 'NEW234', 'OLD234']);
  });
});

describe('prunePublicRooms', () => {
  it('drops stale entries and duplicate codes', () => {
    const now = 10_000_000;
    const pruned = prunePublicRooms([
      room({ code: 'OLD234', updatedAt: now - ROOM_LIST_STALE_MS - 1 }),
      room({ code: 'NEW234', updatedAt: now }),
      room({ code: 'NEW234', updatedAt: now, hostName: 'Second' }),
    ], now);

    expect(pruned).toHaveLength(1);
    expect(pruned[0].code).toBe('NEW234');
  });
});

describe('upsertPublicRoom', () => {
  it('replaces an existing entry and stamps the refresh time', () => {
    const next = upsertPublicRoom(
      [room({ code: 'ABC234', humans: 1, updatedAt: 1 })],
      room({ code: 'ABC234', humans: 3, updatedAt: 1 }),
      50_000,
    );

    expect(next).toHaveLength(1);
    expect(next[0].humans).toBe(3);
    expect(next[0].updatedAt).toBe(50_000);
  });
});

describe('isPublicDirectoryRequest', () => {
  it('allows reads and CORS preflight', () => {
    expect(isPublicDirectoryRequest('GET', '/rooms')).toBe(true);
    expect(isPublicDirectoryRequest('OPTIONS', '/rooms')).toBe(true);
  });

  it('rejects public writes so only rooms can publish or remove listings', () => {
    expect(isPublicDirectoryRequest('POST', '/rooms')).toBe(false);
    expect(isPublicDirectoryRequest('DELETE', '/rooms')).toBe(false);
  });

  it('does not treat other paths as the directory', () => {
    expect(isPublicDirectoryRequest('GET', '/main/ABC234')).toBe(false);
  });
});

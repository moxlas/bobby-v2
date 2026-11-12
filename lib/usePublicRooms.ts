import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicRoomSummary } from '../types/online';
import { buildRoomsUrl } from './onlineConfig';
import { ROOM_LIST_POLL_MS, sortPublicRooms } from '../utils/roomBrowser';

export interface UsePublicRoomsResult {
  rooms: PublicRoomSummary[];
  loading: boolean;
  error: boolean;
  refresh: () => void;
}

function isPublicRoomSummary(value: unknown): value is PublicRoomSummary {
  if (!value || typeof value !== 'object') return false;
  const room = value as Partial<PublicRoomSummary>;

  return (
    typeof room.code === 'string' &&
    (room.phase === 'lobby' || room.phase === 'playing' || room.phase === 'finished') &&
    typeof room.hostName === 'string' &&
    typeof room.humans === 'number' &&
    typeof room.ai === 'number' &&
    typeof room.spectators === 'number' &&
    typeof room.maxSeats === 'number' &&
    typeof room.createdAt === 'number' &&
    typeof room.updatedAt === 'number'
  );
}

/**
 * Polls the public directory while the entry screen is visible.
 *
 * Failed refreshes keep the last good list on screen; the directory prunes
 * itself, so the client only has to ignore entries that missed their heartbeat.
 */
export function usePublicRooms(enabled = true): UsePublicRoomsResult {
  const [rooms, setRooms] = useState<PublicRoomSummary[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const url = buildRoomsUrl();
    if (!url) {
      setRooms([]);
      setLoading(false);
      setError(true);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Room list returned ${response.status}`);

      const body = await response.json() as { rooms?: unknown };
      const list = Array.isArray(body?.rooms) ? body.rooms : [];
      const fresh = list.filter(isPublicRoomSummary);

      setRooms(sortPublicRooms(fresh));
      setError(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setRooms([]);
      return;
    }

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void load();
    };

    setLoading(true);
    tick();

    const interval = window.setInterval(tick, ROOM_LIST_POLL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      abortRef.current?.abort();
    };
  }, [enabled, load]);

  return { rooms, loading, error, refresh: load };
}

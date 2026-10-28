import { useCallback, useEffect, useRef, useState } from 'react';
import PartySocket from 'partysocket';
import type {
  ClientMessage,
  GameStateView,
  RoomCloseReason,
  RoomErrorCode,
  RoomView,
  ServerMessage,
} from '../types/online';
import { clearRoomToken, loadRoomToken, saveRoomToken } from './onlineIdentity';
import { ONLINE_CONFIGURED, ROOMS_HOST, ROOMS_PARTY } from './onlineConfig';

export type OnlineStatus = 'connecting' | 'connected' | 'closed' | 'unavailable';

export interface UseOnlineRoomOptions {
  code: string;
  create: boolean;
  name: string;
  onCodeTaken?: () => void;
}

export interface OnlineRoom {
  status: OnlineStatus;
  error: RoomErrorCode | null;
  closeReason: RoomCloseReason | null;
  youId: number | null;
  room: RoomView | null;
  game: GameStateView | null;
  send: (message: ClientMessage) => void;
  leave: () => void;
  clearError: () => void;
}

/**
 * A single room connection. The socket reconnects on its own; every open sends
 * `hello` with the seat token so the server can reclaim the same seat.
 */
export function useOnlineRoom({ code, create, name, onCodeTaken }: UseOnlineRoomOptions): OnlineRoom {
  const [status, setStatus] = useState<OnlineStatus>('connecting');
  const [error, setError] = useState<RoomErrorCode | null>(null);
  const [closeReason, setCloseReason] = useState<RoomCloseReason | null>(null);
  const [youId, setYouId] = useState<number | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [game, setGame] = useState<GameStateView | null>(null);

  const socketRef = useRef<PartySocket | null>(null);
  const tokenRef = useRef<string | null>(null);
  const closedByUsRef = useRef(false);
  const nameRef = useRef(name);
  const codeTakenRef = useRef(onCodeTaken);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    codeTakenRef.current = onCodeTaken;
  }, [onCodeTaken]);

  useEffect(() => {
    if (!ONLINE_CONFIGURED) {
      setStatus('unavailable');
      return;
    }

    closedByUsRef.current = false;
    tokenRef.current = loadRoomToken(code);
    setStatus('connecting');
    setError(null);
    setCloseReason(null);
    setYouId(null);
    setRoom(null);
    setGame(null);

    const socket = new PartySocket({
      host: ROOMS_HOST,
      party: ROOMS_PARTY,
      room: code,
      protocol: window.location.protocol === 'https:' ? 'wss' : 'ws',
    });
    socketRef.current = socket;

    const handleOpen = () => {
      socket.send(JSON.stringify({
        type: 'hello',
        token: tokenRef.current,
        name: nameRef.current,
        create,
      } satisfies ClientMessage));
    };

    const handleMessage = (event: MessageEvent) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case 'welcome':
          tokenRef.current = message.token;
          saveRoomToken(code, message.token);
          setYouId(message.youId);
          setRoom(message.room);
          setGame(message.game);
          setError(null);
          setStatus('connected');
          break;

        case 'room':
          setYouId(message.room.youId);
          setRoom(message.room);
          setStatus('connected');
          break;

        case 'game':
          setYouId(message.room.youId);
          setRoom(message.room);
          setGame(message.game);
          setStatus('connected');
          break;

        case 'error':
          setError(message.code);
          if (message.code === 'roomExists') {
            closedByUsRef.current = true;
            socket.close();
            codeTakenRef.current?.();
          } else if (message.code === 'gameInProgress' || message.code === 'roomFull') {
            // There is no seat to reclaim, so reconnecting would only loop.
            closedByUsRef.current = true;
            socket.close();
            setStatus('closed');
          }
          break;

        case 'closed':
          setCloseReason(message.reason);
          setStatus('closed');
          closedByUsRef.current = true;
          socket.close();
          break;

        default:
          break;
      }
    };

    const handleClose = () => {
      if (closedByUsRef.current) return;
      // PartySocket reconnects automatically; stay in the connecting state.
      setStatus('connecting');
    };

    socket.addEventListener('open', handleOpen);
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('close', handleClose);

    return () => {
      closedByUsRef.current = true;
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('message', handleMessage);
      socket.removeEventListener('close', handleClose);
      socket.close();
      socketRef.current = null;
    };
  }, [code, create]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify(message));
  }, []);

  const leave = useCallback(() => {
    const socket = socketRef.current;
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify({ type: 'leave' } satisfies ClientMessage));
    }
    clearRoomToken(code);
    closedByUsRef.current = true;
    setStatus('closed');
    socket?.close();
  }, [code]);

  const clearError = useCallback(() => setError(null), []);

  return { status, error, closeReason, youId, room, game, send, leave, clearError };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, X } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { useOnlineRoom } from '../lib/useOnlineRoom';
import { clearRoomToken, saveActiveRoom } from '../lib/onlineIdentity';
import { generateRoomCode } from '../utils/roomCode';
import { loadSettings } from '../utils/settings';
import { OnlineLobby } from './OnlineLobby';
import { DealingAnimation } from './DealingAnimation';
import { GameBoard } from './GameBoard';
import type { Card } from '../types/game';
import type { OnlineSession } from '../types/online';

interface OnlineRoomProps {
  session: OnlineSession;
  onExit: () => void;
}

export function OnlineRoom({ session, onExit }: OnlineRoomProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState(session.code);

  useEffect(() => {
    setCode(session.code);
  }, [session.code]);

  const handleCodeTaken = useCallback(() => {
    // Only claiming a new room can lose this race; joining never claims a code.
    if (session.create) setCode(generateRoomCode());
  }, [session.create]);

  const { status, error, closeReason, youId, room, game, send, leave, clearError } = useOnlineRoom({
    code,
    create: session.create,
    name: session.name,
    onCodeTaken: handleCodeTaken,
  });

  /**
   * Quick Play is a personal preference, not a room rule, so it never travels
   * to the server. Merge the locally saved option into this seat's view.
   */
  const [skipConfirmations] = useState(() => loadSettings()?.options.skipConfirmations ?? false);

  /**
   * Show the shuffle/deal animation once per fresh game. `gameStartTime` is the
   * identity of a deal, so a reconnect or any later update never replays it.
   */
  const [dealing, setDealing] = useState(false);
  const dealtGameStartRef = useRef<number | null>(null);

  const gameStartTime = game?.gameStartTime ?? null;
  const dealTurnNumber = game?.turnNumber;
  const dealPileLength = game?.pile.length;
  const dealPhase = game?.phase;
  useEffect(() => {
    if (gameStartTime === null || gameStartTime === 0) return;
    if (dealtGameStartRef.current === gameStartTime) return;
    if (dealPhase !== 'playing') return;

    // A reconnect into a running game is not a deal: mark it as seen silently.
    dealtGameStartRef.current = gameStartTime;
    if (dealTurnNumber !== 1 || dealPileLength !== 1) return;

    setDealing(true);
  }, [gameStartTime, dealTurnNumber, dealPileLength, dealPhase]);

  const handleDealComplete = useCallback(() => setDealing(false), []);

  /** Seats that left the room keep their ranking line, marked with a badge. */
  const leftPlayerIds = useMemo(() => {
    if (!game) return [];
    const seated = new Set(room?.seats.map(seat => seat.id) ?? []);
    return game.players.filter(player => !seated.has(player.id)).map(player => player.id);
  }, [game?.players, room?.seats]);

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(clearError, 4000);
    return () => window.clearTimeout(timeout);
  }, [error, clearError]);

  const roomCode = room?.code;
  useEffect(() => {
    // Persist only after the server confirms the room, so a refresh during the
    // initial claim does not try to join a code the room never accepted.
    if (roomCode) saveActiveRoom(roomCode, session.name);
  }, [roomCode, session.name]);

  const leaveAndExit = useCallback(() => {
    clearRoomToken(code);
    leave();
    onExit();
  }, [code, leave, onExit]);

  const backToSetup = useCallback(() => {
    if (closeReason === 'roomNotFound' || closeReason === 'roomExpired') {
      clearRoomToken(code);
    }
    onExit();
  }, [closeReason, code, onExit]);

  if (status === 'unavailable') {
    return (
      <OnlineNotice
        title={t('online.unavailable.title')}
        body={t('online.unavailable.body')}
        actionLabel={t('online.entry.back')}
        onAction={backToSetup}
      />
    );
  }

  if (closeReason) {
    return (
      <OnlineNotice
        title={t('online.closed.title')}
        body={t(`online.closed.${closeReason}`)}
        actionLabel={t('online.closed.back')}
        onAction={backToSetup}
      />
    );
  }

  if (status === 'closed') {
    return (
      <OnlineNotice
        title={t('online.closed.title')}
        body={t(`online.error.${error ?? 'unknown'}`)}
        actionLabel={t('online.closed.back')}
        onAction={backToSetup}
      />
    );
  }

  if (!room) {
    return (
      <OnlineNotice
        title={t('online.connecting.title')}
        body={t('online.connecting.body')}
        actionLabel={t('online.entry.back')}
        onAction={backToSetup}
      />
    );
  }

  if (room.phase === 'lobby' || !game) {
    return (
      <OnlineLobby
        room={room}
        connected={status === 'connected'}
        send={send}
        onLeave={leaveAndExit}
      />
    );
  }

  const isHost = room.hostId === room.youId;

  // Apply this seat's Quick Play preference without touching the shared rules.
  const boardGame = skipConfirmations && !game.options.skipConfirmations
    ? { ...game, options: { ...game.options, skipConfirmations: true } }
    : game;

  if (dealing) {
    const openingPlayerId = game.moveHistory[0]?.playerId;
    return (
      <DealingAnimation
        players={game.players.map(player => ({
          id: player.id,
          name: player.name,
          isAI: player.isAI,
          isYou: player.id === youId,
          cardCount: (player.handCount ?? player.hand.length) + (player.id === openingPlayerId ? 1 : 0),
        }))}
        onComplete={handleDealComplete}
      />
    );
  }

  const errorBanner = error && error !== 'roomExists' ? (
    <div className="fixed left-1/2 top-2 z-50 flex w-[calc(100%-1rem)] max-w-md -translate-x-1/2 items-center gap-2 rounded-lg border border-red-400 bg-red-600 px-3 py-2 text-sm text-white shadow-lg">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{t(`online.error.${error}`)}</span>
      <button
        type="button"
        onClick={clearError}
        aria-label={t('online.error.dismiss')}
        className="rounded p-1 transition-colors hover:bg-red-500"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  ) : null;

  return (
    <>
      {errorBanner}
      <GameBoard
        gameState={boardGame}
        viewerId={youId}
        runAI={false}
        hostControls={isHost}
        leftPlayerIds={leftPlayerIds}
        onPlayCards={(_playerId: number, cards: Card[]) => send({ type: 'playCards', cards, continueTurn: false })}
        onTakeCards={(_playerId: number, count: number) => send({ type: 'takeCards', count })}
        onEndTurn={() => send({ type: 'endTurn' })}
        onPauseGame={() => send({ type: 'pause' })}
        onResumeGame={() => send({ type: 'resume' })}
        onForfeitPlayer={() => send({ type: 'forfeit' })}
        onFinishGame={() => send({ type: 'finish' })}
        onRestartGame={() => send({ type: 'restart' })}
        onNewGame={leaveAndExit}
      />
    </>
  );
}

interface OnlineNoticeProps {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}

function OnlineNotice({ title, body, actionLabel, onAction }: OnlineNoticeProps) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-emerald-900 p-4">
      <div className="w-full max-w-sm rounded-xl border border-emerald-600 bg-emerald-800 p-6 text-center shadow-2xl">
        <h1 className="text-xl font-bold text-amber-300">{title}</h1>
        <p className="mt-3 text-sm text-emerald-200">{body}</p>
        <button
          type="button"
          onClick={onAction}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400 bg-emerald-700 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
        >
          <ArrowLeft className="w-4 h-4" />
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

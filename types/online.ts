import type { AIDifficulty, Card, GameRules, GameState, Player } from './game';

/** A player as seen by one viewer. Only the viewer's own hand is included. */
export interface SeatPlayer extends Omit<Player, 'hand'> {
  /** Populated for the viewing seat only; always empty for every other seat. */
  hand: Card[];
  /** The real number of cards the seat holds, even when the hand is hidden. */
  handCount: number;
}

/**
 * The authoritative game state with every other hand removed.
 *
 * It is intentionally assignable to GameState so the board can render it, but
 * it must never be produced from a state the viewer is not entitled to see.
 */
export interface GameStateView extends Omit<GameState, 'players' | 'finishOrder' | 'loser'> {
  players: SeatPlayer[];
  finishOrder: SeatPlayer[];
  loser: SeatPlayer | null;
  /** Seat id of the viewer, or null for a spectator. */
  youId: number | null;
}

export type RoomPhase = 'lobby' | 'playing' | 'finished';

export interface LobbySeat {
  id: number;
  name: string;
  isAI: boolean;
  isHost: boolean;
  isConnected: boolean;
}

export interface RoomView {
  code: string;
  phase: RoomPhase;
  hostId: number;
  seats: LobbySeat[];
  rules: GameRules;
  /** The room's AI seats always run at this difficulty. */
  aiDifficulty: AIDifficulty;
  minSeats: number;
  maxSeats: number;
  /** Seat id of the viewer, or null before joining and for spectators. */
  youId: number | null;
  /** Increases on every authoritative update so stale messages can be dropped. */
  version: number;
}

export type RoomErrorCode =
  | 'notHost'
  | 'notYourTurn'
  | 'invalidMove'
  | 'cannotStart'
  | 'roomFull'
  | 'notInRoom'
  | 'gameInProgress'
  | 'nameRequired'
  | 'unknown';

export type RoomCloseReason = 'roomNotFound' | 'roomExpired' | 'kicked';

export type ClientMessage =
  /** Claim a new room (create) or join/reclaim a seat. */
  | { type: 'hello'; token: string | null; name: string; create: boolean }
  | { type: 'setRules'; rules: GameRules }
  | { type: 'setAICount'; count: number }
  | { type: 'startGame' }
  | { type: 'playCards'; cards: Card[]; continueTurn: boolean }
  | { type: 'takeCards'; count: number }
  | { type: 'endTurn' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'forfeit' }
  | { type: 'restart' }
  | { type: 'leave' };

export type ServerMessage =
  | {
      type: 'welcome';
      token: string;
      youId: number | null;
      room: RoomView;
      game: GameStateView | null;
    }
  | { type: 'room'; room: RoomView }
  | { type: 'game'; room: RoomView; game: GameStateView }
  | { type: 'error'; code: RoomErrorCode }
  | { type: 'closed'; reason: RoomCloseReason };

export const MIN_ROOM_SEATS = 2;
export const MAX_ROOM_SEATS = 8;

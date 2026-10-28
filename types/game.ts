export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Value = 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  id: string;
  suit: Suit;
  value: Value;
  faceUp: boolean;
}

export interface Player {
  id: number;
  name: string;
  hand: Card[];
  isCurrentTurn: boolean;
  isConnected: boolean;
  isAI: boolean;
  hasFinished: boolean;
  finishPosition: number | null;
  finishTime: number | null;
}

export interface PlayerMove {
  id: string;
  playerId: number;
  playerName: string;
  type: 'play' | 'take';
  cards: Card[];
  timestamp: number;
  turnNumber: number;
}

export type GamePhase = 'setup' | 'playing' | 'paused' | 'finished';

/** Codes returned by validatePlay — resolve with t(`game.error.${code}`). */
export type PlayError =
  | 'selectCards'
  | 'duplicateCards'
  | 'noPile'
  | 'specialNinesOff'
  | 'ninesOnDiamonds'
  | 'nineOnNine'
  | 'groupSize'
  | 'valueTooLow';

export type AIDifficulty = 'easy' | 'medium' | 'hard';
export type ThemeName = 'summer' | 'midnight' | 'autumn';
export type Language = 'en' | 'lt';

/** Rules the host chooses for a room. They change how the game is played. */
export interface GameRules {
  specialNinesRule: boolean;
  allowTakeAllCards: boolean;
  fourOfAKindRule: boolean;
}

/** Per-player settings that never affect the rules or other seats. */
export interface GamePreferences {
  aiDifficulty: AIDifficulty;
  rankedSeating: boolean;
  randomSeating: boolean;
  skipConfirmations: boolean;
  theme: ThemeName;
  language: Language;
}

export interface GameOptions extends GameRules, GamePreferences {}

export interface GameState {
  phase: GamePhase;
  players: Player[];
  currentPlayerIndex: number;
  pile: Card[];
  deck: Card[];
  direction: 'clockwise' | 'counterclockwise';
  finishOrder: Player[];
  loser: Player | null;
  moveHistory: PlayerMove[];
  gameStartTime: number | null;
  pausedTime: number | null;
  totalPausedTime: number;
  turnNumber: number;
  options: GameOptions;
  canContinueTurn: boolean;
  aiOnlyStartTurn: number | null;
}

export const DEFAULT_RULES: GameRules = {
  specialNinesRule: true,
  allowTakeAllCards: true,
  fourOfAKindRule: true,
};

export const DEFAULT_PREFERENCES: GamePreferences = {
  aiDifficulty: 'medium',
  rankedSeating: false,
  randomSeating: false,
  skipConfirmations: false,
  theme: 'summer',
  language: 'en',
};

export const DEFAULT_OPTIONS: GameOptions = {
  ...DEFAULT_RULES,
  ...DEFAULT_PREFERENCES,
};

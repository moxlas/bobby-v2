import { Card, GameState, GameOptions, AIDifficulty, AIThinkingTime, Player, PlayerMove } from '../../types/game';

// ============================================================

// AI logic â€” updated to guarantee AI never skips a turn.

// - AI must either PLAY or TAKE when an action is available.

// - If pile contains only 9â™¦ (no take possible), AI is forced to play.

// - Taking ends the turn immediately; once AI plays, taking is illegal.

// - Continuation phase only returns PLAY or END TURN when truly no options.

// ============================================================

// -----------------------------

// Score weights (tunable)

// -----------------------------

export const SCORE_WEIGHTS = {

  THREE_OF_A_KIND_PENALTY: -30,

  TWO_OF_A_KIND_BONUS: 5,

  FOUR_OF_A_KIND_BONUS: 90,

  NINE_TRIPLE_BONUS: 40,

  NINE_QUAD_BONUS: 110,

  HIGH_CARD_PENALTY: -32,

  ACE_PENALTY: -42,

  FOUR_ACES_PENALTY: -500,

  PRESERVE_HIGH_CARDS_BONUS: 22,

  TAKING_CARDS_BASE_PENALTY: -50,

  TAKING_COMPLETES_QUAD_BONUS: 120,

  TAKING_HIGH_CARDS_BONUS: 24,

  TAKING_USEFUL_CARDS_BONUS: 25,

  TAKING_WHEN_LEADING_PENALTY: -40,

  WINNING_MOVE_BONUS: 2000,

  CARDS_REMAINING_PENALTY: -15,

  CAN_FINISH_SOON_BONUS: 200,

  FORCE_OPPONENT_TAKE_BONUS: 45,

  PLAYING_HIGH_TO_BLOCK: 35,

  PLAY_LOW_CARDS_BONUS: 5,

  OPPONENT_CLOSE_TO_WIN_PENALTY: -100,

  BLOCKING_OPPONENT_BONUS: 50,

  LEADING_POSITION_BONUS: 30,

  UNCOVER_LOW_CARDS_BONUS: 30,

  OPPONENT_TAKES_BAD_PENALTY: -25,

  NINE_PLUS_ACE_TRAP_BONUS: 180,

  NINE_PLUS_KING_TRAP_BONUS: 115,

  FOUR_OF_KIND_TRAP_BONUS: 120,

  // Expert-only tactical weights.
  EXPERT_HIGH_CARD_WASTE_PENALTY: 18,

  EXPERT_LAST_HIGH_CARD_PENALTY: 60,

  EXPERT_QUAD_BREAK_PENALTY: 150,

  EXPERT_QUAD_PRESERVE_BONUS: 26,

  EXPERT_QUAD_BURY_BONUS: 90,

  EXPERT_QUAD_BURY_FORCE_BONUS: 70,

  EXPERT_OPPONENT_THREAT_BONUS: 55,

  EXPERT_FORCE_PICKUP_BONUS: 70,

  EXPERT_TAKE_HIGH_CARDS_BONUS: 30,

};

export const HARD_SEARCH_DEPTH = 10;

export const HARD_SEARCH_NODE_BUDGET = 9000;

export const HARD_SEARCH_TIME_BUDGET_MS = 400;

export const HARD_SEARCH_WORLDS = 2;

export const HARD_SEARCH_CANDIDATES = 6;

export const EXPERT_SEARCH_DEPTH = 13;

export const EXPERT_SEARCH_NODE_BUDGET = 40000;

export const EXPERT_SEARCH_TIME_BUDGET_MS = 750;

export const EXPERT_SEARCH_WORLDS = 4;

export const EXPERT_SEARCH_CANDIDATES = 10;

/**
 * Player-selectable Expert thinking time. The search budget controls how long
 * the AI may spend calculating; the delay is the visible pause after it has
 * chosen a move. Hard/Medium/Easy keep their existing timings.
 */
export const AI_THINKING_PROFILES: Record<AIThinkingTime, { searchTimeBudgetMs: number; delayMs: number }> = {
  normal: { searchTimeBudgetMs: EXPERT_SEARCH_TIME_BUDGET_MS, delayMs: 1000 },
  long: { searchTimeBudgetMs: 1000, delayMs: 2000 },
  max: { searchTimeBudgetMs: 1250, delayMs: 3000 },
};


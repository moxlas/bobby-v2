import { Card, GameState, GameOptions, AIDifficulty, Player, PlayerMove } from '../../types/game';

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

  FOUR_OF_A_KIND_BONUS: 80,

  NINE_TRIPLE_BONUS: 40,

  NINE_QUAD_BONUS: 90,



  HIGH_CARD_PENALTY: -29,

  ACE_PENALTY: -36,

  FOUR_ACES_PENALTY: -500,

  PRESERVE_HIGH_CARDS_BONUS: 15,



  TAKING_CARDS_BASE_PENALTY: -50,

  TAKING_COMPLETES_QUAD_BONUS: 120,

  TAKING_HIGH_CARDS_BONUS: 15,

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



  NINE_PLUS_ACE_TRAP_BONUS: 150,

  FOUR_OF_KIND_TRAP_BONUS: 100,

};

export const HARD_SEARCH_DEPTH = 10;

export const HARD_SEARCH_NODE_BUDGET = 9000;

export const HARD_SEARCH_TIME_BUDGET_MS = 75;

export const HARD_SEARCH_WORLDS = 2;

export const EXPERT_SEARCH_DEPTH = 11;

export const EXPERT_SEARCH_NODE_BUDGET = 12000;

export const EXPERT_SEARCH_TIME_BUDGET_MS = 150;

export const EXPERT_SEARCH_WORLDS = 2;


import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type Card, type GameState, type Suit, type Value } from '../types/game';
import { initializeGame } from './gameLogic';
import { getAIDelay, getAIMove, getAIMoveCandidates, getSearchProfile, EXPERT_SEARCH_TIME_BUDGET_MS } from './aiLogic';

function card(value: Value, suit: Suit): Card {
  return { id: `${suit}-${value}`, suit, value, faceUp: false };
}

function expertState(hand: Card[], opponentHand: Card[]): GameState {
  const state = initializeGame(
    [
      { name: 'AI', isAI: true },
      { name: 'Human', isAI: false },
    ],
    { ...DEFAULT_OPTIONS, aiDifficulty: 'expert' },
    () => 0.5,
  );

  const nineOfDiamonds = state.pile[0];

  state.players[0] = {
    ...state.players[0],
    hand,
    hasFinished: false,
    isCurrentTurn: true,
  };
  state.players[1] = {
    ...state.players[1],
    hand: opponentHand,
    hasFinished: false,
    isCurrentTurn: false,
  };
  state.currentPlayerIndex = 0;
  state.canContinueTurn = false;
  state.pile = [nineOfDiamonds];
  state.moveHistory = [{
    id: 'move-opening',
    playerId: state.players[1].id,
    playerName: state.players[1].name,
    type: 'play',
    cards: [nineOfDiamonds],
    timestamp: 0,
    turnNumber: 0,
  }];

  return state;
}

// A realistic heads-up partition of the 24-card deck around the opening 9♦.
const trapHand: Card[] = [
  card(9, 'clubs'), card(9, 'hearts'), card(9, 'spades'),
  card(10, 'clubs'), card(10, 'hearts'),
  card(11, 'clubs'), card(12, 'clubs'),
  card(14, 'clubs'), card(14, 'hearts'), card(14, 'spades'), card(14, 'diamonds'),
];

const trapOpponentHand: Card[] = [
  card(10, 'spades'), card(10, 'diamonds'),
  card(11, 'hearts'), card(11, 'spades'), card(11, 'diamonds'),
  card(12, 'hearts'), card(12, 'spades'), card(12, 'diamonds'),
  card(13, 'clubs'), card(13, 'hearts'), card(13, 'spades'), card(13, 'diamonds'),
];

const quadHand: Card[] = [
  card(9, 'clubs'), card(9, 'hearts'), card(9, 'spades'),
  card(10, 'clubs'), card(10, 'hearts'), card(10, 'spades'), card(10, 'diamonds'),
  card(11, 'clubs'), card(11, 'hearts'),
  card(13, 'clubs'), card(14, 'clubs'),
];

const quadOpponentHand: Card[] = [
  card(11, 'spades'), card(11, 'diamonds'),
  card(12, 'clubs'), card(12, 'hearts'), card(12, 'spades'), card(12, 'diamonds'),
  card(13, 'hearts'), card(13, 'spades'), card(13, 'diamonds'),
  card(14, 'hearts'), card(14, 'spades'), card(14, 'diamonds'),
];

describe('Expert tactical moves', () => {
  it('uses the 3-nines + Ace opening trap heads-up', () => {
    const state = expertState(trapHand, trapOpponentHand);
    const move = getAIMove(state, state.players[0].id);

    expect(move.type).toBe('play');
    const nines = move.cards.filter(entry => entry.value === 9);
    const aces = move.cards.filter(entry => entry.value === 14);
    expect(nines).toHaveLength(3);
    expect(aces).toHaveLength(1);
  }, 10000);

  it('follows an opponent pickup with a quad bury', () => {
    const afterTrapHand: Card[] = [
      card(10, 'clubs'), card(10, 'hearts'), card(10, 'spades'), card(10, 'diamonds'),
      card(11, 'clubs'), card(12, 'clubs'), card(14, 'clubs'),
    ];
    const afterTrapOpponentHand: Card[] = [
      card(9, 'clubs'), card(9, 'hearts'), card(9, 'spades'),
      card(11, 'hearts'), card(11, 'spades'), card(11, 'diamonds'),
      card(12, 'hearts'), card(12, 'spades'), card(12, 'diamonds'),
      card(13, 'clubs'), card(13, 'hearts'), card(13, 'spades'), card(13, 'diamonds'),
      card(14, 'hearts'), card(14, 'spades'), card(14, 'diamonds'),
    ];

    const state = expertState(afterTrapHand, afterTrapOpponentHand);
    const move = getAIMove(state, state.players[0].id);

    expect(move.type).toBe('play');
    expect(move.cards.filter(entry => entry.value === 10)).toHaveLength(4);
    expect(move.cards.length).toBeGreaterThanOrEqual(4);
  }, 10000);

  it('generates a quad + extra-card bury line', () => {
    const state = expertState(quadHand, quadOpponentHand);
    const candidates = getAIMoveCandidates(state, state.players[0].id);

    const quadBury = candidates.find(candidate =>
      candidate.type === 'play' &&
      candidate.cards.length === 5 &&
      candidate.cards.filter(entry => entry.value === 10).length === 4 &&
      candidate.cards.some(entry => entry.value > 10),
    );

    expect(quadBury).toBeDefined();
  }, 10000);

  it('stays within the expert think-time budget', () => {
    const state = expertState(trapHand, trapOpponentHand);
    const started = Date.now();
    getAIMove(state, state.players[0].id);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2000);
  }, 10000);
});

describe('Expert thinking time', () => {
  it('maps each thinking-time setting to a search budget', () => {
    expect(getSearchProfile('expert', 'normal').timeBudget).toBe(EXPERT_SEARCH_TIME_BUDGET_MS);
    expect(getSearchProfile('expert', 'long').timeBudget).toBe(1000);
    expect(getSearchProfile('expert', 'max').timeBudget).toBe(1250);
  });

  it('changes the expert pause without touching other difficulties', () => {
    const expectNear = (actual: number, base: number) => {
      expect(actual).toBeGreaterThanOrEqual(base - 100);
      expect(actual).toBeLessThanOrEqual(base + 99);
    };

    expectNear(getAIDelay('expert', 'normal'), 1000);
    expectNear(getAIDelay('expert', 'long'), 2000);
    expectNear(getAIDelay('expert', 'max'), 3000);
    expectNear(getAIDelay('hard', 'max'), 1800);
    expectNear(getAIDelay('medium', 'max'), 1000);
    expectNear(getAIDelay('easy', 'max'), 500);
  });
});

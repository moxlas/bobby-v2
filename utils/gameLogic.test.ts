import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPTIONS, type Card, type GameState, type Player } from '../types/game';
import {
  completeRankings,
  endTurn,
  finishGame,
  forfeitPlayer,
  initializeGame,
  offersTakeChoice,
  playCards,
  resolveHandCards,
  takeCards,
  validatePlay,
} from './gameLogic';

function card(id: string, value: Card['value'] = 9): Card {
  return { id, suit: 'hearts', value, faceUp: true };
}

function player(id: number, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: `P${id}`,
    hand: [card(`hand-${id}`)],
    isCurrentTurn: false,
    isConnected: true,
    isAI: false,
    hasFinished: false,
    finishPosition: null,
    finishTime: null,
    ...overrides,
  };
}

function game(players: Player[], overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'playing',
    players,
    currentPlayerIndex: 0,
    pile: [card('base')],
    deck: [],
    direction: 'clockwise',
    finishOrder: [],
    loser: null,
    moveHistory: [],
    gameStartTime: null,
    pausedTime: null,
    totalPausedTime: 0,
    turnNumber: 1,
    options: DEFAULT_OPTIONS,
    canContinueTurn: false,
    aiOnlyStartTurn: null,
    ...overrides,
  };
}

describe('resolveHandCards', () => {
  const hand = [
    card('9h', 9),
    card('10h', 10),
    { id: 'ac', suit: 'clubs', value: 14, faceUp: true } as Card,
  ];

  it('replaces forged values and suits with the authoritative hand cards', () => {
    const forged = [{ id: '9h', suit: 'spades', value: 14, faceUp: true }];

    expect(resolveHandCards(hand, forged)).toEqual([hand[0]]);
  });

  it('resolves id-only references in the order they were sent', () => {
    expect(resolveHandCards(hand, [{ id: 'ac' }, { id: '9h' }])?.map(c => c.id))
      .toEqual(['ac', '9h']);
  });

  it('rejects empty, malformed, duplicated, and unowned references', () => {
    expect(resolveHandCards(hand, [])).toBeNull();
    expect(resolveHandCards(hand, null)).toBeNull();
    expect(resolveHandCards(hand, '9h')).toBeNull();
    expect(resolveHandCards(hand, [null])).toBeNull();
    expect(resolveHandCards(hand, [{}])).toBeNull();
    expect(resolveHandCards(hand, [{ id: 9 }])).toBeNull();
    expect(resolveHandCards(hand, [{ id: '9h' }, { id: '9h' }])).toBeNull();
    expect(resolveHandCards(hand, [{ id: 'missing' }])).toBeNull();
  });
});

describe('completeRankings', () => {
  it('ranks active players before forfeiters and makes the earliest forfeiter the loser', () => {
    const state = game(
      [
        player(0, { name: 'finisher', hasFinished: true, finishPosition: 1, finishTime: 10 }),
        player(1, { name: 'active' }),
        player(2, { name: 'early-leaver', hasFinished: true, finishPosition: null, finishTime: 5 }),
        player(3, { name: 'late-leaver', hasFinished: true, finishPosition: null, finishTime: 20 }),
      ],
      {
        finishOrder: [player(0, { hasFinished: true, finishPosition: 1, finishTime: 10 })],
      },
    );

    const next = completeRankings(state, 100);

    expect(next.phase).toBe('finished');
    expect(next.finishOrder.map(p => p.name))
      .toEqual(['finisher', 'active', 'late-leaver', 'early-leaver']);
    expect(next.finishOrder.map(p => p.finishPosition)).toEqual([1, 2, 3, 4]);
    expect(next.players.find(p => p.id === 1))
      .toMatchObject({ hasFinished: true, finishPosition: 2, finishTime: 100 });
    expect(next.loser?.name).toBe('early-leaver');
  });

  it('keeps a forfeiter in the standings when the game continues', () => {
    const started = game([player(0), player(1), player(2), player(3)]);
    const afterForfeit = forfeitPlayer(started, 2);

    expect(afterForfeit.phase).toBe('playing');
    expect(afterForfeit.finishOrder).toHaveLength(0);
    expect(afterForfeit.players[2]).toMatchObject({ hasFinished: true, finishPosition: null });

    const finished = finishGame(afterForfeit);

    expect(finished.finishOrder.map(p => p.id)).toEqual([0, 1, 3, 2]);
    expect(finished.finishOrder.map(p => p.finishPosition)).toEqual([1, 2, 3, 4]);
    expect(finished.loser?.id).toBe(2);
  });

  it('orders multiple forfeiters by when they left', () => {
    vi.useFakeTimers();
    try {
      const started = game([player(0), player(1), player(2), player(3)], { gameStartTime: 1000 });

      vi.setSystemTime(2000);
      const firstLeft = forfeitPlayer(started, 0);
      vi.setSystemTime(3000);
      const secondLeft = forfeitPlayer(firstLeft, 1);

      expect(secondLeft.phase).toBe('playing');

      const finished = finishGame(secondLeft);

      expect(finished.finishOrder.map(p => p.id)).toEqual([2, 3, 1, 0]);
      expect(finished.loser?.id).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends the game when only one player is left standing', () => {
    const next = forfeitPlayer(game([player(0), player(1)]), 0);

    expect(next.phase).toBe('finished');
    expect(next.finishOrder.map(p => p.id)).toEqual([1, 0]);
    expect(next.finishOrder.map(p => p.finishPosition)).toEqual([1, 2]);
    expect(next.loser?.id).toBe(0);
    expect(next.players.every(p => p.hasFinished)).toBe(true);
  });

  it('completes the standings when an AI-only game times out', () => {
    const state = game(
      [
        player(0, { isAI: true, hasFinished: true, finishPosition: null, finishTime: 15 }),
        player(1, { isAI: true }),
        player(2, { isAI: true }),
      ],
      { aiOnlyStartTurn: 1, turnNumber: 201 },
    );

    const next = endTurn(state);

    expect(next.phase).toBe('finished');
    expect(next.finishOrder.map(p => p.id)).toEqual([1, 2, 0]);
    expect(next.loser?.id).toBe(0);
  });

  it('includes a forfeiter when the last card ends the game', () => {
    const state = game(
      [
        player(0, { hand: [card('10h', 10)], isCurrentTurn: true }),
        player(1, { hand: [card('9h', 9)] }),
        player(2, { hand: [], hasFinished: true, finishPosition: null, finishTime: 5 }),
      ],
      { pile: [{ id: '9d', suit: 'diamonds', value: 9, faceUp: true }] },
    );

    const next = playCards(state, 0, [card('10h', 10)], false);

    expect(next.phase).toBe('finished');
    expect(next.finishOrder.map(p => p.id)).toEqual([0, 1, 2]);
    expect(next.loser?.id).toBe(2);
  });
});

describe('initializeGame', () => {
  it('keeps explicit seat ids and uses them in the opening move', () => {
    const state = initializeGame(
      [
        { id: 4, name: 'Alice', isAI: false },
        { id: 2, name: 'Bob', isAI: false },
      ],
      DEFAULT_OPTIONS,
      () => 0.5,
    );

    expect(state.players.map(p => p.id)).toEqual([4, 2]);
    expect(state.players.some(p => p.id === state.moveHistory[0].playerId)).toBe(true);
    expect(state.currentPlayerIndex).toBeGreaterThanOrEqual(0);
    expect(state.currentPlayerIndex).toBeLessThan(state.players.length);
  });

  it('defaults seat ids to their position for local games', () => {
    const state = initializeGame(
      [
        { name: 'Player 1', isAI: false },
        { name: 'Player 2', isAI: true },
      ],
      DEFAULT_OPTIONS,
      () => 0.5,
    );

    expect(state.players.map(p => p.id)).toEqual([0, 1]);
    expect([0, 1]).toContain(state.moveHistory[0].playerId);
  });

  it('produces the same deal for the same random source', () => {
    const setups = [
      { name: 'A', isAI: false },
      { name: 'B', isAI: false },
      { name: 'C', isAI: true },
    ];
    const first = initializeGame(setups, DEFAULT_OPTIONS, () => 0.25);
    const second = initializeGame(setups, DEFAULT_OPTIONS, () => 0.25);

    expect(first.players.map(p => p.hand)).toEqual(second.players.map(p => p.hand));
  });
});

describe('takeCards', () => {
  it('never takes the bottom card, even when asked for more', () => {
    const state = initializeGame(
      [
        { name: 'A', isAI: false },
        { name: 'B', isAI: false },
      ],
      DEFAULT_OPTIONS,
      () => 0.5,
    );
    state.pile = [card('base'), card('one'), card('two')];
    const taker = state.players[0];
    const handBefore = taker.hand.length;

    const next = takeCards(state, taker.id, 99);

    expect(next.pile.map(c => c.id)).toEqual(['base']);
    expect(next.players[0].hand).toHaveLength(handBefore + 2);
    expect(next.players[0].hand.some(c => c.id === 'base')).toBe(false);
  });

  it('leaves the state alone for an unknown seat', () => {
    const state = initializeGame(
      [
        { name: 'A', isAI: false },
        { name: 'B', isAI: false },
      ],
      DEFAULT_OPTIONS,
      () => 0.5,
    );

    expect(takeCards(state, 99, 3)).toBe(state);
  });
});

describe('validatePlay combos', () => {
  const nineOfDiamonds: Card = { id: '9d', suit: 'diamonds', value: 9, faceUp: true };
  const openingPile = [nineOfDiamonds];
  const four = (value: Card['value'], prefix: string): Card[] =>
    [0, 1, 2, 3].map(index => ({
      id: `${prefix}-${index}`,
      suit: (['hearts', 'diamonds', 'clubs', 'spades'] as const)[index],
      value,
      faceUp: true,
    }));

  it('plays a single card on the opening 9 of diamonds', () => {
    expect(validatePlay([card('9h', 9)], openingPile, true, DEFAULT_OPTIONS).valid).toBe(true);
  });

  it('rejects two unrelated cards played together (9 + 10)', () => {
    const result = validatePlay([card('9h', 9), card('10h', 10)], openingPile, true, DEFAULT_OPTIONS);
    expect(result).toMatchObject({ valid: false, error: 'comboChain' });
  });

  it('rejects unrelated cards mid-game as well', () => {
    const pile: Card[] = [card('9h', 9)];
    const result = validatePlay([card('10h', 10), card('jh', 11)], pile, false, DEFAULT_OPTIONS);
    expect(result).toMatchObject({ valid: false, error: 'comboChain' });
  });

  it('plays a 4 of a kind as one move when the rule is on', () => {
    const result = validatePlay(four(10, 'ten'), openingPile, false, DEFAULT_OPTIONS);
    expect(result).toMatchObject({ valid: true, continueTurn: true });
  });

  it('chains 4 of a kinds and finishes with a single card', () => {
    const cards = [...four(10, 'ten'), ...four(12, 'queen'), card('kh', 13)];
    const result = validatePlay(cards, openingPile, false, DEFAULT_OPTIONS);
    expect(result).toMatchObject({ valid: true, continueTurn: false });
  });

  it('rejects a second single card after a 4 of a kind', () => {
    const cards = [...four(10, 'ten'), card('qh', 12), card('kh', 13)];
    const result = validatePlay(cards, openingPile, false, DEFAULT_OPTIONS);
    expect(result).toMatchObject({ valid: false, error: 'comboChain' });
  });

  it('rejects a 4 of a kind when the rule is disabled', () => {
    const options = { ...DEFAULT_OPTIONS, fourOfAKindRule: false };
    const result = validatePlay(four(10, 'ten'), openingPile, false, options);
    expect(result).toMatchObject({ valid: false, error: 'fourOfAKindOff' });
  });

  it('plays three opening nines and a follow-up card with the special nines rule', () => {
    const cards = [card('9h', 9), card('9c', 9), card('9s', 9), card('10h', 10)];
    const result = validatePlay(cards, openingPile, true, DEFAULT_OPTIONS);
    expect(result).toMatchObject({ valid: true, continueTurn: false });
  });

  it('rejects two nines on the 9 of diamonds', () => {
    const result = validatePlay([card('9h', 9), card('9c', 9)], openingPile, true, DEFAULT_OPTIONS);
    expect(result).toMatchObject({ valid: false, error: 'ninesOnDiamonds' });
  });

  it('rejects two nines on other nines', () => {
    const pile = [card('9h', 9)];
    const result = validatePlay([card('9c', 9), card('9s', 9)], pile, false, DEFAULT_OPTIONS);
    expect(result).toMatchObject({ valid: false, error: 'nineOnNine' });
  });
});

describe('offersTakeChoice', () => {
  const pileOf = (length: number) =>
    Array.from({ length }, (_, index) => card(`pile-${index}`));

  it('hides the 3-or-all choice when the pile has four or fewer cards', () => {
    for (let length = 1; length <= 4; length++) {
      expect(offersTakeChoice(pileOf(length), DEFAULT_OPTIONS)).toBe(false);
    }
  });

  it('offers the choice once taking all differs from taking three', () => {
    expect(offersTakeChoice(pileOf(5), DEFAULT_OPTIONS)).toBe(true);
    expect(offersTakeChoice(pileOf(8), DEFAULT_OPTIONS)).toBe(true);
  });

  it('stays quiet when take-all is disabled by the rules', () => {
    const options = { ...DEFAULT_OPTIONS, allowTakeAllCards: false };
    expect(offersTakeChoice(pileOf(8), options)).toBe(false);
  });
});

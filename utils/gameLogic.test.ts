import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type Card } from '../types/game';
import { initializeGame, offersTakeChoice, takeCards, validatePlay } from './gameLogic';

function card(id: string, value: Card['value'] = 9): Card {
  return { id, suit: 'hearts', value, faceUp: true };
}

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

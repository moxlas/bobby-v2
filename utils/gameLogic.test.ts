import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type Card } from '../types/game';
import { initializeGame, takeCards } from './gameLogic';

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

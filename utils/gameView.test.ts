import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type Card, type GameState } from '../types/game';
import { initializeGame } from './gameLogic';
import { toGameStateView } from './gameView';

function card(id: string): Card {
  return { id, suit: 'hearts', value: 9, faceUp: false };
}

const fixedRng = () => 0.5;

function threeSeatState(): GameState {
  const state = initializeGame(
    [
      { id: 0, name: 'Alice', isAI: false },
      { id: 3, name: 'Bob', isAI: false },
      { id: 7, name: 'Bot', isAI: true },
    ],
    DEFAULT_OPTIONS,
    fixedRng,
  );

  state.players[0].hand = [card('alice-1'), card('alice-2')];
  state.players[1].hand = [card('bob-1'), card('bob-2'), card('bob-3')];
  state.players[2].hand = [card('bot-1')];
  state.pile = [];
  state.moveHistory = [];
  state.finishOrder = [];
  state.loser = null;
  return state;
}

describe('toGameStateView', () => {
  it('keeps only the viewer hand and reports everyone hand count', () => {
    const state = threeSeatState();
    const view = toGameStateView(state, 3);

    expect(view.youId).toBe(3);
    expect(view.players.map(p => p.id)).toEqual([0, 3, 7]);
    expect(view.players[1].hand.map(c => c.id)).toEqual(['bob-1', 'bob-2', 'bob-3']);
    expect(view.players[0].hand).toEqual([]);
    expect(view.players[2].hand).toEqual([]);
    expect(view.players.map(p => p.handCount)).toEqual([2, 3, 1]);
  });

  it('does not leak other hands through the serialized view', () => {
    const state = threeSeatState();
    const view = toGameStateView(state, 0);
    const serialized = JSON.stringify(view);

    expect(serialized).toContain('alice-1');
    expect(serialized).not.toContain('bob-1');
    expect(serialized).not.toContain('bob-2');
    expect(serialized).not.toContain('bob-3');
    expect(serialized).not.toContain('bot-1');
  });

  it('strips hands from the finish ranking and the loser', () => {
    const state = threeSeatState();
    state.finishOrder = [{ ...state.players[1], finishPosition: 1 }];
    state.loser = state.players[2];

    const view = toGameStateView(state, 0);
    const serialized = JSON.stringify(view);

    expect(view.finishOrder[0].hand).toEqual([]);
    expect(view.finishOrder[0].handCount).toBe(3);
    expect(view.loser?.hand).toEqual([]);
    expect(view.loser?.handCount).toBe(1);
    expect(serialized).not.toContain('bob-1');
    expect(serialized).not.toContain('bot-1');
  });

  it('hides every hand from a spectator', () => {
    const view = toGameStateView(threeSeatState(), null);

    expect(view.youId).toBeNull();
    expect(view.players.every(p => p.hand.length === 0)).toBe(true);
    expect(view.players.map(p => p.handCount)).toEqual([2, 3, 1]);
  });

  it('reveals only the active hand to a seat that has already finished', () => {
    const state = threeSeatState();
    state.players[0].hasFinished = true;
    state.currentPlayerIndex = 1;

    const view = toGameStateView(state, 0);

    expect(view.players[1].hand.map(c => c.id)).toEqual(['bob-1', 'bob-2', 'bob-3']);
    expect(view.players[2].hand).toEqual([]);
    expect(view.players.map(p => p.handCount)).toEqual([2, 3, 1]);
  });

  it('keeps every other hand hidden once the game is finished', () => {
    const state = threeSeatState();
    state.phase = 'finished';
    state.players[0].hasFinished = true;
    state.currentPlayerIndex = 1;

    const view = toGameStateView(state, 0);

    expect(view.players[1].hand).toEqual([]);
    expect(view.players[2].hand).toEqual([]);
  });

  it('copies cards so mutating the view cannot mutate the game', () => {
    const state = threeSeatState();
    const view = toGameStateView(state, 0);

    view.players[0].hand[0].id = 'tampered';

    expect(state.players[0].hand[0].id).toBe('alice-1');
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../types/game';
import { initializeGame, playCards, takeCards, endTurn, validatePlay, getTakeOptions } from './gameLogic';
import { getAIMove, getContinueTurnMove } from './aiLogic';

describe('AI self-play', () => {
  it('completes a two-player medium game without illegal states', () => {
    let state = initializeGame(
      [
        { name: 'AI 1', isAI: true },
        { name: 'AI 2', isAI: true },
      ],
      { ...DEFAULT_OPTIONS, aiDifficulty: 'medium' },
      () => 0.5,
    );

    let turns = 0;
    while (state.phase === 'playing' && turns < 1000) {
      const current = state.players[state.currentPlayerIndex];
      if (!current?.isAI) break;

      if (state.canContinueTurn) {
        const move = getContinueTurnMove(
          current.hand,
          state.pile,
          state.options.aiDifficulty,
          state.options,
          state,
          current.id,
        );
        if (move.type === 'play') {
          const isFirstMove = state.pile.length === 1 && state.pile[0].value === 9 && state.pile[0].suit === 'diamonds';
          const validation = validatePlay(move.cards, state.pile, isFirstMove, state.options);
          expect(validation.valid).toBe(true);
          state = playCards(state, current.id, move.cards, Boolean(validation.continueTurn));
        } else {
          state = endTurn(state);
        }
      } else {
        const move = getAIMove(state, current.id, false);
        if (move.type === 'play') {
          const isFirstMove = state.pile.length === 1 && state.pile[0].value === 9 && state.pile[0].suit === 'diamonds';
          const validation = validatePlay(move.cards, state.pile, isFirstMove, state.options);
          expect(validation.valid).toBe(true);
          state = playCards(state, current.id, move.cards, Boolean(validation.continueTurn));
        } else if (move.type === 'take') {
          const takeOptions = getTakeOptions(state.pile, state.options);
          const count = move.takeType === 'takeAll' ? takeOptions.takeAllCount : takeOptions.take3Count;
          state = takeCards(state, current.id, count);
        } else {
          state = endTurn(state);
        }
      }

      turns += 1;
    }

    expect(state.phase).toBe('finished');
    expect(state.finishOrder).toHaveLength(2);
  }, 30000);
});

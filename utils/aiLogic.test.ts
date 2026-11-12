import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type GameOptions } from '../types/game';
import { initializeGame } from './gameLogic';
import { getAIMove, getAIMoveCandidates } from './aiLogic';
import { validatePlay } from './gameLogic';

function gameWithDifficulty(difficulty: GameOptions['aiDifficulty']) {
  const state = initializeGame(
    [
      { name: 'Human', isAI: false },
      { name: 'AI', isAI: true },
    ],
    { ...DEFAULT_OPTIONS, aiDifficulty: difficulty },
    () => 0.5,
  );
  return state;
}

describe('AI move legality', () => {
  for (const difficulty of ['easy', 'medium', 'hard', 'expert'] as const) {
    it(`${difficulty} AI never skips an available turn on the opening pile`, () => {
      const state = gameWithDifficulty(difficulty);
      const ai = state.players.find(player => player.isAI)!;
      const move = getAIMove(state, ai.id);

      expect(move.type).not.toBe('endTurn');
      if (move.type === 'play') {
        const validation = validatePlay(
          move.cards,
          state.pile,
          state.pile.length === 1 && state.pile[0].value === 9 && state.pile[0].suit === 'diamonds',
          state.options,
        );
        expect(validation.valid).toBe(true);
      }
    });

    it(`${difficulty} AI only proposes generated candidates`, () => {
      const state = gameWithDifficulty(difficulty);
      const ai = state.players.find(player => player.isAI)!;
      const candidates = getAIMoveCandidates(state, ai.id);
      const move = getAIMove(state, ai.id);

      const key = move.type === 'play'
        ? `play:${move.cards.map(card => card.id).sort().join(',')}`
        : `${move.type}:${move.takeType ?? ''}`;
      const candidateKeys = candidates.map(candidate =>
        candidate.type === 'play'
          ? `play:${candidate.cards.map(card => card.id).sort().join(',')}`
          : `${candidate.type}:${candidate.takeType ?? ''}`,
      );

      expect(candidateKeys).toContain(key);
    });
  }
});

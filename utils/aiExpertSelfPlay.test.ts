import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type Card, type Suit, type Value } from '../types/game';
import { initializeGame, playCards, takeCards, endTurn, validatePlay, getTakeOptions } from './gameLogic';
import { getAIMove, getContinueTurnMove } from './aiLogic';

function card(value: Value, suit: Suit): Card {
  return { id: `${suit}-${value}`, suit, value, faceUp: false };
}

const MAX_DECISION_MS = 3000;

describe('Expert AI self-play', () => {
  it('finishes a compact expert endgame with legal moves and bounded think time', () => {
    let state = initializeGame(
      [
        { name: 'Expert 1', isAI: true },
        { name: 'Expert 2', isAI: true },
      ],
      { ...DEFAULT_OPTIONS, aiDifficulty: 'expert', aiThinkingTime: 'normal' },
      () => 0.5,
    );

    // Use a short but valid endgame so the permanent smoke test exercises the
    // full Expert search without spending a minute on a complete 24-card deal.
    const nineOfDiamonds = state.pile[0];
    state.players[0] = {
      ...state.players[0],
      hand: [card(10, 'clubs'), card(11, 'hearts'), card(13, 'spades'), card(14, 'clubs')],
      hasFinished: false,
      isCurrentTurn: true,
    };
    state.players[1] = {
      ...state.players[1],
      hand: [card(10, 'diamonds'), card(11, 'spades'), card(12, 'hearts'), card(14, 'spades')],
      hasFinished: false,
      isCurrentTurn: false,
    };
    state.currentPlayerIndex = 0;
    state.canContinueTurn = false;
    state.finishOrder = [];
    state.loser = null;
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

    const decisionTimes: number[] = [];
    let turns = 0;

    while (state.phase === 'playing' && turns < 200) {
      const current = state.players[state.currentPlayerIndex];
      if (!current?.isAI) break;

      const started = Date.now();
      const move = state.canContinueTurn
        ? getContinueTurnMove(
            current.hand,
            state.pile,
            state.options.aiDifficulty,
            state.options,
            state,
            current.id,
          )
        : getAIMove(state, current.id);
      decisionTimes.push(Date.now() - started);

      if (move.type === 'play') {
        const isFirstMove = state.pile.length === 1 && state.pile[0].value === 9 && state.pile[0].suit === 'diamonds';
        const validation = validatePlay(move.cards, state.pile, isFirstMove, state.options);
        expect(validation.valid).toBe(true);
        state = playCards(state, current.id, move.cards, Boolean(validation.continueTurn));
      } else if (move.type === 'take' && !state.canContinueTurn) {
        const takeOptions = getTakeOptions(state.pile, state.options);
        const count = move.takeType === 'takeAll' ? takeOptions.takeAllCount : takeOptions.take3Count;
        expect(count).toBeGreaterThan(0);
        state = takeCards(state, current.id, count);
      } else {
        state = endTurn(state);
      }

      turns += 1;
    }

    expect(state.phase).toBe('finished');
    expect(state.finishOrder).toHaveLength(2);
    expect(decisionTimes.length).toBeGreaterThan(0);

    const maxDecision = Math.max(...decisionTimes);
    const averageDecision = decisionTimes.reduce((total, time) => total + time, 0) / decisionTimes.length;

    expect(maxDecision).toBeLessThan(MAX_DECISION_MS);
    expect(averageDecision).toBeLessThan(MAX_DECISION_MS / 2);
  }, 60000);
});

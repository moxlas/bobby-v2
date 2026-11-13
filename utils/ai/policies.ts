import { Card, GameState, GameOptions, AIDifficulty, AIThinkingTime, Player, PlayerMove } from '../../types/game';
import { AI_THINKING_PROFILES } from './constants';
import { evaluatePlayMove, evaluateTakeMove } from './evaluation';
import { AIMove } from './types';
import { estimateOpponentStrength } from './opponentModel';
import { getPossiblePlays, isUnnecessaryAceOnOpening, shouldUseFourOfAKind } from './candidates';
import { getHardAIMove } from './search';
import { returnTakeMove } from './utils';
import { getCardsOfSameValue, hasFourOfSameValue } from '../deckUtils';
import { getTakeOptions, validatePlay, playCards, endTurn } from '../gameLogic';

/**

 * enforceNoSkipDecision

 * - Ensures AI never returns an illegal endTurn when actions exist.

 * - If pile has only 9â™¦ (pile.length === 1), taking is impossible; force a play from hand.

 * - Accepts optional playerHand to construct forced plays when necessary.

 */

export function enforceNoSkipDecision(

  possiblePlays: Card[][],

  bestMove: { type: 'play' | 'take' | 'endTurn'; cards: Card[]; takeType?: 'take3' | 'takeAll' } | null,

  pile: Card[],

  options: GameOptions,

  playerHand?: Card[],

): AIMove {

  if (bestMove && bestMove.type === 'play' && bestMove.cards && bestMove.cards.length > 0) {

    return bestMove;

  }

  if (bestMove?.type === 'take') return bestMove;

  if (possiblePlays && possiblePlays.length > 0) {

    return { type: 'play', cards: possiblePlays[0] };

  }

  if (pile.length === 1 && playerHand && playerHand.length > 0) {

    const nines = playerHand.filter(card => card.value === 9);

    if (options.specialNinesRule && nines.length >= 3) {

      return { type: 'play', cards: nines.slice(0, 3) };

    }

    const fourValue = hasFourOfSameValue(playerHand);

    if (fourValue !== null) {

      const fourCards = getCardsOfSameValue(playerHand, fourValue);

      if (fourCards.length === 4) return { type: 'play', cards: fourCards };

    }

    const sorted = [...playerHand].sort((a, b) => a.value - b.value);

    return { type: 'play', cards: [sorted[0]] };

  }

  const takeOptions = getTakeOptions(pile, options);

  if (takeOptions.canTake3) return { type: 'take', cards: [], takeType: 'take3' };

  if (takeOptions.canTakeAll) return { type: 'take', cards: [], takeType: 'takeAll' };

  if (playerHand && playerHand.length > 0) {

    const sorted = [...playerHand].sort((a, b) => a.value - b.value);

    return { type: 'play', cards: [sorted[0]] };

  }

  return { type: 'play', cards: [] };

}

// -----------------------------

// Medium AI (previous hard logic moved here)

// -----------------------------

export function getMediumAIMove(state: GameState, playerId: number): AIMove {

  const player = state.players.find(p => p.id === playerId)!;

  const hand = player.hand;

  const pile = state.pile;

  const options = state.options;

  const topCard = pile[pile.length - 1];

  const isFirstMove = pile.length === 1 && pile[0].suit === 'diamonds' && pile[0].value === 9;

  const opponentInfo = estimateOpponentStrength(state, playerId);

  const possiblePlays = getPossiblePlays(hand, pile, options);

  const takeOpts = getTakeOptions(pile, options);

  let bestMove: any = null;

  let bestScore = -Infinity;

  for (const playCards of possiblePlays) {

    if (isUnnecessaryAceOnOpening(playCards, hand, pile)) continue;

    if (!shouldUseFourOfAKind(playCards, hand, state, playerId)) continue;

    const validation = validatePlay(playCards, pile, isFirstMove, options);

    if (validation.valid) {

      const score = evaluatePlayMove(playCards, hand, pile, state, playerId);

      if (validation.continueTurn && playCards.length === 4) {

        const remainingHand = hand.filter(c => !playCards.find(pc => pc.id === c.id));

        if (remainingHand.length > 0) {

          const nextPlays = getPossiblePlays(remainingHand, [...pile, ...playCards], options);

          if (nextPlays.length > 0) {

            const nextScore = evaluatePlayMove(nextPlays[0], remainingHand, pile, state, playerId);

            if (nextScore > 0) {

              const combinedScore = score + nextScore * 0.25;

              if (combinedScore > bestScore) {

                bestScore = combinedScore;

                bestMove = { type: 'play', cards: playCards };

              }

              continue;

            }

          }

        }

      }

      if (score > bestScore) {

        bestScore = score;

        bestMove = { type: 'play', cards: playCards };

      }

    }

  }

  // Picking up is a strategic choice even when a legal play exists. Compare

  // both available pickup sizes against the best legal play.

  if (takeOpts.canTake3) {

    const take3Score = evaluateTakeMove(takeOpts.take3Count, hand, pile, state, playerId);

    if (take3Score > bestScore) {

      bestScore = take3Score;

      bestMove = { type: 'take', cards: [], takeType: 'take3' };

    }

  }

  if (takeOpts.canTakeAll) {

    const takeAllScore = evaluateTakeMove(takeOpts.takeAllCount, hand, pile, state, playerId);

    if (takeAllScore > bestScore) {

      bestScore = takeAllScore;

      bestMove = { type: 'take', cards: [], takeType: 'takeAll' };

    }

  }

  if (!bestMove) {

    if (takeOpts.canTake3) bestMove = { type: 'take', cards: [], takeType: 'take3' };

    else if (takeOpts.canTakeAll) bestMove = { type: 'take', cards: [], takeType: 'takeAll' };

    else if (hand.length > 0) bestMove = { type: 'play', cards: [hand[0]] };

    else bestMove = { type: 'endTurn', cards: [] };

  }

  const safeDecision = enforceNoSkipDecision(possiblePlays, bestMove, pile, options, hand);

  if (safeDecision.type === 'take') return returnTakeMove(safeDecision.takeType === 'takeAll' ? 'takeAll' : 'take3');

  return safeDecision;

}

// -----------------------------

// Main AI entrypoint

// -----------------------------

export function getAIMove(state: GameState, playerId: number, searchFuture = true): AIMove {

  const player = state.players.find(p => p.id === playerId);

  if (!player) return { type: 'endTurn', cards: [] };

  const options = state.options;

  const difficulty = options.aiDifficulty;

  if (difficulty === 'easy') return getEasyAIMove(player.hand, state.pile, options);

  if (difficulty === 'medium') return getMediumAIMove(state, playerId);

  const move = getHardAIMove(state, playerId, searchFuture);

  // Check for the specific scenario with only 9â™¦ on pile

  if (

    move.type === 'endTurn' &&

    state.pile.length === 1

  ) {

    // Always play lowest card instead of ending turn

    const sortedHand = [...player.hand].sort((a, b) => a.value - b.value);

    return { type: 'play', cards: [sortedHand[0]] };

  }

  // Otherwise, follow the normal move

  if (move.type === 'endTurn') {

    // Already handled above, but just a fallback

    const possiblePlays = getPossiblePlays(player.hand, state.pile, options);

    const fallback = enforceNoSkipDecision(

      possiblePlays,

      null,

      state.pile,

      options,

      player.hand

    );

    if (fallback.type === 'take') return returnTakeMove(fallback.takeType === 'takeAll' ? 'takeAll' : 'take3');

    return fallback;

  } else {

    return move;

  }

}

// -----------------------------

// Easy AI

// -----------------------------

export function getEasyAIMove(hand: Card[], pile: Card[], options: GameOptions): AIMove {

  const topCard = pile[pile.length - 1];

  const isFirstMove = pile.length === 1 && pile[0].suit === 'diamonds' && pile[0].value === 9;

  if (isFirstMove) {

    const nines = hand.filter(c => c.value === 9);

    if (options.specialNinesRule && nines.length >= 3) return { type: 'play', cards: nines.slice(0, 3) };

    if (nines.length >= 1) return { type: 'play', cards: [nines[0]] };

  }

  const takeOpts = getTakeOptions(pile, options);

  if (takeOpts.canTake3 && Math.random() < 0.35) {

    return { type: 'take', cards: [], takeType: 'take3' };

  }

  const validCards = hand.filter(c => c.value >= topCard.value);

  if (validCards.length > 0) {

    const preservesFourOfAKind = validCards.filter(card => {

      const breaksQuad = hand.filter(held => held.value === card.value).length === 4;

      const highSingleCanBlock = topCard.value >= 10 && card.value >= 12 && card.value > topCard.value && card.value - topCard.value <= 3;

      return !breaksQuad || highSingleCanBlock;

    });

    const cardsToChooseFrom = preservesFourOfAKind.length > 0 ? preservesFourOfAKind : validCards;

    // Easy chooses a legal card without weighing card value, groups, or future

    // turns, but it won't split a four-of-a-kind when another card is playable.

    const card = cardsToChooseFrom[Math.floor(Math.random() * cardsToChooseFrom.length)];

    return { type: 'play', cards: [card] };

  }

  // If pile is only 9â™¦ and hand exists, force a play (cannot take)

  if (pile.length === 1 && hand.length > 0) {

    // The opening special move is the three remaining nines, never a mixed set.

    const nines = hand.filter(c => c.value === 9);

    if (options.specialNinesRule && nines.length >= 3) return { type: 'play', cards: nines.slice(0, 3) };

    const fourVal = hasFourOfSameValue(hand);

    if (fourVal !== null) return { type: 'play', cards: getCardsOfSameValue(hand, fourVal) };

    const sorted = [...hand].sort((a, b) => a.value - b.value);

    return { type: 'play', cards: [sorted[0]] };

  }

  return { type: 'take', cards: [], takeType: takeOpts.canTake3 ? 'take3' : 'takeAll' };

}

// -----------------------------

// Continue-turn logic (only PLAY or END TURN)

// -----------------------------

export function getContinueTurnMove(

  hand: Card[],

  pile: Card[],

  difficulty: AIDifficulty,

  options: GameOptions,

  state: GameState,

  playerId: number,

  searchFuture = true

): { type: 'play' | 'endTurn'; cards: Card[] } {

  const topCard = pile[pile.length - 1];

  const isFirstMove = pile.length === 1 && pile[0].value === 9 && pile[0].suit === 'diamonds';

  const possiblePlays = getPossiblePlays(hand, pile, options);

  // If no possible plays but pile is only 9â™¦, force a play from hand

  if ((!possiblePlays || possiblePlays.length === 0) && pile.length === 1 && hand.length > 0) {

    const nines = hand.filter(c => c.value === 9);

    if (options.specialNinesRule && nines.length >= 3) return { type: 'play', cards: nines.slice(0, 3) };

    const fourVal = hasFourOfSameValue(hand);

    if (fourVal !== null) return { type: 'play', cards: getCardsOfSameValue(hand, fourVal) };

    const sorted = [...hand].sort((a, b) => a.value - b.value);

    return { type: 'play', cards: [sorted[0]] };

  }

  if (!possiblePlays || possiblePlays.length === 0) return { type: 'endTurn', cards: [] };

  if (difficulty === 'hard' || difficulty === 'expert') {

    const hardState = { ...state, canContinueTurn: true };

    const searchedMove = getHardAIMove(hardState, playerId, searchFuture);

    return searchedMove.type === 'play'

      ? { type: 'play', cards: searchedMove.cards }

      : { type: 'endTurn', cards: [] };

  }

  let best: Card[] | null = null;

  let bestScore = -Infinity;

  for (const play of possiblePlays) {

    if (isUnnecessaryAceOnOpening(play, hand, pile)) continue;

    if (difficulty !== 'easy' && !shouldUseFourOfAKind(play, hand, state, playerId)) continue;

    const validation = validatePlay(play, pile, isFirstMove, options);

    if (!validation.valid) continue;

    const score = evaluatePlayMove(play, hand, pile, state, playerId);

    if (score > bestScore) {

      bestScore = score;

      best = play;

    }

  }

  // after scoring and before returning endTurn in getContinueTurnMove

if (best && best.length > 0) return { type: 'play', cards: best };

  // If pile is only 9â™¦ and hand exists, force a play from hand (cannot take)

  if (pile.length === 1 && hand.length > 0) {

    const nines = hand.filter(c => c.value === 9);

    if (options.specialNinesRule && nines.length >= 3) return { type: 'play', cards: nines.slice(0, 3) };

    const fourVal = hasFourOfSameValue(hand);

    if (fourVal !== null) return { type: 'play', cards: getCardsOfSameValue(hand, fourVal) };

    const sorted = [...hand].sort((a, b) => a.value - b.value);

    return { type: 'play', cards: [sorted[0]] };

  }

  // Otherwise end turn (only when truly no options)

  return { type: 'endTurn', cards: [] };

}

// -----------------------------

// Return AI thinking delay in milliseconds for a given difficulty.

// - easy: short delay

// - medium: moderate delay

// - hard: longer delay with small random jitter

//

// Keep delays small enough for UX but large enough to feel natural.

// -----------------------------

export function getAIDelay(difficulty: AIDifficulty, thinkingTime: AIThinkingTime = 'normal'): number {

  // base delays (ms)

  const BASE: Record<AIDifficulty, number> = {

    easy: 500,

    medium: 1000, // previous "hard" behavior moved to medium

    hard: 1800,

    expert: AI_THINKING_PROFILES[thinkingTime]?.delayMs ?? AI_THINKING_PROFILES.normal.delayMs,

  };

  const base = BASE[difficulty] ?? 400;

  // Add a small random jitter so AI doesn't feel robotic

  const jitter = Math.floor(Math.random() * 200) - 100; // -100..+99 ms

  // Cap to a sensible range

  const delay = Math.max(100, base + jitter);

  return delay;

}


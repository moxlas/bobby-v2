import { Card, GameState, GameOptions, AIDifficulty, Player, PlayerMove } from '../../types/game';
import { EXPERT_SEARCH_DEPTH, EXPERT_SEARCH_NODE_BUDGET, EXPERT_SEARCH_TIME_BUDGET_MS, EXPERT_SEARCH_WORLDS, HARD_SEARCH_DEPTH, HARD_SEARCH_NODE_BUDGET, HARD_SEARCH_TIME_BUDGET_MS, HARD_SEARCH_WORLDS } from './constants';
import { evaluateCandidate, evaluatePlayMove, evaluateSearchPosition, evaluateTakeMove, getHighCardBlockingPenalty } from './evaluation';
import { getAIMoveCandidates, getHumanDemonstrationScores, getPossiblePlays, isUnnecessaryAceOnOpening, shouldUseFourOfAKind } from './candidates';
import { buildOpponentCardTracker } from './opponentModel';
import { AIMove, AdversarialSearchContext } from './types';
import { getTrainingMoveKey, returnTakeMove } from './utils';
import { enforceNoSkipDecision } from './policies';
import { sortHand } from '../deckUtils';
import { getTakeOptions, validatePlay, playCards, takeCards, endTurn } from '../gameLogic';

// -----------------------------

// Hidden-hand reconstruction for adversarial search

// -----------------------------

export function sampleHiddenHands(state: GameState, playerId: number): GameState {

  const sampled: GameState = {
    ...state,
    players: state.players.map(player => ({ ...player, hand: [...player.hand] })),
    pile: [...state.pile],
    finishOrder: state.finishOrder.map(player => ({ ...player, hand: [...player.hand] })),
    moveHistory: [...state.moveHistory],
    deck: [...state.deck],
  };

  const tracker = buildOpponentCardTracker(state, playerId);

  const unknownCounts = new Map(tracker.unknownCounts);

  const unseenPlayers = sampled.players

    .filter(player => player.id !== playerId && !player.hasFinished)

    .sort(() => Math.random() - 0.5);

  for (const opponent of unseenPlayers) {

    const knownCards = tracker.knownHands.get(opponent.id) ?? [];

    const slotsToSample = Math.max(0, opponent.hand.length - knownCards.length);

    const sampledCards: Card[] = [];

    const ceiling = tracker.unknownValueCeilings.get(opponent.id);

    for (let slot = 0; slot < slotsToSample; slot++) {

      // In heads-up play, the remaining rank counts are the exact complement

      // of our hand and the pile. A failed response is not proof of a low hand

      // because taking can be voluntary, so do not rule out those cards.

      const useSoftCeiling = state.players.length > 2 && ceiling !== undefined;

      const possibleValues = [...unknownCounts.entries()]

        .filter(([, count]) => count > 0)

        .map(([value, count]) => ({ value, count: count * (useSoftCeiling && value >= ceiling ? 0.08 : 1) }));

      const total = possibleValues.reduce((sum, candidate) => sum + candidate.count, 0);

      if (total <= 0) break;

      let pick = Math.floor(Math.random() * total);

      let value = possibleValues[0].value;

      for (const candidate of possibleValues) {

        if (pick < candidate.count) { value = candidate.value; break; }

        pick -= candidate.count;

      }

      unknownCounts.set(value, (unknownCounts.get(value) ?? 0) - 1);

      sampledCards.push({

        id: `search-sample-${opponent.id}-${slot}-${Math.random().toString(36).slice(2, 8)}`,

        value: value as Card['value'],

        suit: 'spades',

        faceUp: false,

      });

    }

    opponent.hand = sortHand([...knownCards.map(card => ({ ...card })), ...sampledCards]);

  }

  return sampled;

}

export function candidateKey(candidate: AIMove): string {

  if (candidate.type === 'play') return `play:${candidate.cards.map(card => card.id).sort().join(',')}`;

  return `${candidate.type}:${candidate.takeType ?? ''}`;

}

export function getActionKeysForHistoryMove(move: PlayerMove, pileBefore: Card[], options: GameOptions): string[] {

  if (move.type === 'play') {

    return [`play:${move.cards.map(card => card.id).sort().join(',')}`];

  }

  const takeOptions = getTakeOptions(pileBefore, options);

  const keys: string[] = [];

  if (takeOptions.canTake3 && move.cards.length === takeOptions.take3Count) keys.push('take:take3');

  if (takeOptions.canTakeAll && move.cards.length === takeOptions.takeAllCount) keys.push('take:takeAll');

  return keys;

}

export function getPreviousActionAtRepeatedPosition(state: GameState, playerId: number): string[] {

  const player = state.players.find(candidate => candidate.id === playerId);

  if (!player || state.moveHistory.length < 3 || state.moveHistory[0]?.turnNumber !== 0) return [];
  // The repeated-position scan is quadratic; skip it in long games to keep
  // search responsive. Cycle protection is still provided by transpositions.
  if (state.moveHistory.length > 60) return [];

  let historicalPile = [...state.pile];

  let historicalHand = [...player.hand];

  const historicalHandCounts = state.players.map(candidate => candidate.hand.length);

  const targetHand = player.hand.map(card => card.id).sort().join(',');

  const targetPile = state.pile.map(card => card.id).join(',');

  // Rewind the public move history while reconstructing only this AI's hand.

  // This identifies an exact earlier decision position without reading any

  // opponent's hidden hand.

  for (let index = state.moveHistory.length - 1; index >= 0; index--) {

    const move = state.moveHistory[index];

    if (move.type === 'play') {

      const playedIds = new Set(move.cards.map(card => card.id));

      historicalPile = historicalPile.filter((card, cardIndex) =>

        cardIndex < historicalPile.length - move.cards.length || !playedIds.has(card.id),

      );

      if (move.playerId === playerId) historicalHand = [...historicalHand, ...move.cards];

      historicalHandCounts[move.playerId] += move.cards.length;

    } else {

      if (move.playerId === playerId) {

        const takenIds = new Set(move.cards.map(card => card.id));

        historicalHand = historicalHand.filter(card => !takenIds.has(card.id));

      }

      historicalHandCounts[move.playerId] -= move.cards.length;

      historicalPile = [...historicalPile, ...move.cards];

    }

    const actedOnSamePosition = move.playerId === playerId &&

      historicalHand.map(card => card.id).sort().join(',') === targetHand &&

      historicalPile.map(card => card.id).join(',') === targetPile &&

      historicalHandCounts.every((count, playerIndex) => count === state.players[playerIndex].hand.length);

    if (!actedOnSamePosition) continue;

    const previousMove = state.moveHistory[index - 1];

    const wasBonusTurn = previousMove?.playerId === playerId && previousMove.type === 'play' && (

      (state.options.fourOfAKindRule && previousMove.cards.length === 4) ||

      (state.options.specialNinesRule && previousMove.cards.length === 3 && previousMove.cards.every(card => card.value === 9))

    );

    if (wasBonusTurn !== state.canContinueTurn) continue;

    return getActionKeysForHistoryMove(move, historicalPile, state.options);

  }

  return [];

}

export function applyRolloutCandidate(state: GameState, playerId: number, candidate: AIMove): GameState | null {

  if (candidate.type === 'play') {

    const isFirstMove = state.pile.length === 1 && state.pile[0].value === 9 && state.pile[0].suit === 'diamonds';

    const validation = validatePlay(candidate.cards, state.pile, isFirstMove, state.options);

    if (!validation.valid) return null;

    return playCards(state, playerId, candidate.cards, Boolean(validation.continueTurn));

  }

  if (candidate.type === 'take') {

    const takeOptions = getTakeOptions(state.pile, state.options);

    const count = candidate.takeType === 'takeAll' ? takeOptions.takeAllCount : takeOptions.take3Count;

    return count > 0 ? takeCards(state, playerId, count) : null;

  }

  return endTurn(state);

}

export function cloneSearchState(state: GameState): GameState {

  return {

    ...state,

    players: state.players.map(player => ({ ...player, hand: [...player.hand] })),

    pile: [...state.pile],

    finishOrder: state.finishOrder.map(player => ({ ...player, hand: [...player.hand] })),

  };

}

export function applySearchMove(state: GameState, playerId: number, move: AIMove): GameState | null {

  return applyRolloutCandidate(cloneSearchState(state), playerId, move);

}

export function getSearchPositionKey(state: GameState, depth: number, initialFinishCount: number): string {

  const hands = state.players.map(player => player.hasFinished

    ? '-'

    : player.hand.map(card => card.id).sort().join(','));

  return `${depth}|${initialFinishCount}|${state.currentPlayerIndex}|${state.canContinueTurn ? 1 : 0}|${state.pile.map(card => card.id).join(',')}|${hands.join('|')}|${state.finishOrder.slice(initialFinishCount).map(player => player.id).join(',')}`;

}

export function getSearchTerminalScore(state: GameState, context: AdversarialSearchContext, depth: number): number | null {

  const newlyFinished = state.finishOrder[context.initialFinishCount];

  if (!newlyFinished) return null;

  return newlyFinished.id === context.rootPlayerId

    ? 100000 + depth

    : -100000 - depth;

}

export function minimaxSearch(

  state: GameState,

  depth: number,

  alpha: number,

  beta: number,

  context: AdversarialSearchContext,

): number {

  const terminalScore = getSearchTerminalScore(state, context, depth);

  if (terminalScore !== null) return terminalScore;

  if (context.deadline && Date.now() >= context.deadline) {

    context.exhausted = true;

    return evaluateSearchPosition(state, context.rootPlayerId);

  }

  const positionKey = getSearchPositionKey(state, 0, context.initialFinishCount);

  if (context.path.has(positionKey)) return 0;

  if (depth <= 0) return evaluateSearchPosition(state, context.rootPlayerId);

  if (context.nodes >= context.maxNodes) {

    context.exhausted = true;

    return evaluateSearchPosition(state, context.rootPlayerId);

  }

  const pathSignature = [...context.path].sort().join(';');

  const key = `${positionKey}|${depth}|${pathSignature}`;

  const cached = context.transpositions.get(key);

  if (cached !== undefined) return cached;

  context.nodes++;

  context.path.add(positionKey);

  try {

    const current = state.players[state.currentPlayerIndex];

    if (!current || current.hasFinished) {

      const next = applySearchMove(state, current?.id ?? context.rootPlayerId, { type: 'endTurn', cards: [] });

      return next ? minimaxSearch(next, depth - 1, alpha, beta, context) : evaluateSearchPosition(state, context.rootPlayerId);

    }

    const candidates = getAIMoveCandidates(state, current.id, state.canContinueTurn);

    if (candidates.length === 0) {

      const next = applySearchMove(state, current.id, { type: 'endTurn', cards: [] });

      return next ? minimaxSearch(next, depth - 1, alpha, beta, context) : evaluateSearchPosition(state, context.rootPlayerId);

    }

    const maximizing = current.id === context.rootPlayerId;

    const ordered = candidates

      .map(move => ({ move, next: applySearchMove(state, current.id, move) }))

      .filter((entry): entry is { move: AIMove; next: GameState } => entry.next !== null)

      .map(entry => ({ ...entry, order: getSearchTerminalScore(entry.next, context, depth - 1) ?? evaluateSearchPosition(entry.next, context.rootPlayerId) }))

      .sort((left, right) => maximizing ? right.order - left.order : left.order - right.order);

    if (ordered.length === 0) return evaluateSearchPosition(state, context.rootPlayerId);

    let best = maximizing ? -Infinity : Infinity;

    let fullySearched = true;

    for (const entry of ordered) {

      if (context.deadline && Date.now() >= context.deadline) {

        context.exhausted = true;

        fullySearched = false;

        break;

      }

      if (context.nodes >= context.maxNodes) {

        context.exhausted = true;

        fullySearched = false;

        break;

      }

      const value = minimaxSearch(entry.next, depth - 1, alpha, beta, context);

      best = maximizing ? Math.max(best, value) : Math.min(best, value);

      if (maximizing) alpha = Math.max(alpha, best);

      else beta = Math.min(beta, best);

      if (beta <= alpha) {

        fullySearched = false;

        break;

      }

    }

    if (!Number.isFinite(best)) return evaluateSearchPosition(state, context.rootPlayerId);

    // Only cache exact values, with the ancestor path in the key because a

    // repeated position is scored as a draw during search.

    if (fullySearched && !context.exhausted) context.transpositions.set(key, best);

    return best;

  } finally {

    context.path.delete(positionKey);

  }

}

export function getSearchProfile(difficulty: AIDifficulty) {

  if (difficulty === 'expert') {

    return {

      depth: EXPERT_SEARCH_DEPTH,

      nodeBudget: EXPERT_SEARCH_NODE_BUDGET,

      timeBudget: EXPERT_SEARCH_TIME_BUDGET_MS,

      worlds: EXPERT_SEARCH_WORLDS,

    };

  }

  return {

    depth: HARD_SEARCH_DEPTH,

    nodeBudget: HARD_SEARCH_NODE_BUDGET,

    timeBudget: HARD_SEARCH_TIME_BUDGET_MS,

    worlds: HARD_SEARCH_WORLDS,

  };

}

export function adversarialSearchEstimates(state: GameState, playerId: number, candidates: AIMove[]): Map<string, number> {

  const results = new Map<string, number>();

  if (candidates.length === 0) return results;

  const profile = getSearchProfile(state.options.aiDifficulty);

  const searchedCandidates = candidates.slice(0, Math.min(candidates.length, 6));

  const worldScores = new Map<string, number[]>();

  const perWorldCandidateBudget = Math.max(200, Math.floor(profile.nodeBudget / (profile.worlds * Math.max(1, searchedCandidates.length))));

  const perWorldTimeBudget = Math.max(10, Math.floor(profile.timeBudget / profile.worlds));

  for (let world = 0; world < profile.worlds; world++) {

    const sampledWorld = sampleHiddenHands(state, playerId);

    const sharedTranspositions = new Map<string, number>();

    for (const candidate of searchedCandidates) {

      const key = candidateKey(candidate);

      const afterMove = applySearchMove(sampledWorld, playerId, candidate);

      if (!afterMove) {

        if (!worldScores.has(key)) worldScores.set(key, []);

        worldScores.get(key)!.push(-Infinity);

        continue;

      }

      const context: AdversarialSearchContext = {

        rootPlayerId: playerId,

        initialFinishCount: state.finishOrder.length,

        maxNodes: perWorldCandidateBudget,

        nodes: 0,

        exhausted: false,

        transpositions: sharedTranspositions,

        path: new Set([getSearchPositionKey(sampledWorld, 0, state.finishOrder.length)]),

        deadline: Date.now() + perWorldTimeBudget,

      };

      const value = minimaxSearch(

        afterMove,

        profile.depth - 1,

        -Infinity,

        Infinity,

        context,

      );

      if (!worldScores.has(key)) worldScores.set(key, []);

      worldScores.get(key)!.push(value);

    }

  }

  for (const candidate of candidates) {

    const key = candidateKey(candidate);

    const scores = worldScores.get(key) ?? [];

    const finiteScores = scores.filter(score => Number.isFinite(score));

    if (finiteScores.length === 0) {

      results.set(key, -Infinity);

    } else {

      results.set(key, finiteScores.reduce((total, score) => total + score, 0) / finiteScores.length);

    }

  }

  return results;

}

// -----------------------------

// Hard AI

// -----------------------------

export function getHardAIMove(state: GameState, playerId: number, searchFuture = true): AIMove {

  const player = state.players.find(p => p.id === playerId)!;

  const hand = player.hand;

  const pile = state.pile;

  const options = state.options;

  // The full legal-action list is used for the search. The candidate generator

  // is shared by every difficulty level so online and local AI agree.

  const generatedCandidates = getAIMoveCandidates(state, playerId, state.canContinueTurn);

  // A four-of-a-kind continuation can be ended, but it cannot be used to pick

  // up cards. The compact timeout policy must not turn a take choice into an

  // accidental end turn.

  const candidates = state.canContinueTurn

    ? [

        ...generatedCandidates.filter(candidate => candidate.type !== 'take'),

        ...(generatedCandidates.some(candidate => candidate.type === 'endTurn')

          ? []

          : [{ type: 'endTurn' as const, cards: [] }]),

      ]

    : generatedCandidates;

  if (!candidates || candidates.length === 0) {

    const takeOpts = getTakeOptions(pile, options);

    if (takeOpts.canTake3) return returnTakeMove('take3');

    if (takeOpts.canTakeAll) return returnTakeMove('takeAll');

    // No candidates and no take options -> force a play (pile may be only 9â™¦)

    const fallback = enforceNoSkipDecision([], null, pile, options, hand);

    if (fallback.type === 'take') return returnTakeMove(fallback.takeType === 'takeAll' ? 'takeAll' : 'take3');

    return fallback;

  }

  const preferredCandidates = candidates.filter(candidate =>

    candidate.type !== 'play' || (

      !isUnnecessaryAceOnOpening(candidate.cards, hand, pile) &&

      shouldUseFourOfAKind(candidate.cards, hand, state, playerId)

    )

  );

  const candidatesToScore = preferredCandidates.length > 0 ? preferredCandidates : candidates;

  const demonstrationScores = getHumanDemonstrationScores(state, playerId, candidatesToScore);
  const evaluationTracker = buildOpponentCardTracker(state, playerId);

  const baseScored = candidatesToScore.map(c => {

    let strategicScore: number;

    if (c.type === 'play') {

      strategicScore = evaluatePlayMove(c.cards, hand, pile, state, playerId);

      const validation = validatePlay(c.cards, pile, pile.length === 1 && pile[0].value === 9 && pile[0].suit === 'diamonds', options);

      if (validation.valid && validation.continueTurn && c.cards.length === 4) {

        const remainingHand = hand.filter(card => !c.cards.some(played => played.id === card.id));

        const nextPile = [...pile, ...c.cards];

        const nextPlays = getPossiblePlays(remainingHand, nextPile, options)

          .filter(play => validatePlay(play, nextPile, false, options).valid);

        if (nextPlays.length > 0) {

          const bestFollowUp = Math.max(...nextPlays.map(play => evaluatePlayMove(play, remainingHand, nextPile, state, playerId)));

          if (bestFollowUp > 0) strategicScore += bestFollowUp * 0.25;

        }

      }

    } else if (c.type === 'take') {

      const takeOptions = getTakeOptions(pile, options);

      const takeCount = c.takeType === 'takeAll' ? takeOptions.takeAllCount : takeOptions.take3Count;

      strategicScore = evaluateTakeMove(takeCount, hand, pile, state, playerId);

    } else {

      strategicScore = -10;

    }

    const humanDemonstrationScore = demonstrationScores.get(getTrainingMoveKey(c)) ?? 0;

    return { c, score: strategicScore + evaluateCandidate(state, playerId, c, evaluationTracker) + humanDemonstrationScore };

  });

  // Spend search time on the strongest tactical alternatives, while

  // preserving quad and immediate-win lines even if their static estimate is

  // temporarily understated. Larger tables use a wider search below.

  const rankedCandidates = [...baseScored].sort((a, b) => b.score - a.score);

  const repeatedActionKeys = getPreviousActionAtRepeatedPosition(state, playerId);

  const blockingTracker = buildOpponentCardTracker(state, playerId);

  const searchEstimates = searchFuture

    ? adversarialSearchEstimates(state, playerId, rankedCandidates.map(entry => entry.c))

    : new Map<string, number>();

  const scored = baseScored.map(entry => {

    // The adversarial search is the primary signal; demonstrated human choices

    // and tactical scoring break near-equal leaf evaluations.

    const key = candidateKey(entry.c);

    const futureScore = searchEstimates.get(key);

    const isImmediateWin = entry.c.type === 'play' && entry.c.cards.length === hand.length;

    const cyclePenalty = !isImmediateWin && repeatedActionKeys.includes(key) ? 1000 : 0;

    const highCardBlockPenalty = entry.c.type === 'play'

      ? getHighCardBlockingPenalty(entry.c.cards, hand, pile, state, playerId, blockingTracker)

      : 0;

    return { ...entry, score: (futureScore ?? 0) + entry.score * 0.2 - cyclePenalty - highCardBlockPenalty };

  });

  scored.sort((a, b) => b.score - a.score);

  const bestMove = scored[0].c;

  // Search uses a single hidden-hand deal reconstructed from public evidence;

  // it never reads the actual opponent hand from the live game state.

// 

const possiblePlays = getPossiblePlays(player.hand, pile, options);

const safeDecision = state.canContinueTurn

  ? bestMove

  : enforceNoSkipDecision(possiblePlays, bestMove, pile, options, player.hand);

if (safeDecision.type === 'take') return returnTakeMove(safeDecision.takeType === 'takeAll' ? 'takeAll' : 'take3');

return safeDecision;

}


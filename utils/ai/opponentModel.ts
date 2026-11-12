import { Card, GameState, GameOptions, AIDifficulty, Player, PlayerMove } from '../../types/game';
import { OpponentCardTracker } from './types';
import { combination } from './utils';

export function estimateOpponentStrength(state: GameState, playerId: number) {

  const opponents = state.players.filter(p => p.id !== playerId && !p.hasFinished);

  if (opponents.length === 0) {

    return {

      strongestOpponent: null,

      weakestOpponent: null,

      avgOpponentCards: 0,

      opponentCloseToWin: false,

      isOneVOne: false,

      humanOpponent: null,

    };

  }

  const sorted = [...opponents].sort((a, b) => a.hand.length - b.hand.length);

  const humanOpponent = opponents.find(p => !p.isAI) || null;

  return {

    strongestOpponent: sorted[0],

    weakestOpponent: sorted[sorted.length - 1],

    avgOpponentCards: opponents.reduce((sum, p) => sum + p.hand.length, 0) / opponents.length,

    opponentCloseToWin: opponents.some(p => p.hand.length <= 2),

    isOneVOne: opponents.length === 1,

    humanOpponent,

  };

}

export function buildOpponentCardTracker(state: GameState, playerId: number): OpponentCardTracker {

  const counts = new Map<number, number>();

  for (let v = 9; v <= 14; v++) counts.set(v, 4);

  for (const card of state.pile) counts.set(card.value, (counts.get(card.value) || 0) - 1);

  const ownHand = state.players.find(p => p.id === playerId)?.hand ?? [];

  for (const card of ownHand) counts.set(card.value, (counts.get(card.value) || 0) - 1);

  // Reconstruct cards that opponents picked up from the public pile and have

  // not played again. Those cards are known to be in that player's hand.

  const knownByPlayer = new Map<number, Map<string, Card>>();

  const unknownValueCeilings = new Map<number, number>();

  const historicalPile: Card[] = [];

  for (const player of state.players) knownByPlayer.set(player.id, new Map());

  for (const move of state.moveHistory) {

    const knownHand = knownByPlayer.get(move.playerId);

    if (!knownHand) continue;

    if (move.type === 'take') {

      const previousTopValue = historicalPile[historicalPile.length - 1]?.value;

      if (move.playerId !== playerId && previousTopValue !== undefined) {

        const oldCeiling = unknownValueCeilings.get(move.playerId);

        unknownValueCeilings.set(move.playerId, oldCeiling === undefined ? previousTopValue : Math.min(oldCeiling, previousTopValue));

      }

      for (const card of move.cards) knownHand.set(card.id, card);

      historicalPile.splice(Math.max(0, historicalPile.length - move.cards.length), move.cards.length);

    } else {

      for (const card of move.cards) {

        const wasKnownFromPickup = knownHand.has(card.id);

        const ceiling = unknownValueCeilings.get(move.playerId);

        if (!wasKnownFromPickup && ceiling !== undefined && card.value >= ceiling) {

          // The observed play contradicts the old failed-response deduction;

          // the player may have picked up voluntarily, so discard that inference.

          unknownValueCeilings.delete(move.playerId);

        }

        knownHand.delete(card.id);

      }

      historicalPile.push(...move.cards);

    }

  }

  const knownHands = new Map<number, Card[]>();

  for (const [opponentId, cardsById] of knownByPlayer) {

    const knownCards = [...cardsById.values()];

    knownHands.set(opponentId, knownCards);

    if (opponentId === playerId) continue;

    for (const card of knownCards) counts.set(card.value, (counts.get(card.value) || 0) - 1);

  }

  return { knownHands, unknownCounts: counts, unknownValueCeilings };

}

export function probabilityOpponentCanAnswer(tracker: OpponentCardTracker, state: GameState, opponentId: number, value: number) {

  const opponent = state.players.find(player => player.id === opponentId);

  if (!opponent || opponent.hasFinished) return 0;

  const knownCards = tracker.knownHands.get(opponentId) ?? [];

  if (knownCards.some(card => card.value >= value)) return 1;

  if (state.players.length === 2) {

    // The unseen rank counts are exactly this opponent's remaining cards in a

    // heads-up game; a voluntary pickup must not erase known higher cards.

    return [...tracker.unknownCounts].some(([rank, count]) => rank >= value && count > 0) ? 1 : 0;

  }

  const unknownSlots = Math.max(0, opponent.hand.length - knownCards.length);

  const unknownCeiling = tracker.unknownValueCeilings.get(opponentId);

  // A pickup after a failed response tells us the player's pre-existing

  // hidden cards were below that pile top. Keep a little uncertainty because

  // human players may sometimes choose to pick up voluntarily.

  if (unknownCeiling !== undefined && value >= unknownCeiling) return unknownSlots > 0 ? 0.08 : 0;

  let total = 0, ge = 0;

  for (let v = 9; v <= 14; v++) {

    if (unknownCeiling !== undefined && v >= unknownCeiling) continue;

    const c = Math.max(0, tracker.unknownCounts.get(v) || 0);

    total += c;

    if (v >= value) ge += c;

  }

  if (total <= 0 || unknownSlots <= 0 || ge <= 0) return 0;

  const below = total - ge;

  if (unknownSlots > below) return 1;

  // Cards are sampled without replacement. In a two-player game the unknown

  // pool is exactly the other player's unknown hand, making this deduction exact.

  let probabilityNoAnswer = 1;

  for (let draw = 0; draw < unknownSlots; draw++) {

    probabilityNoAnswer *= (below - draw) / (total - draw);

  }

  return 1 - probabilityNoAnswer;

}

export function probabilityOpponentHasValue(tracker: OpponentCardTracker, state: GameState, opponentId: number, value: number) {

  const opponent = state.players.find(player => player.id === opponentId);

  if (!opponent || opponent.hasFinished) return 0;

  const knownCards = tracker.knownHands.get(opponentId) ?? [];

  if (knownCards.some(card => card.value === value)) return 1;

  if (state.players.length === 2) return (tracker.unknownCounts.get(value) ?? 0) > 0 ? 1 : 0;

  const unknownSlots = Math.max(0, opponent.hand.length - knownCards.length);

  const unknownCeiling = tracker.unknownValueCeilings.get(opponentId);

  if (unknownSlots === 0 || (unknownCeiling !== undefined && value >= unknownCeiling)) return 0;

  let total = 0;

  for (let candidateValue = 9; candidateValue <= 14; candidateValue++) {

    if (unknownCeiling !== undefined && candidateValue >= unknownCeiling) continue;

    total += Math.max(0, tracker.unknownCounts.get(candidateValue) ?? 0);

  }

  const matchingCards = Math.max(0, tracker.unknownCounts.get(value) ?? 0);

  if (total === 0 || matchingCards === 0) return 0;

  const nonMatchingCards = total - matchingCards;

  if (unknownSlots > nonMatchingCards) return 1;

  let probabilityNoMatch = 1;

  for (let draw = 0; draw < unknownSlots; draw++) {

    probabilityNoMatch *= (nonMatchingCards - draw) / (total - draw);

  }

  return 1 - probabilityNoMatch;

}

export function probabilityOpponentHasAtLeast(

  tracker: OpponentCardTracker,

  state: GameState,

  opponentId: number,

  value: number,

  minimumCount: number,

) {

  const opponent = state.players.find(player => player.id === opponentId);

  if (!opponent || opponent.hasFinished) return 0;

  const knownCards = tracker.knownHands.get(opponentId) ?? [];

  const knownCount = knownCards.filter(card => card.value === value).length;

  if (knownCount >= minimumCount) return 1;

  if (state.players.length === 2) {

    const unknownCount = Math.max(0, tracker.unknownCounts.get(value) ?? 0);

    return knownCount + unknownCount >= minimumCount ? 1 : 0;

  }

  const unknownSlots = Math.max(0, opponent.hand.length - knownCards.length);

  const needed = minimumCount - knownCount;

  if (unknownSlots < needed) return 0;

  const ceiling = tracker.unknownValueCeilings.get(opponentId);

  let totalUnknown = 0;

  for (let candidateValue = 9; candidateValue <= 14; candidateValue++) {

    if (ceiling !== undefined && candidateValue >= ceiling) continue;

    totalUnknown += Math.max(0, tracker.unknownCounts.get(candidateValue) ?? 0);

  }

  const matchingUnknown = ceiling !== undefined && value >= ceiling

    ? 0

    : Math.max(0, tracker.unknownCounts.get(value) ?? 0);

  if (totalUnknown < unknownSlots || matchingUnknown < needed) return 0;

  const denominator = combination(totalUnknown, unknownSlots);

  if (denominator === 0) return 0;

  let probability = 0;

  for (let matching = needed; matching <= Math.min(matchingUnknown, unknownSlots); matching++) {

    probability += combination(matchingUnknown, matching) *

      combination(totalUnknown - matchingUnknown, unknownSlots - matching) / denominator;

  }

  return Math.min(1, probability);

}

export function probabilityAnyOpponentHasValue(tracker: OpponentCardTracker, state: GameState, playerId: number, value: number) {

  let probabilityNoOpponentHasValue = 1;

  for (const opponent of state.players) {

    if (opponent.id === playerId || opponent.hasFinished) continue;

    const probability = probabilityOpponentHasValue(tracker, state, opponent.id, value);

    probabilityNoOpponentHasValue *= 1 - probability;

  }

  return 1 - probabilityNoOpponentHasValue;

}

export function estimateOpponentCardsAtRank(

  tracker: OpponentCardTracker,

  state: GameState,

  opponentId: number,

  value: number,

) {

  const opponent = state.players.find(player => player.id === opponentId);

  if (!opponent || opponent.hasFinished) return 0;

  const knownCount = (tracker.knownHands.get(opponentId) ?? [])

    .filter(card => card.value === value).length;

  const unknownRankCount = Math.max(0, tracker.unknownCounts.get(value) ?? 0);

  if (state.players.length === 2) return knownCount + unknownRankCount;

  const unknownSlots = Math.max(0, opponent.hand.length - (tracker.knownHands.get(opponentId)?.length ?? 0));

  const ceiling = tracker.unknownValueCeilings.get(opponentId);

  if (unknownSlots === 0 || (ceiling !== undefined && value >= ceiling)) return knownCount;

  let eligibleUnknownCards = 0;

  for (let rank = 9; rank <= 14; rank++) {

    if (ceiling !== undefined && rank >= ceiling) continue;

    eligibleUnknownCards += Math.max(0, tracker.unknownCounts.get(rank) ?? 0);

  }

  if (eligibleUnknownCards === 0) return knownCount;

  return knownCount + unknownSlots * unknownRankCount / eligibleUnknownCards;

}


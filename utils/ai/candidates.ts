import { Card, GameState, GameOptions, AIDifficulty, Player, PlayerMove } from '../../types/game';
import { buildOpponentCardTracker, probabilityOpponentCanAnswer } from './opponentModel';
import { AIMove, HumanImitationStyle } from './types';
import { getContinueTurnMove } from './policies';
import { getLastOpponentContext, getTrainingMoveKey } from './utils';
import { getHardAIMove } from './search';
import { HUMAN_MOVE_TRAINING, getDemonstratedHighPileTakeRate, getDemonstratedPickupAdjustment, getDemonstratedQuadBreakShare } from '../humanMoveTraining';
import { HUMAN_MOVE_TRAINING_EXAMPLES } from '../humanMoveTrainingData';
import { getNextPlayerIndex, getTakeOptions, validatePlay, endTurn } from '../gameLogic';

export function getHumanDemonstrationScores(

  state: GameState,

  playerId: number,

  candidates: AIMove[],

  style: HumanImitationStyle = 'weighted',

): Map<string, number> {

  const scores = new Map(candidates.map(candidate => [getTrainingMoveKey(candidate), 0]));

  // The compiled demonstrations all use two players and all three rules.

  // Keep the learned preference out of unsupported table/rule configurations.

  if (

    state.players.length !== 2 ||

    !state.options.specialNinesRule ||

    !state.options.allowTakeAllCards ||

    !state.options.fourOfAKindRule

  ) return scores;

  const player = state.players.find(entry => entry.id === playerId);

  if (!player) return scores;

  const handCounts = Array(6).fill(0) as number[];

  const pileCounts = Array(6).fill(0) as number[];

  // In a two-player game the deck is fully accounted for by these two places

  // and the opponent's hand, so its six rank counts can be reconstructed.

  const opponentHandCounts = Array(6).fill(4) as number[];

  for (const card of player.hand) handCounts[card.value - 9]++;

  for (const card of state.pile) pileCounts[card.value - 9]++;

  for (const card of [...player.hand, ...state.pile]) opponentHandCounts[card.value - 9]--;

  const topValue = state.pile[state.pile.length - 1]?.value ?? 9;

  const opponentCounts = state.players

    .filter(entry => entry.id !== playerId)

    .map(entry => entry.hand.length)

    .sort((a, b) => a - b);

  const openingPile = state.pile.length === 1 && state.pile[0].value === 9 && state.pile[0].suit === 'diamonds';

  const lastOpponentContext = getLastOpponentContext(state, playerId);

  const neighborCount = style === 'nearest' ? 1 : style === 'consensus' ? 25 : 10;

  const temperature = style === 'consensus' ? 2.5 : 1.5;

  const neighbors = HUMAN_MOVE_TRAINING_EXAMPLES.map(example => {

    let distance = 0;

    for (let index = 0; index < 6; index++) {

      distance += Math.abs(handCounts[index] - example.hand[index]) * 0.65;

      distance += Math.abs(pileCounts[index] - example.pile[index]) * 0.2;

      distance += Math.abs(opponentHandCounts[index] - example.opponentHand[index]) * 0.45;

    }

    distance += Math.abs(topValue - example.top) * 0.8;

    distance += Math.abs(state.pile.length - example.pileLength) * 0.06;

    distance += Math.abs((opponentCounts[0] ?? 0) - (example.opponents[0] ?? 0)) * 0.08;

    if (lastOpponentContext.lastOpponentAction !== 0 && example.lastOpponentAction !== 0) {

      distance += Math.abs(lastOpponentContext.lastOpponentAction - example.lastOpponentAction) * 0.18;

    } else if (lastOpponentContext.lastOpponentAction !== example.lastOpponentAction) {

      distance += 0.35;

    }

    if (lastOpponentContext.lastOpponentTop !== 0 && example.lastOpponentTop !== 0) {

      distance += Math.abs(lastOpponentContext.lastOpponentTop - example.lastOpponentTop) * 0.35;

    }

    if (state.canContinueTurn !== example.canContinue) distance += 1;

    if (openingPile !== example.openingPile) distance += 1;

    return { example, distance };

  }).sort((a, b) => a.distance - b.distance).slice(0, neighborCount);

  if (style === 'nearest' && (neighbors[0]?.distance ?? Infinity) > 2.5) return scores;

  const weightedPreferences = new Map([...scores.keys()].map(key => [key, { preference: 0, weight: 0 }]));

  for (const { example, distance } of neighbors) {

    const weight = Math.exp(-distance / temperature);

    // A small follow-up reward favors demonstrated moves that improved the

    // human's card-count position by their next recorded decision. It is

    // deliberately bounded because these records do not contain counterfactuals.

    const outcomeWeight = example.futureObserved

      ? Math.max(0.75, Math.min(1.25,

          1 + example.futureCardSwing * 0.04 + example.futureHighCardSwing * 0.02,

        ))

      : 1;

    for (const [moveKey, totals] of weightedPreferences) {

      if (!example.available.includes(moveKey)) continue;

      totals.weight += weight;

      if (style === 'consensus') {

        if (example.chosen === moveKey) totals.preference += weight * outcomeWeight;

      } else {

        totals.preference += weight * (example.chosen === moveKey ? outcomeWeight : -0.25);

      }

    }

  }

  // The held-out-game move match rate for this compact nearest-neighbor policy

  // is below 70%, so keep its influence bounded and let tactical scoring lead.

  for (const [moveKey, totals] of weightedPreferences) {

    if (totals.weight === 0) continue;

    const confidence = 1 - Math.exp(-totals.weight / (style === 'consensus' ? 3 : 1.5));

    const preference = totals.preference / totals.weight;

    scores.set(moveKey, Math.max(-24, Math.min(32, preference * 32 * confidence)));

  }

  return scores;

}

// -----------------------------

// Possible plays generator (limited set)

// -----------------------------

export function getPossiblePlays(hand: Card[], pile: Card[], options: GameOptions): Card[][] {

  const plays: Card[][] = [];

  const topCard = pile[pile.length - 1];

  const isFirstMove = pile.length === 1 && topCard.suit === 'diamonds' && topCard.value === 9;

  const cardsByValue = new Map<number, Card[]>();

  for (const card of hand) {

    if (!cardsByValue.has(card.value)) cardsByValue.set(card.value, []);

    cardsByValue.get(card.value)!.push(card);

  }

  if (isFirstMove) {

    // The 9 of diamonds is already on the pile when the first player acts.

    // They may play any legal card, including the optional other nines.

    const nines = cardsByValue.get(9) || [];

    if (nines.length >= 1) plays.push([nines[0]]);

    if (options.specialNinesRule && nines.length >= 3) plays.push(nines.slice(0, 3));

    for (const [value, cards] of cardsByValue) {

      if (value >= topCard.value) plays.push([cards[0]]);

      if (options.fourOfAKindRule && value >= topCard.value && cards.length === 4) plays.push(cards);

    }

    return plays;

  }

  for (const [value, cards] of cardsByValue) {

    const canPlayOnTop = value >= topCard.value;

    if (canPlayOnTop) {

      plays.push([cards[0]]);

      if (cards.length >= 2) plays.push(cards.slice(0, 2));

      if (cards.length >= 3) plays.push(cards.slice(0, 3));

      if (cards.length === 4) plays.push(cards);

    }

  }

  return plays;

}

export function isUnnecessaryAceOnOpening(cardsToPlay: Card[], hand: Card[], pile: Card[]) {

  const isOpeningPile = pile.length === 1 && pile[0].value === 9 && pile[0].suit === 'diamonds';

  if (!isOpeningPile || !cardsToPlay.some(card => card.value === 14)) return false;

  // The intentional 3-nines + Ace trap is not a wasted opening Ace: it forces

  // the opponent to answer with an Ace or pick up, setting up a quad bury.

  const isNineAceTrap = cardsToPlay.filter(card => card.value === 9).length === 3 &&

    cardsToPlay.filter(card => card.value === 14).length === 1;

  if (isNineAceTrap) return false;

  const remainingHand = hand.filter(card => !cardsToPlay.some(played => played.id === card.id));

  // Keep a winning play, but save the Ace when any lower card can open instead.

  if (remainingHand.length === 0) return false;

  return remainingHand.some(card => card.value < 14);

}

export function shouldUseFourOfAKind(cardsToPlay: Card[], hand: Card[], state: GameState, playerId: number): boolean {

  // A four-card combined play (3 nines + Ace/King, or a quad + extra card)

  // is not a plain quad and is handled by its own tactical evaluation.

  const isPlainQuad = cardsToPlay.length === 4 &&

    new Set(cardsToPlay.map(card => card.value)).size === 1;

  if (!isPlainQuad) return true;

  const value = cardsToPlay[0].value;

  const remainingHand = hand.filter(card => !cardsToPlay.some(played => played.id === card.id));

  // Save the quad if any lower card remains. Spending it is justified when

  // this removes the lowest cards still in hand, including a winning play.

  if (remainingHand.every(card => card.value >= value)) return true;

  const currentIndex = state.players.findIndex(player => player.id === playerId);

  const nextIndex = getNextPlayerIndex(currentIndex, state.players);

  const nextPlayer = state.players[nextIndex];

  // Expert bury: when the opponent has just picked up and is several cards

  // behind, spend the quad as a quick getaway rather than holding it forever.

  if (state.options.aiDifficulty === 'expert' && nextPlayer && !nextPlayer.hasFinished &&

    nextPlayer.hand.length - hand.length >= 3) return true;

  if (!nextPlayer || nextPlayer.hasFinished || nextPlayer.hand.length > 3) return false;

  // Save the quad unless raising the pile is likely to strand the next player

  // with only lower cards. The closer they are to finishing, the less certainty

  // we require before using the quad as a block.

  const tracker = buildOpponentCardTracker(state, playerId);

  const blockProbability = 1 - probabilityOpponentCanAnswer(tracker, state, nextPlayer.id, value);

  const requiredBlockProbability = nextPlayer.hand.length === 1 ? 0.35 : nextPlayer.hand.length === 2 ? 0.5 : 0.67;

  // Expert is stingier with quads: outside an immediate block, hold them for a

  // quick getaway or a follow-up bury after the opponent picks up.

  const expertAdjustment = state.options.aiDifficulty === 'expert' ? 0.1 : 0;

  return blockProbability >= requiredBlockProbability + expertAdjustment;

}

export function getExpertOpeningTrap(
  hand: Card[],
  pile: Card[],
  state: GameState,
  playerId: number,
): Card[] | null {

  if (state.options.aiDifficulty !== 'expert' || state.canContinueTurn) return null;

  if (!state.options.specialNinesRule) return null;

  const activePlayers = state.players.filter(player => !player.hasFinished);

  if (activePlayers.length !== 2) return null;

  const player = state.players.find(entry => entry.id === playerId);

  if (!player || player.hasFinished) return null;

  const isOpeningPile = pile.length === 1 && pile[0].value === 9 && pile[0].suit === 'diamonds';

  if (!isOpeningPile) return null;

  const nines = hand.filter(card => card.value === 9);

  if (nines.length < 3) return null;

  const highCard = hand.find(card => card.value === 14) ?? hand.find(card => card.value === 13);

  if (!highCard) return null;

  const cards = [...nines.slice(0, 3), highCard];

  return validatePlay(cards, pile, true, state.options).valid ? cards : null;

}

export function getExpertCombinationPlays(
  hand: Card[],
  pile: Card[],
  state: GameState,
  playerId: number,
): Card[][] {

  if (state.options.aiDifficulty !== 'expert') return [];

  const activePlayers = state.players.filter(player => !player.hasFinished);

  // The pro trap and bury lines are heads-up tactics. Keep them out of larger

  // tables where a forced pickup does not hand the lead straight back.

  if (activePlayers.length !== 2) return [];

  const player = state.players.find(entry => entry.id === playerId);

  if (!player || player.hasFinished || hand.length === 0) return [];

  const topCard = pile[pile.length - 1];

  if (!topCard) return [];

  const isOpeningPile = pile.length === 1 && topCard.value === 9 && topCard.suit === 'diamonds';

  const cardsByValue = new Map<number, Card[]>();

  for (const card of hand) {

    if (!cardsByValue.has(card.value)) cardsByValue.set(card.value, []);

    cardsByValue.get(card.value)!.push(card);

  }

  const plays: Card[][] = [];

  const addIfLegal = (cards: Card[]) => {

    if (!validatePlay(cards, pile, isOpeningPile, state.options).valid) return;

    const key = cards.map(card => card.id).sort().join(',');

    if (plays.some(existing => existing.map(card => card.id).sort().join(',') === key)) return;

    plays.push(cards);

  };

  // Pro opening: 3 nines continue the turn, and a King or Ace on top forces

  // the opponent to answer with an Ace or pick up. If they pick up, the AI

  // keeps the lead and can follow with a quad bury.

  const nines = cardsByValue.get(9) ?? [];

  if (isOpeningPile && state.options.specialNinesRule && nines.length >= 3) {

    const highs = [...(cardsByValue.get(14) ?? []), ...(cardsByValue.get(13) ?? [])];

    for (const high of highs.slice(0, 2)) addIfLegal([...nines.slice(0, 3), high]);

  }

  // Quad bury: use the quad's continuation to add one high single card, so

  // the opponent is stranded under a rank they are unlikely to answer.

  if (state.options.fourOfAKindRule) {

    for (const [value, cards] of cardsByValue) {

      if (cards.length !== 4 || value < topCard.value) continue;

      const extras = [...cardsByValue.entries()]

        .filter(([extraValue]) => extraValue > value)

        .sort((left, right) => right[0] - left[0]);

      for (const [, extraCards] of extras.slice(0, 2)) {

        addIfLegal([...cards, extraCards[0]]);

      }

    }

  }

  return plays;

}

export function getAIMoveCandidates(state: GameState, playerId: number, continuingTurn = state.canContinueTurn): AIMove[] {

  const player = state.players.find(candidate => candidate.id === playerId);

  if (!player || player.hasFinished) return [];

  const isFirstMove = state.pile.length === 1 && state.pile[0].value === 9 && state.pile[0].suit === 'diamonds';

  const possiblePlays = [

    ...getPossiblePlays(player.hand, state.pile, state.options),

    ...getExpertCombinationPlays(player.hand, state.pile, state, playerId),

  ]

    .filter(cards => {

      const isPlainQuad = cards.length === 4 && new Set(cards.map(card => card.value)).size === 1;

      return (!isPlainQuad || state.options.fourOfAKindRule) &&

        validatePlay(cards, state.pile, isFirstMove, state.options).valid;

    });

  const candidates: AIMove[] = possiblePlays.map(cards => ({ type: 'play', cards }));

  if (continuingTurn) {

    candidates.push({ type: 'endTurn', cards: [] });

  } else {

    const takeOptions = getTakeOptions(state.pile, state.options);

    if (takeOptions.canTake3) candidates.push({ type: 'take', cards: [], takeType: 'take3' });

    if (takeOptions.canTakeAll) candidates.push({ type: 'take', cards: [], takeType: 'takeAll' });

  }

  const seen = new Set<string>();

  return candidates.filter(candidate => {

    const key = candidate.type === 'play'

      ? `play:${candidate.cards.map(card => card.id).sort().join(',')}`

      : `${candidate.type}:${candidate.takeType ?? ''}`;

    if (seen.has(key)) return false;

    seen.add(key);

    return true;

  });

}

export function getHumanImitationMove(state: GameState, playerId: number, style: HumanImitationStyle = 'weighted'): {

  move: AIMove;

  usedDemonstration: boolean;

  demonstrationScore: number;

} {

  const player = state.players.find(candidate => candidate.id === playerId);

  const candidates = getAIMoveCandidates(state, playerId);

  const scores = getHumanDemonstrationScores(state, playerId, candidates, style);

  let bestCandidate: AIMove | null = null;

  let bestScore = -Infinity;

  for (const candidate of candidates) {

    const score = scores.get(getTrainingMoveKey(candidate)) ?? 0;

    if (score > bestScore) {

      bestScore = score;

      bestCandidate = candidate;

    }

  }

  if (bestCandidate && bestScore > 0) {

    return { move: bestCandidate, usedDemonstration: true, demonstrationScore: bestScore };

  }

  // When the position is not represented well by the human examples, fall

  // back to the hard tactical policy without recursively launching another

  // minimax tree from inside a search.

  const fallbackOptions = { ...state.options, aiDifficulty: 'hard' as const };

  const fallbackState = { ...state, options: fallbackOptions };

  const fallbackMove = player

    ? state.canContinueTurn

      ? getContinueTurnMove(player.hand, state.pile, 'hard', fallbackOptions, fallbackState, playerId)

      : getHardAIMove(fallbackState, playerId, false)

    : { type: 'endTurn' as const, cards: [] };

  return { move: fallbackMove, usedDemonstration: false, demonstrationScore: Math.max(0, bestScore) };

}


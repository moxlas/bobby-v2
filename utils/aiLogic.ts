```ts
import { Card, GameState, GameOptions, AIDifficulty, Player } from '../types/game';
import { getCardsOfSameValue, hasFourOfSameValue, sortHand } from './deckUtils';
import { getTakeOptions, validatePlay } from './gameLogic';

// ============================================================
// AI Difficulty mapping and behavior
// - Previous "hard" logic has been moved to "medium"
// - New "hard" implements hybrid heuristics + targeted rollouts
// Rule enforcement:
// - AI cannot skip turns (no endTurn unless no options)
// - AI may choose TAKE as its initial action
// - Once AI plays any card, taking becomes illegal for remainder of that turn
// - Taking cards immediately ends the turn
// - Continuation phase can only PLAY or END TURN
// ============================================================

// -----------------------------
// Score weights (tunable)
// -----------------------------
const SCORE_WEIGHTS = {
  // Hand composition
  THREE_OF_A_KIND_PENALTY: -30,
  TWO_OF_A_KIND_BONUS: 5,
  FOUR_OF_A_KIND_BONUS: 80,
  NINE_TRIPLE_BONUS: 40,
  NINE_QUAD_BONUS: 90,

  // High card preservation - CRITICAL
  HIGH_CARD_PENALTY: -25,
  ACE_PENALTY: -30,
  FOUR_ACES_PENALTY: -500,
  PRESERVE_HIGH_CARDS_BONUS: 15,

  // Taking cards - HEAVY penalties
  TAKING_CARDS_BASE_PENALTY: -50,
  TAKING_COMPLETES_QUAD_BONUS: 120,
  TAKING_HIGH_CARDS_BONUS: 15,
  TAKING_USEFUL_CARDS_BONUS: 25,
  TAKING_WHEN_LEADING_PENALTY: -40,

  // Playing cards
  WINNING_MOVE_BONUS: 2000,
  CARDS_REMAINING_PENALTY: -15,
  CAN_FINISH_SOON_BONUS: 200,

  // Strategic play
  FORCE_OPPONENT_TAKE_BONUS: 45,
  PLAYING_HIGH_TO_BLOCK: 35,
  PLAY_LOW_CARDS_BONUS: 5,

  // Opponent awareness
  OPPONENT_CLOSE_TO_WIN_PENALTY: -100,
  BLOCKING_OPPONENT_BONUS: 50,
  LEADING_POSITION_BONUS: 30,

  // Pile awareness
  UNCOVER_LOW_CARDS_BONUS: 30,
  OPPONENT_TAKES_BAD_PENALTY: -25,

  // 1v1 strategic plays
  NINE_PLUS_ACE_TRAP_BONUS: 150,
  FOUR_OF_KIND_TRAP_BONUS: 100,
};

// -----------------------------
// Utilities & Analysis
// -----------------------------
function analyzePile(pile: Card[]) {
  if (pile.length <= 1) {
    return {
      topValue: pile[0]?.value || 0,
      hasLowCards: false,
      lowestCard: 14,
      averageValue: 0,
      cardValues: [] as number[],
    };
  }
  const values = pile.slice(1).map(c => c.value);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    topValue: pile[pile.length - 1].value,
    hasLowCards: values.some(v => v <= 10),
    lowestCard: Math.min(...values),
    averageValue: avg,
    cardValues: values,
  };
}

function wouldCompleteQuad(hand: Card[], cardsToTake: Card[]) {
  const combined = [...hand, ...cardsToTake];
  const valueCounts = new Map<number, number>();
  for (const card of combined) {
    valueCounts.set(card.value, (valueCounts.get(card.value) || 0) + 1);
  }
  for (const [value, count] of valueCounts) {
    if (count === 4) {
      const hadThreeBefore = hand.filter(c => c.value === value).length === 3;
      if (hadThreeBefore) {
        return { wouldComplete: true, value };
      }
    }
  }
  return { wouldComplete: false, value: null };
}

function wouldGetHighCards(cardsToTake: Card[]) {
  return cardsToTake.some(c => c.value >= 13);
}

function wouldFixTriple(hand: Card[], cardsToTake: Card[]) {
  const valueCounts = new Map<number, number>();
  for (const card of hand) {
    valueCounts.set(card.value, (valueCounts.get(card.value) || 0) + 1);
  }
  for (const [value, count] of valueCounts) {
    if (count === 3) {
      const takingThisValue = cardsToTake.filter(c => c.value === value).length;
      if (takingThisValue === 1) return true;
    }
  }
  return false;
}

function countHighCards(hand: Card[]) {
  let jacks = 0, queens = 0, kings = 0, aces = 0;
  for (const card of hand) {
    if (card.value === 11) jacks++;
    else if (card.value === 12) queens++;
    else if (card.value === 13) kings++;
    else if (card.value === 14) aces++;
  }
  return { jacks, queens, kings, aces, total: jacks + queens + kings + aces };
}

function estimateOpponentStrength(state: GameState, playerId: number) {
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

function estimateOpponentCards(state: GameState, playerId: number) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { possibleHighCards: 0, possibleAces: 0, estimatedTotal: 0 };
  const knownCards = new Set<string>();
  for (const card of player.hand) knownCards.add(`${card.value}-${card.suit}`);
  for (const card of state.pile) knownCards.add(`${card.value}-${card.suit}`);
  const totalHighCards = 12;
  const totalAces = 4;
  const myHighCards = player.hand.filter(c => c.value >= 11).length;
  const myAces = player.hand.filter(c => c.value === 14).length;
  const pileHighCards = state.pile.filter(c => c.value >= 11).length;
  const pileAces = state.pile.filter(c => c.value === 14).length;
  const possibleHighCards = Math.max(0, totalHighCards - myHighCards - pileHighCards);
  const possibleAces = Math.max(0, totalAces - myAces - pileAces);
  return { possibleHighCards, possibleAces, estimatedTotal: possibleHighCards };
}

// -----------------------------
// Rule enforcement helpers
// -----------------------------
function isPlayMove(move: { type: string; cards: Card[] }) {
  return move.type === 'play' && move.cards && move.cards.length > 0;
}
function returnTakeMove(takeType: 'take3' | 'takeAll') {
  return { type: 'take' as const, cards: [] as Card[], takeType };
}

// -----------------------------
// Remaining counts & probability approx
// -----------------------------
function remainingCountsFromState(state: GameState) {
  const counts = new Map<number, number>();
  for (let v = 9; v <= 14; v++) counts.set(v, 4);
  for (const card of state.pile) counts.set(card.value, (counts.get(card.value) || 0) - 1);
  for (const p of state.players) for (const c of p.hand) counts.set(c.value, (counts.get(c.value) || 0) - 1);
  return counts;
}

function approxProbOpponentHasAtLeast(counts: Map<number, number>, value: number, handSize: number) {
  let total = 0, ge = 0;
  for (let v = 9; v <= 14; v++) {
    const c = Math.max(0, counts.get(v) || 0);
    total += c;
    if (v >= value) ge += c;
  }
  if (total <= 0) return 0;
  const f = ge / total;
  return 1 - Math.pow(1 - f, handSize);
}

// -----------------------------
// 3-nines + Ace trap evaluation
// -----------------------------
function evaluateNineAceTrap(hand: Card[], pile: Card[], state: GameState, playerId: number) {
  const opponentInfo = estimateOpponentStrength(state, playerId);
  if (!opponentInfo.isOneVOne) return { canPlay: false, score: 0, cards: [] as Card[] };
  if (!(pile.length === 1 && pile[0].value === 9 && pile[0].suit === 'diamonds')) return { canPlay: false, score: 0, cards: [] as Card[] };
  const nines = hand.filter(c => c.value === 9);
  if (nines.length < 3) return { canPlay: false, score: 0, cards: [] as Card[] };
  const aces = hand.filter(c => c.value === 14);
  if (aces.length === 0) return { canPlay: false, score: 0, cards: [] as Card[] };
  const tens = hand.filter(c => c.value === 10);
  const jacks = hand.filter(c => c.value === 11);
  const queens = hand.filter(c => c.value === 12);
  const hasFourTens = tens.length === 4;
  const hasFourJacks = jacks.length === 4;
  const hasFourQueens = queens.length === 4;
  let trapBonus = SCORE_WEIGHTS.NINE_PLUS_ACE_TRAP_BONUS;
  if (hasFourTens || hasFourJacks || hasFourQueens) trapBonus += SCORE_WEIGHTS.FOUR_OF_KIND_TRAP_BONUS;
  const cards = [...nines.slice(0, 3), aces[0]];
  const remainingHand = hand.filter(c => !cards.some(pc => pc.id === c.id));
  const remainingHighCards = countHighCards(remainingHand);
  if (remainingHighCards.total >= 2) trapBonus += SCORE_WEIGHTS.PRESERVE_HIGH_CARDS_BONUS;
  return { canPlay: true, score: trapBonus, cards };
}

// -----------------------------
// Evaluate play move (used by medium/hard continuation)
// -----------------------------
function evaluatePlayMove(cardsToPlay: Card[], hand: Card[], pile: Card[], state: GameState, playerId: number) {
  let score = 0;
  const remainingHand = hand.filter(c => !cardsToPlay.find(pc => pc.id === c.id));
  const pileAnalysis = analyzePile(pile);
  const opponentInfo = estimateOpponentStrength(state, playerId);

  if (remainingHand.length === 0) return SCORE_WEIGHTS.WINNING_MOVE_BONUS;
  if (remainingHand.length <= 3) score += SCORE_WEIGHTS.CAN_FINISH_SOON_BONUS * (4 - remainingHand.length) / 3;
  score += evaluateHandComposition(remainingHand);

  const playValue = cardsToPlay[0].value;

  // High card preservation
  if (playValue >= 11) {
    const highCardCount = cardsToPlay.length;
    score += SCORE_WEIGHTS.HIGH_CARD_PENALTY * highCardCount;
    if (playValue === 14) score += SCORE_WEIGHTS.ACE_PENALTY * highCardCount;
    if (cardsToPlay.length === 4 && playValue === 14) {
      const aceDecision = shouldPlayFourAces(hand, pile, state, playerId);
      if (!aceDecision.shouldPlay) score += SCORE_WEIGHTS.FOUR_ACES_PENALTY;
    }
  }

  const remainingHighCards = countHighCards(remainingHand);
  if (remainingHighCards.total >= 2) score += SCORE_WEIGHTS.PRESERVE_HIGH_CARDS_BONUS;
  if (playValue <= 10) score += SCORE_WEIGHTS.PLAY_LOW_CARDS_BONUS;

  if (cardsToPlay.length === 1 && playValue >= 11) {
    score += evaluateForceOpponentTake(cardsToPlay[0], hand, pile, state, playerId);
  }

  if (cardsToPlay.length === 4) {
    if (playValue === 14) {
      const aceDecision = shouldPlayFourAces(hand, pile, state, playerId);
      if (aceDecision.shouldPlay) score += SCORE_WEIGHTS.FOUR_OF_A_KIND_BONUS;
    } else {
      score += SCORE_WEIGHTS.FOUR_OF_A_KIND_BONUS;
      const fourOfKindValue = hasFourOfSameValue(remainingHand);
      if (fourOfKindValue !== null && fourOfKindValue !== 14) score += SCORE_WEIGHTS.FOUR_OF_A_KIND_BONUS * 0.4;
    }
  }

  if (cardsToPlay.length === 3 && cardsToPlay.every(c => c.value === 9)) score += SCORE_WEIGHTS.NINE_TRIPLE_BONUS;

  const myCardCount = remainingHand.length;
  if (myCardCount < opponentInfo.avgOpponentCards) score += SCORE_WEIGHTS.LEADING_POSITION_BONUS;

  if (opponentInfo.opponentCloseToWin) {
    score += SCORE_WEIGHTS.OPPONENT_CLOSE_TO_WIN_PENALTY;
    if (playValue >= 12) score += SCORE_WEIGHTS.BLOCKING_OPPONENT_BONUS;
  }

  return score;
}

function evaluateHandComposition(hand: Card[]) {
  let score = 0;
  const valueCounts = new Map<number, number>();
  for (const card of hand) valueCounts.set(card.value, (valueCounts.get(card.value) || 0) + 1);
  for (const [value, count] of valueCounts) {
    if (count === 4) {
      score += SCORE_WEIGHTS.FOUR_OF_A_KIND_BONUS;
      if (value === 9) score += SCORE_WEIGHTS.NINE_QUAD_BONUS;
    } else if (count === 3) {
      if (value === 9) score += SCORE_WEIGHTS.NINE_TRIPLE_BONUS;
      else score += SCORE_WEIGHTS.THREE_OF_A_KIND_PENALTY;
    } else if (count === 2) {
      score += SCORE_WEIGHTS.TWO_OF_A_KIND_BONUS;
    }
  }
  score += hand.length * SCORE_WEIGHTS.CARDS_REMAINING_PENALTY;
  return score;
}

function evaluateForceOpponentTake(cardToPlay: Card, hand: Card[], pile: Card[], state: GameState, playerId: number) {
  let bonus = 0;
  const pileAnalysis = analyzePile(pile);
  const opponentInfo = estimateOpponentStrength(state, playerId);
  if (cardToPlay.value >= 13) {
    if (opponentInfo.strongestOpponent && opponentInfo.strongestOpponent.hand.length <= 4) bonus += SCORE_WEIGHTS.FORCE_OPPONENT_TAKE_BONUS;
    if (pileAnalysis.hasLowCards) bonus += SCORE_WEIGHTS.UNCOVER_LOW_CARDS_BONUS;
  }
  if (cardToPlay.value >= 11 && cardToPlay.value <= 12) {
    if (opponentInfo.opponentCloseToWin) bonus += SCORE_WEIGHTS.PLAYING_HIGH_TO_BLOCK;
  }
  return bonus;
}

function shouldPlayFourAces(hand: Card[], pile: Card[], state: GameState, playerId: number) {
  const aces = hand.filter(c => c.value === 14);
  if (aces.length !== 4) return { shouldPlay: false, reason: "Don't have 4 Aces" };
  const topCard = pile[pile.length - 1];
  if (topCard && topCard.value > 14) return { shouldPlay: false, reason: "Can't play Aces on higher card" };
  const opponentInfo = estimateOpponentStrength(state, playerId);
  if (hand.length === 4) return { shouldPlay: true, reason: "Last 4 cards - winning move!" };
  if (opponentInfo.opponentCloseToWin && hand.length <= 6) return { shouldPlay: true, reason: "Blocking opponent win attempt" };
  if (opponentInfo.isOneVOne) {
    const remainingHand = hand.filter(c => c.value !== 14);
    const fourOfKindValue = hasFourOfSameValue(remainingHand);
    if (fourOfKindValue !== null) return { shouldPlay: true, reason: "Can follow up with another 4-of-a-kind" };
  }
  return { shouldPlay: false, reason: "Preserving Aces for critical moment" };
}

// -----------------------------
// Possible plays generator (limited set)
// -----------------------------
function getPossiblePlays(hand: Card[], pile: Card[], options: GameOptions): Card[][] {
  const plays: Card[][] = [];
  const topCard = pile[pile.length - 1];
  const isFirstMove = pile.length === 1 && topCard.suit === 'diamonds' && topCard.value === 9;
  const cardsByValue = new Map<number, Card[]>();
  for (const card of hand) {
    if (!cardsByValue.has(card.value)) cardsByValue.set(card.value, []);
    cardsByValue.get(card.value)!.push(card);
  }

  if (isFirstMove) {
    const nines = cardsByValue.get(9) || [];
    if (nines.length >= 1) plays.push([nines[0]]);
    if (nines.length >= 3) plays.push(nines.slice(0, 3));
    if (nines.length === 4 && options.allowFourNinesStart) plays.push(nines);
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

// -----------------------------
// Candidate generation (small set) for Hard AI
// -----------------------------
function generateCandidates(state: GameState, playerId: number) {
  const player = state.players.find(p => p.id === playerId)!;
  const hand = player.hand;
  const pile = state.pile;
  const options = state.options;
  const topCard = pile[pile.length - 1];
  const isFirstMove = pile.length === 1 && topCard.value === 9 && topCard.suit === 'diamonds';

  const candidates: any[] = [];
  const legalSingles = hand.filter(c => c.value >= topCard.value);
  if (legalSingles.length > 0) {
    legalSingles.sort((a, b) => a.value - b.value);
    candidates.push({ type: 'play', cards: [legalSingles[0]] });
    candidates.push({ type: 'play', cards: [legalSingles[legalSingles.length - 1]] });
    if (legalSingles.length > 2) candidates.push({ type: 'play', cards: [legalSingles[Math.floor(legalSingles.length / 2)]] });
  }

  const byVal = new Map<number, Card[]>();
  for (const c of hand) {
    if (!byVal.has(c.value)) byVal.set(c.value, []);
    byVal.get(c.value)!.push(c);
  }
  for (const [val, cards] of byVal) {
    if (cards.length === 4 && val >= topCard.value && options.allowFourOfKind) candidates.push({ type: 'play', cards: cards.slice() });
    if (cards.length >= 2 && val >= topCard.value) candidates.push({ type: 'play', cards: cards.slice(0, Math.min(3, cards.length)) });
  }

  if (isFirstMove) {
    const nines = (byVal.get(9) || []);
    if (nines.length >= 3) candidates.push({ type: 'play', cards: nines.slice(0, 3) });
    if (nines.length >= 1) candidates.push({ type: 'play', cards: [nines[0]] });
  }

  // Strategic take candidates even if plays exist (only include when beneficial)
  const takeOpts = getTakeOptions(pile, options);
  const opponentInfo = estimateOpponentStrength(state, playerId);
  if (takeOpts.canTake3) {
    const cards3 = pile.slice(-takeOpts.take3Count);
    if (wouldCompleteQuad(player.hand, cards3).wouldComplete || wouldGetHighCards(cards3) || (opponentInfo.opponentCloseToWin && wouldFixTriple(player.hand, cards3))) {
      candidates.push({ type: 'take', takeType: 'take3', cards: [] });
    }
  }
  if (takeOpts.canTakeAll) {
    const cardsAll = pile.slice(1);
    if (wouldCompleteQuad(player.hand, cardsAll).wouldComplete || wouldGetHighCards(cardsAll) || (opponentInfo.opponentCloseToWin && wouldFixTriple(player.hand, cardsAll))) {
      candidates.push({ type: 'take', takeType: 'takeAll', cards: [] });
    }
  }

  // If no candidates yet, include basic take options as fallback
  if (candidates.length === 0) {
    if (takeOpts.canTakeAll) candidates.push({ type: 'take', takeType: 'takeAll', cards: [] });
    if (takeOpts.canTake3) candidates.push({ type: 'take', takeType: 'take3', cards: [] });
  }

  // Deduplicate
  const sigs = new Set<string>();
  const uniq: any[] = [];
  for (const c of candidates) {
    const sig = c.type === 'take' ? `take-${c.takeType}` : `play-${c.cards.map((x: Card) => x.id).join(',')}`;
    if (!sigs.has(sig)) { sigs.add(sig); uniq.push(c); }
  }
  return uniq;
}

// -----------------------------
// Lightweight evaluation for candidates (Hard AI)
// -----------------------------
function evaluateCandidate(state: GameState, playerId: number, candidate: any) {
  const player = state.players.find(p => p.id === playerId)!;
  const hand = player.hand;
  const pile = state.pile;
  const counts = remainingCountsFromState(state);
  const opponentInfo = estimateOpponentStrength(state, playerId);

  const deltaHand = candidate.type === 'play' ? candidate.cards.length : 0;
  let score = 0;
  score += 6 * deltaHand;

  const myCards = hand.length;
  const endgame = myCards <= 4 || opponentInfo.opponentCloseToWin;
  if (endgame) score += 20;

  if (candidate.type === 'play') {
    for (const c of candidate.cards) {
      if (c.value === 14) score -= 30;
      else if (c.value === 13) score -= 12;
      else if (c.value === 12) score -= 8;
    }
  }

  if (candidate.type === 'play' && candidate.cards.length === 4) {
    if (candidate.cards[0].value === 14) {
      if (hand.length !== 4 && !opponentInfo.opponentCloseToWin) score -= 200;
    } else {
      if (hand.length === 4) score += 120;
      else if (pile.length >= 5) score += 30;
    }
  }

  const nextIdx = (state.players.findIndex(p => p.id === playerId) + 1) % state.players.length;
  const nextPlayer = state.players[nextIdx];
  const nextHandSize = nextPlayer ? nextPlayer.hand.length : 0;
  const newTop = candidate.type === 'play' ? candidate.cards[candidate.cards.length - 1].value : pile[pile.length - 1].value;
  const probNextCanPlay = approxProbOpponentHasAtLeast(counts, newTop, nextHandSize);
  const forceProb = 1 - probNextCanPlay;
  score += 10 * forceProb;

  if (opponentInfo.opponentCloseToWin) {
    if (candidate.type === 'play' && candidate.cards.some((c: Card) => c.value >= 12)) score += 25;
    if (candidate.type === 'take') score += 15;
  }

  const remainingAfter = candidate.type === 'play' ? hand.filter(h => !candidate.cards.find((c: Card) => c.id === h.id)) : hand;
  const remCounts = new Map<number, number>();
  for (const c of remainingAfter) remCounts.set(c.value, (remCounts.get(c.value) || 0) + 1);
  for (const [v, cnt] of remCounts) {
    if (cnt === 3 && v !== 14) score += 20;
    if (cnt >= 2 && v >= 11) score += 6;
  }

  const trap = evaluateNineAceTrap(hand, pile, state, playerId);
  if (trap.canPlay && candidate.type === 'play' && candidate.cards.length === 4 && candidate.cards.every((c: Card) => c.value === 9 || c.value === 14)) {
    score += trap.score;
  }

  const enableProb = approxProbOpponentHasAtLeast(counts, newTop + 1, nextHandSize);
  score -= 8 * enableProb;

  return score;
}

// -----------------------------
// Fast simulator helpers for rollouts (simple opponent policy)
// -----------------------------
function fastCloneStateForSim(state: GameState): GameState {
  // For speed in this example we use JSON deep clone.
  // Replace with a more efficient clone if needed.
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function applyCandidateToSim(sim: GameState, playerId: number, candidate: any) {
  const player = sim.players.find(p => p.id === playerId)!;
  if (candidate.type === 'play') {
    for (const c of candidate.cards) {
      const idx = player.hand.findIndex((h: Card) => h.id === c.id);
      if (idx >= 0) player.hand.splice(idx, 1);
      sim.pile.push(c);
    }
  } else {
    const takeCount = candidate.takeType === 'takeAll' ? Math.max(0, sim.pile.length - 1) : Math.min(3, Math.max(0, sim.pile.length - 1));
    const taken = sim.pile.splice(sim.pile.length - takeCount, takeCount);
    player.hand.push(...taken);
    // Taking ends turn immediately by rules; we do not simulate continuation here.
  }
}

function simulateFastPlayout(sim: GameState, aiPlayerId: number, maxSteps = 200): number {
  // Simple policy: each player plays lowest legal card; if none, take3 or takeAll if available.
  let currentIdx = sim.players.findIndex(p => !p.hasFinished && p.hand.length > 0);
  if (currentIdx === -1) return aiPlayerId;
  let steps = 0;
  while (steps < maxSteps) {
    const player = sim.players[currentIdx];
    if (!player || player.hasFinished) {
      currentIdx = (currentIdx + 1) % sim.players.length;
      steps++;
      continue;
    }
    // If player has no cards -> finished
    if (player.hand.length === 0) {
      player.hasFinished = true;
      const unfinished = sim.players.filter(p => !p.hasFinished);
      if (unfinished.length === 1) return unfinished[0].id;
      currentIdx = (currentIdx + 1) % sim.players.length;
      steps++;
      continue;
    }
    const top = sim.pile[sim.pile.length - 1];
    // find lowest legal single
    const legal = player.hand.filter((c: Card) => c.value >= top.value);
    if (legal.length > 0) {
      legal.sort((a: Card, b: Card) => a.value - b.value);
      const play = legal[0];
      // play single
      const idx = player.hand.findIndex((h: Card) => h.id === play.id);
      if (idx >= 0) player.hand.splice(idx, 1);
      sim.pile.push(play);
      // continuation: naive - do not continue
    } else {
      // take
      const takeOpts = getTakeOptions(sim.pile, sim.options);
      if (takeOpts.canTake3) {
        const takeCount = Math.min(3, Math.max(0, sim.pile.length - 1));
        const taken = sim.pile.splice(sim.pile.length - takeCount, takeCount);
        player.hand.push(...taken);
      } else if (takeOpts.canTakeAll) {
        const takeCount = Math.max(0, sim.pile.length - 1);
        const taken = sim.pile.splice(sim.pile.length - takeCount, takeCount);
        player.hand.push(...taken);
      }
      // taking ends turn
    }
    // check win
    if (player.hand.length === 0) {
      player.hasFinished = true;
      const unfinished = sim.players.filter(p => !p.hasFinished);
      if (unfinished.length === 1) return unfinished[0].id;
      // if aiPlayerId finished, return winner
      if (player.id === aiPlayerId) return aiPlayerId;
    }
    currentIdx = (currentIdx + 1) % sim.players.length;
    steps++;
  }
  // fallback: return player with empty hand or random
  const finished = sim.players.find(p => p.hand.length === 0);
  if (finished) return finished.id;
  return sim.players[Math.floor(Math.random() * sim.players.length)].id;
}

function monteCarloEstimate(state: GameState, playerId: number, candidate: any, playouts = 30) {
  let wins = 0;
  for (let i = 0; i < playouts; i++) {
    const sim = fastCloneStateForSim(state);
    applyCandidateToSim(sim, playerId, candidate);
    const winner = simulateFastPlayout(sim, playerId, 200);
    if (winner === playerId) wins++;
  }
  return wins / playouts;
}

// -----------------------------
// Hard AI: hybrid heuristics + targeted rollouts
// -----------------------------
function isHighImpactCandidate(candidate: any, handSize: number) {
  if (candidate.type === 'play' && candidate.cards.length === 4) return true;
  if (candidate.type === 'play' && candidate.cards.length === handSize) return true;
  return false;
}

function getHardAIMove(state: GameState, playerId: number) {
  const player = state.players.find(p => p.id === playerId)!;
  const hand = player.hand;
  const pile = state.pile;
  const options = state.options;

  // 1v1 trap check (fast)
  const opponentInfo = estimateOpponentStrength(state, playerId);
  const isFirstMove = pile.length === 1 && pile[0].value === 9 && pile[0].suit === 'diamonds';
  if (opponentInfo.isOneVOne && isFirstMove) {
    const trapPlay = evaluateNineAceTrap(hand, pile, state, playerId);
    if (trapPlay.canPlay) {
      const remainingHand = hand.filter(c => !trapPlay.cards.some(tc => tc.id === c.id));
      const fourOfKindValue = hasFourOfSameValue(remainingHand);
      if (fourOfKindValue !== null && [10, 11, 12].includes(fourOfKindValue)) {
        return { type: 'play', cards: trapPlay.cards };
      }
    }
  }

  const candidates = generateCandidates(state, playerId);
  if (!candidates || candidates.length === 0) {
    const takeOpts = getTakeOptions(pile, options);
    if (takeOpts.canTakeAll) return returnTakeMove('takeAll');
    if (takeOpts.canTake3) return returnTakeMove('take3');
    return { type: 'endTurn', cards: [] };
  }

  const scored = candidates.map(c => ({ c, score: evaluateCandidate(state, playerId, c) }));
  scored.sort((a, b) => b.score - a.score);

  let bestMove = scored[0].c;
  let bestScore = scored[0].score;

  if (isHighImpactCandidate(bestMove, hand.length) && scored.length > 1) {
    const topEstimate = monteCarloEstimate(state, playerId, scored[0].c, 30);
    const secondEstimate = monteCarloEstimate(state, playerId, scored[1].c, 20);
    const topCombined = 0.6 * scored[0].score + 0.4 * (topEstimate * 50);
    const secondCombined = 0.6 * scored[1].score + 0.4 * (secondEstimate * 50);
    if (secondCombined > topCombined + 0.01) {
      bestMove = scored[1].c;
      bestScore = scored[1].score;
    } else {
      bestMove = scored[0].c;
      bestScore = scored[0].score;
    }
  }

  // Enforce rule: taking ends turn immediately
  if (bestMove.type === 'take') {
    return returnTakeMove(bestMove.takeType || 'take3');
  }

  // Return play; do not include any take after play
  return { type: 'play', cards: bestMove.cards };
}

// -----------------------------
// Medium AI: previous Hard logic (moved here) with rule fixes
// -----------------------------
function getMediumAIMove(state: GameState, playerId: number) {
  // This function contains the previous "hard" AI logic you provided,
  // moved to "medium" difficulty. It has been adjusted to:
  // - Return take moves immediately (taking ends turn)
  // - Never attempt to take after playing in same invocation
  const player = state.players.find(p => p.id === playerId)!;
  const hand = player.hand;
  const pile = state.pile;
  const options = state.options;
  const topCard = pile[pile.length - 1];
  const isFirstMove = pile.length === 1 && pile[0].suit === 'diamonds' && pile[0].value === 9;

  const opponentInfo = estimateOpponentStrength(state, playerId);

  // 1v1 trap (kept from previous logic)
  if (opponentInfo.isOneVOne && isFirstMove) {
    const trapPlay = evaluateNineAceTrap(hand, pile, state, playerId);
    if (trapPlay.canPlay) {
      const remainingHand = hand.filter(c => !trapPlay.cards.some(tc => tc.id === c.id));
      const fourOfKindValue = hasFourOfSameValue(remainingHand);
      if (fourOfKindValue !== null && [10, 11, 12].includes(fourOfKindValue)) {
        return { type: 'play', cards: trapPlay.cards };
      }
    }
  }

  const possiblePlays = getPossiblePlays(hand, pile, options);
  const takeOpts = getTakeOptions(pile, options);

  let bestMove: any = null;
  let bestScore = -Infinity;

  for (const playCards of possiblePlays) {
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

  // Evaluate take moves only if no good play exists or strategic
  const hasValidPlays = possiblePlays.length > 0;
  if (!hasValidPlays || takeOpts.canTakeAll) {
    const cardsToTake = pile.slice(-takeOpts.takeAllCount);
    const quadCheck = wouldCompleteQuad(hand, cardsToTake);
    if (quadCheck.wouldComplete) {
      const takeScore = evaluateTakeMove(takeOpts.takeAllCount, hand, pile, state, playerId);
      if (takeScore > bestScore) {
        bestScore = takeScore;
        bestMove = { type: 'take', cards: [], takeType: 'takeAll' };
      }
    }
  }

  if (!hasValidPlays && !bestMove) {
    if (takeOpts.canTakeAll) {
      const takeAllScore = evaluateTakeMove(takeOpts.takeAllCount, hand, pile, state, playerId);
      const take3Score = evaluateTakeMove(takeOpts.take3Count, hand, pile, state, playerId);
      if (takeAllScore > take3Score) bestMove = { type: 'take', cards: [], takeType: 'takeAll' };
      else bestMove = { type: 'take', cards: [], takeType: 'take3' };
    } else if (takeOpts.canTake3) {
      bestMove = { type: 'take', cards: [], takeType: 'take3' };
    }
  }

  if (!bestMove) {
    if (takeOpts.canTake3) bestMove = { type: 'take', cards: [], takeType: 'take3' };
    else bestMove = { type: 'endTurn', cards: [] };
  }

  // Enforce taking ends turn
  if (bestMove.type === 'take') return returnTakeMove(bestMove.takeType || 'take3');
  return bestMove;
}

// -----------------------------
// Evaluate taking move (used by medium)
// -----------------------------
function evaluateTakeMove(takeCount: number, hand: Card[], pile: Card[], state: GameState, playerId: number) {
  let score = SCORE_WEIGHTS.TAKING_CARDS_BASE_PENALTY;
  const cardsToTake = pile.slice(-takeCount);
  const opponentInfo = estimateOpponentStrength(state, playerId);
  const quadCheck = wouldCompleteQuad(hand, cardsToTake);
  if (quadCheck.wouldComplete) score += SCORE_WEIGHTS.TAKING_COMPLETES_QUAD_BONUS;
  if (wouldFixTriple(hand, cardsToTake)) score += SCORE_WEIGHTS.TAKING_USEFUL_CARDS_BONUS;
  if (wouldGetHighCards(cardsToTake)) score += SCORE_WEIGHTS.TAKING_HIGH_CARDS_BONUS;
  const myCardCount = hand.length;
  if (myCardCount < opponentInfo.avgOpponentCards - 2) score += SCORE_WEIGHTS.TAKING_WHEN_LEADING_PENALTY;
  if (opponentInfo.opponentCloseToWin) {
    if (quadCheck.wouldComplete) score += 30;
  }
  const currentHandScore = evaluateHandComposition(hand);
  const newHandScore = evaluateHandComposition([...hand, ...cardsToTake]);
  const handChange = newHandScore - currentHandScore;
  if (handChange > 20) score += handChange * 0.5;
  return score;
}

// -----------------------------
// Main AI entrypoint
// -----------------------------
export function getAIMove(state: GameState, playerId: number): {
  type: 'play' | 'take' | 'endTurn';
  cards: Card[];
  takeType?: 'take3' | 'takeAll';
} {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { type: 'endTurn', cards: [] };
  const options = state.options;
  const difficulty = options.aiDifficulty;

  if (difficulty === 'easy') return getEasyAIMove(player.hand, state.pile, options);
  if (difficulty === 'medium') return getMediumAIMove(state, playerId); // previous hard behavior
  return getHardAIMove(state, playerId); // new hard
}

// -----------------------------
// Easy AI (unchanged simple behavior)
// -----------------------------
function getEasyAIMove(hand: Card[], pile: Card[], options: GameOptions) {
  const topCard = pile[pile.length - 1];
  const isFirstMove = pile.length === 1 && pile[0].suit === 'diamonds' && pile[0].value === 9;
  if (isFirstMove) {
    const nines = hand.filter(c => c.value === 9);
    if (nines.length >= 3) return { type: 'play', cards: nines.slice(0, 3) };
    if (nines.length >= 1) return { type: 'play', cards: [nines[0]] };
  }
  const fourValue = hasFourOfSameValue(hand);
  if (fourValue !== null && fourValue >= topCard.value) {
    const fourCards = getCardsOfSameValue(hand, fourValue);
    return { type: 'play', cards: fourCards };
  }
  const validCards = hand.filter(c => c.value >= topCard.value);
  if (validCards.length > 0) {
    validCards.sort((a, b) => a.value - b.value);
    return { type: 'play', cards: [validCards[0]] };
  }
  const takeOpts = getTakeOptions(pile, options);
  return { type: 'take', cards: [], takeType: takeOpts.canTakeAll ? 'takeAll' : 'take3' };
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
  playerId: number
): { type: 'play' | 'endTurn'; cards: Card[] } {
  const topCard = pile[pile.length - 1];
  const isFirstMove = pile.length === 1 && pile[0].value === 9 && pile[0].suit === 'diamonds';
  const possiblePlays = getPossiblePlays(hand, pile, options);
  if (!possiblePlays || possiblePlays.length === 0) return { type: 'endTurn', cards: [] };

  let best: Card[] | null = null;
  let bestScore = -Infinity;
  for (const play of possiblePlays) {
    const validation = validatePlay(play, pile, isFirstMove, options);
    if (!validation.valid) continue;
    const score = evaluatePlayMove(play, hand, pile, state, playerId);
    if (score > bestScore) {
      bestScore = score;
      best = play;
    }
  }
  if (best && best.length > 0) return { type: 'play', cards: best };
  return { type: 'endTurn', cards: [] };
}
```

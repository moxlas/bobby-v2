import { Card, GameState, GameOptions, AIDifficulty, Player, PlayerMove } from '../../types/game';
import { HUMAN_MOVE_TRAINING, getDemonstratedHighPileTakeRate, getDemonstratedPickupAdjustment, getDemonstratedQuadBreakShare } from '../humanMoveTraining';
import { endTurn } from '../gameLogic';

// Read these smoothed rates from the compiled statistics directly so Hard AI
// remains build-compatible with training files generated before these helpers
// were exported from the training module.
export function getDemonstratedPickupRate(topValue: number): number {
  const topKey = String(topValue) as keyof typeof HUMAN_MOVE_TRAINING.pileTopChoices;
  const observations = HUMAN_MOVE_TRAINING.pileTopChoices[topKey];
  return observations ? (observations.takes + 2) / (observations.states + 8) : 0.25;
}

export function getDemonstratedQuadCompletionTakeRate(value: 13 | 14): number {
  const observations = HUMAN_MOVE_TRAINING.quadChoices.quadCompletionTakeStats[value];
  return (observations.takes + 1) / (observations.opportunities + 2);
}

// -----------------------------
// Utilities & Analysis
// -----------------------------
export function analyzePile(pile: Card[]) {
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

export function wouldCompleteQuad(hand: Card[], cardsToTake: Card[]) {
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

export function wouldGetHighCards(cardsToTake: Card[]) {
  return cardsToTake.some(c => c.value >= 13);
}

export function wouldFixTriple(hand: Card[], cardsToTake: Card[]) {
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

export function countHighCards(hand: Card[]) {
  let jacks = 0, queens = 0, kings = 0, aces = 0;
  for (const card of hand) {
    if (card.value === 11) jacks++;
    else if (card.value === 12) queens++;
    else if (card.value === 13) kings++;
    else if (card.value === 14) aces++;
  }
  return { jacks, queens, kings, aces, total: jacks + queens + kings + aces };
}

export function combination(n: number, k: number) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= Math.min(k, n - k); index++) {
    result = result * (n - index + 1) / index;
  }
  return result;
}

export function getTrainingMoveKey(candidate: any): string {
  if (candidate.type === 'play') {
    const values = candidate.cards.map((card: Card) => card.value).sort((a: number, b: number) => a - b);
    return `play:${values.length}:${values.join(',')}`;
  }
  if (candidate.type === 'take') return `take:${candidate.takeType ?? 'take3'}`;
  return 'endTurn';
}

export function getLastOpponentContext(state: GameState, playerId: number) {
  let lastOpponentAction = 0;
  let lastOpponentTop = 0;
  let historyIsComplete = state.moveHistory[0]?.turnNumber === 0;
  const historicalPile: Card[] = [];

  for (const move of state.moveHistory) {
    const topBeforeMove = historicalPile[historicalPile.length - 1]?.value ?? 0;
    if (move.playerId !== playerId) {
      lastOpponentAction = move.type === 'take' ? -1 : move.cards[0]?.value ?? 0;
      lastOpponentTop = historyIsComplete ? topBeforeMove : 0;
    }

    if (move.type === 'play') historicalPile.push(...move.cards);
    else historicalPile.splice(Math.max(0, historicalPile.length - move.cards.length), move.cards.length);
  }

  return { lastOpponentAction, lastOpponentTop };
}

// -----------------------------
// Rule enforcement helpers
// -----------------------------
export function returnTakeMove(takeType: 'take3' | 'takeAll') {
  return { type: 'take' as const, cards: [] as Card[], takeType };
}


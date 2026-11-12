import { Card, GameState, GameOptions, AIDifficulty, Player, PlayerMove } from '../../types/game';
import { OpponentCardTracker } from './types';
import { analyzePile, countHighCards, getDemonstratedPickupRate, getDemonstratedQuadCompletionTakeRate, wouldCompleteQuad, wouldFixTriple, wouldGetHighCards } from './utils';
import { buildOpponentCardTracker, estimateOpponentCardsAtRank, estimateOpponentStrength, probabilityAnyOpponentHasValue, probabilityOpponentCanAnswer, probabilityOpponentHasAtLeast } from './opponentModel';
import { getAIMoveCandidates } from './candidates';
import { SCORE_WEIGHTS } from './constants';
import { HUMAN_MOVE_TRAINING, getDemonstratedHighPileTakeRate, getDemonstratedPickupAdjustment, getDemonstratedQuadBreakShare } from '../humanMoveTraining';
import { hasFourOfSameValue } from '../deckUtils';
import { getNextPlayerIndex, getTakeOptions, validatePlay, endTurn } from '../gameLogic';

export function evaluateLowCardBlock(

  cardToPlay: Card,

  hand: Card[],

  pile: Card[],

  state: GameState,

  playerId: number,

  tracker: OpponentCardTracker,

) {

  const topValue = pile[pile.length - 1]?.value ?? 9;

  if (cardToPlay.value <= topValue) return 0;

  const playerIndex = state.players.findIndex(player => player.id === playerId);

  const nextPlayer = state.players[getNextPlayerIndex(playerIndex, state.players)];

  if (!nextPlayer || nextPlayer.hasFinished) return 0;

  // A mid-rank play can make several of the next player's cheapest answers

  // unusable at once. Count those blocked cards from public history, and use

  // a probability-weighted estimate when more than two players are active.

  let blockedCards = 0;

  for (let rank = Math.max(9, topValue); rank < cardToPlay.value; rank++) {

    const rankWeight = rank === 9 ? 1.2 : rank === 10 ? 1.15 : rank === 11 ? 1.05 : 1;

    blockedCards += estimateOpponentCardsAtRank(tracker, state, nextPlayer.id, rank) * rankWeight;

  }

  if (blockedCards <= 0) return 0;

  const hasLegalMidCard = hand.some(card => card.value >= topValue && card.value >= 11 && card.value <= 12);

  // Prefer Jacks and Queens to do the blocking. Kings and Aces receive less

  // credit when a mid card can deny the same low-card routes.

  const rankEfficiency = cardToPlay.value <= 12

    ? 1.1

    : cardToPlay.value === 13

      ? (hasLegalMidCard ? 0.55 : 0.82)

      : (hasLegalMidCard ? 0.32 : 0.62);

  const closeOpponentMultiplier = nextPlayer.hand.length <= 2 ? 1.25 : 1;

  const evenRaceMultiplier = Math.abs(hand.length - nextPlayer.hand.length) <= 2 ? 1.1 : 1;

  return Math.min(64, blockedCards * 20) * rankEfficiency * closeOpponentMultiplier * evenRaceMultiplier;

}

export function getHighCardBlockingPenalty(

  cardsToPlay: Card[],

  hand: Card[],

  pile: Card[],

  state: GameState,

  playerId: number,

  tracker: OpponentCardTracker,

) {

  if (cardsToPlay.length !== 1 || cardsToPlay.length === hand.length || cardsToPlay[0].value < 13) return 0;

  const topValue = pile[pile.length - 1]?.value ?? 9;

  const midAlternatives = hand.filter(card => card.value >= topValue && card.value >= 11 && card.value <= 12);

  if (midAlternatives.length === 0) return 0;

  const playerIndex = state.players.findIndex(player => player.id === playerId);

  const nextPlayer = state.players[getNextPlayerIndex(playerIndex, state.players)];

  if (!nextPlayer || nextPlayer.hasFinished) return 0;

  const bestMidBlock = Math.max(...midAlternatives.map(card =>

    evaluateLowCardBlock(card, hand, pile, state, playerId, tracker),

  ));

  if (bestMidBlock <= 0) return 0;

  const midValue = Math.max(...midAlternatives.map(card => card.value));

  const midAnswerProbability = probabilityOpponentCanAnswer(tracker, state, nextPlayer.id, midValue);

  const highAnswerProbability = probabilityOpponentCanAnswer(tracker, state, nextPlayer.id, cardsToPlay[0].value);

  const extraForceProbability = Math.max(0, midAnswerProbability - highAnswerProbability);

  // Charge for spending a King or Ace when a mid card blocks low answers just

  // as effectively. Waive that cost when the higher rank materially increases

  // the chance of forcing a pickup, especially against a near-finished player.

  const basePenalty = cardsToPlay[0].value === 14 ? 110 : 78;

  const handReserve = hand.length >= 7 ? 1.15 : 1;

  const urgencyDiscount = nextPlayer.hand.length <= 2 ? 0.55 : 1;

  return basePenalty * handReserve * urgencyDiscount * (1 - extraForceProbability);

}

// -----------------------------

// Play generation & evaluation

// -----------------------------

export function evaluateNineAceTrap(hand: Card[], pile: Card[], state: GameState, playerId: number) {

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

export function evaluatePlayMove(cardsToPlay: Card[], hand: Card[], pile: Card[], state: GameState, playerId: number) {

  let score = 0;

  const remainingHand = hand.filter(c => !cardsToPlay.find(pc => pc.id === c.id));

  const pileAnalysis = analyzePile(pile);

  const opponentInfo = estimateOpponentStrength(state, playerId);

  if (remainingHand.length === 0) return SCORE_WEIGHTS.WINNING_MOVE_BONUS;

  if (remainingHand.length <= 3) score += SCORE_WEIGHTS.CAN_FINISH_SOON_BONUS * (4 - remainingHand.length) / 3;

  score += evaluateHandComposition(remainingHand);

  const playValue = cardsToPlay[0].value;

  // A single card should not break up a four-of-a-kind while another legal

  // card can be played, unless a high single has real blocking value.

  if (cardsToPlay.length === 1 && hand.filter(card => card.value === playValue).length === 4) {

    score += getFourOfAKindBreakPenalty(

      playValue,

      pile,

      opponentInfo.opponentCloseToWin,

      hand,

      state.players.length === 2,

    );

  }

  const pileTopValue = pile[pile.length - 1]?.value ?? 9;

  const hasLowerLegalAnswer = hand.some(card => card.value >= pileTopValue && card.value < playValue);

  if (

    cardsToPlay.length === 1 &&

    playValue >= 13 &&

    pileTopValue <= 10 &&

    hasLowerLegalAnswer &&

    !opponentInfo.opponentCloseToWin

  ) {

    // Avoid spending a King or Ace on a low pile when a lower legal card can

    // answer it. A high card is justified here only to stop a close opponent.

    score -= 100;

  }

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

export function getFourOfAKindBreakPenalty(

  playValue: number,

  pile: Card[],

  opponentCloseToWin: boolean,

  hand: Card[],

  useDemonstrationStats: boolean,

) {

  const topValue = pile[pile.length - 1]?.value ?? 9;

  // In the combined expert data, 34 of 35 single-card quad breaks were on a

  // pile of 10 or higher. The one low-pile exception broke a King while

  // retaining a higher Ace quad, so allow that narrow structure too.

  if (topValue >= 10 && playValue >= 12 && playValue > topValue && playValue - topValue <= 3) {

    const breakSupport = useDemonstrationStats ? getDemonstratedQuadBreakShare(playValue) : 0.5;

    const basePenalty = Math.round(-140 + 90 * breakSupport);

    return opponentCloseToWin ? basePenalty + 40 : basePenalty;

  }

  const keepsHigherQuad = hand.some(card =>

    card.value > playValue && hand.filter(other => other.value === card.value).length === 4,

  );

  if (topValue <= 9 && playValue >= 13 && keepsHigherQuad) return opponentCloseToWin ? -40 : -125;

  if (topValue <= 9 && opponentCloseToWin && playValue >= 13) return -160;

  return -500;

}

export function evaluateHandComposition(hand: Card[]) {

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

export function evaluateForceOpponentTake(cardToPlay: Card, hand: Card[], pile: Card[], state: GameState, playerId: number) {

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

export function evaluateHighCardControl(

  cardsToPlay: Card[],

  hand: Card[],

  pile: Card[],

  state: GameState,

  playerId: number,

  tracker = buildOpponentCardTracker(state, playerId),

) {

  if (cardsToPlay.length === 0) return 0;

  const isHighSingle = cardsToPlay.length === 1 && cardsToPlay[0].value >= 13;

  const playedValue = cardsToPlay[0].value;

  const remainingHand = hand.filter(card => !cardsToPlay.some(played => played.id === card.id));

  if (remainingHand.length === 0) return 0;

  const topValue = pile[pile.length - 1]?.value ?? 9;

  const opponentInfo = estimateOpponentStrength(state, playerId);

  let score = 0;

  if (isHighSingle) {

    const highCardsBefore = hand.filter(card => card.value >= 13).length;

    const highCardsAfter = remainingHand.filter(card => card.value >= 13).length;

    const lowerLegalAlternative = hand.some(card => card.value >= topValue && card.value < playedValue);

    // In the combined expert data, every high single played with a lower legal

    // answer kept another King or Ace. Preserve the last control card unless

    // this is a necessary response or an urgent block.

    if (highCardsBefore === 1 && highCardsAfter === 0) {

      const reserveCost = lowerLegalAlternative

        ? (remainingHand.length <= 3 ? 135 : 110)

        : topValue >= 14 ? 22 : topValue >= 13 ? 38 : 72;

      score -= opponentInfo.opponentCloseToWin ? reserveCost * 0.3 : reserveCost;

    }

    // A high card can be worth spending when it strands the opponent and

    // leaves a playable final card after the likely pickup.

    const activeOpponents = state.players.filter(opponent => opponent.id !== playerId && !opponent.hasFinished);

    if (remainingHand.length === 1 && activeOpponents.length === 1) {

      const nextIndex = getNextPlayerIndex(state.players.findIndex(player => player.id === playerId), state.players);

      const nextPlayer = state.players[nextIndex];

      const forceProbability = nextPlayer

        ? 1 - probabilityOpponentCanAnswer(tracker, state, nextPlayer.id, playedValue)

        : 0;

      const pileAfterPlay = [...pile, ...cardsToPlay];

      const takeOptions = getTakeOptions(pileAfterPlay, state.options);

      const canPlayAfterTake = (takeCount: number) => {

        const remainingPile = pileAfterPlay.slice(0, Math.max(1, pileAfterPlay.length - takeCount));

        const newTop = remainingPile[remainingPile.length - 1]?.value ?? 0;

        return remainingHand[0].value >= newTop;

      };

      if (takeOptions.canTake3 && canPlayAfterTake(takeOptions.take3Count)) {

        score += 185 * forceProbability * (takeOptions.canTakeAll ? 0.96 : 1);

      }

      if (takeOptions.canTakeAll && canPlayAfterTake(takeOptions.takeAllCount)) {

        score += 185 * forceProbability * (takeOptions.canTake3 ? 0.04 : 1);

      }

      const likelyTakeCount = takeOptions.canTake3 ? takeOptions.take3Count : takeOptions.takeAllCount;

      const highCardsOffered = pileAfterPlay.slice(-likelyTakeCount).filter(card => card.value >= 13).length;

      const finalCardEscape = takeOptions.canTake3 && canPlayAfterTake(takeOptions.take3Count) && forceProbability >= 0.6;

      if (!finalCardEscape) score -= 38 * forceProbability * highCardsOffered;

      if (nextPlayer && remainingHand[0].value < playedValue) score -= 120 * (1 - forceProbability);

    }

  }

  // Price all likely pickups that would transfer K/A cards, including cards

  // already near the top of the pile. A K/A offered with three known or likely

  // matching cards receives an extra completion penalty, larger for Aces.

  if (remainingHand.length > 1 && state.players.length === 2) {

    const validation = validatePlay(

      cardsToPlay,

      pile,

      pile.length === 1 && pile[0].value === 9 && pile[0].suit === 'diamonds',

      state.options,

    );

    if (!validation.valid || validation.continueTurn) return score;

    const playerIndex = state.players.findIndex(player => player.id === playerId);

    const nextIndex = getNextPlayerIndex(playerIndex, state.players);

    const nextPlayer = state.players[nextIndex];

    const pileAfterPlay = [...pile, ...cardsToPlay];

    const nextTopValue = pileAfterPlay[pileAfterPlay.length - 1]?.value ?? 9;

    const takeOptions = getTakeOptions(pileAfterPlay, state.options);

    const takeCount = takeOptions.canTake3 ? takeOptions.take3Count : takeOptions.takeAllCount;

    const offeredCards = pileAfterPlay.slice(-takeCount);

    const highCardExposure = offeredCards.reduce((total, card) =>

      total + (card.value === 14 ? 1.35 : card.value === 13 ? 1 : 0), 0);

    if (nextPlayer && highCardExposure > 0) {

      const forcedTakeProbability = 1 - probabilityOpponentCanAnswer(tracker, state, nextPlayer.id, nextTopValue);

      const demonstratedTakeRate = state.options.specialNinesRule &&

        state.options.allowTakeAllCards && state.options.fourOfAKindRule

        ? getDemonstratedPickupRate(nextTopValue)

        : 0;

      const pickupProbability = Math.max(forcedTakeProbability, demonstratedTakeRate);

      const blockingMultiplier = opponentInfo.opponentCloseToWin ? 0.5 : 1;

      const ownPlayer = state.players.find(player => player.id === playerId);

      const earlyGameMultiplier = ownPlayer && ownPlayer.hand.length >= 8 && nextPlayer.hand.length >= 8 ? 1.75 : 1;

      score -= 38 * pickupProbability * highCardExposure * blockingMultiplier * earlyGameMultiplier;

      if (state.options.fourOfAKindRule) {

        const offeredByValue = new Map<number, number>();

        for (const card of offeredCards) {

          if (card.value >= 13) offeredByValue.set(card.value, (offeredByValue.get(card.value) ?? 0) + 1);

        }

        for (const [value, offeredCount] of offeredByValue) {

          const missingCards = Math.max(1, 4 - offeredCount);

          const completionProbability = probabilityOpponentHasAtLeast(

            tracker,

            state,

            nextPlayer.id,

            value,

            missingCards,

          );

          const learnedCompletionTakeRate = state.options.specialNinesRule &&

            state.options.allowTakeAllCards && state.options.fourOfAKindRule

            ? getDemonstratedQuadCompletionTakeRate(value as 13 | 14)

            : 0.5;

          const aceMultiplier = value === 14 ? 1.25 : 1;

          score -= 320 * completionProbability * learnedCompletionTakeRate * aceMultiplier * earlyGameMultiplier;

        }

      }

    }

  }

  return score;

}

export function shouldPlayFourAces(hand: Card[], pile: Card[], state: GameState, playerId: number) {

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

// Candidate evaluation (Hard AI)

// -----------------------------

export function evaluateCandidate(
  state: GameState,
  playerId: number,
  candidate: any,
  tracker = buildOpponentCardTracker(state, playerId),
) {

  if (candidate.type === 'endTurn') return -10;

  const player = state.players.find(p => p.id === playerId)!;

  const hand = player.hand;

  const pile = state.pile;

  const topValue = pile[pile.length - 1].value;

  const opponentInfo = estimateOpponentStrength(state, playerId);

  const deltaHand = candidate.type === 'play' ? candidate.cards.length : 0;

  let score = 0;

  if (candidate.type === 'take') {

    const takeOptions = getTakeOptions(pile, state.options);

    const takeCount = candidate.takeType === 'takeAll' ? takeOptions.takeAllCount : takeOptions.take3Count;

    const cardsToTake = pile.slice(-takeCount);

    if (state.players.length === 2) score += getDemonstratedPickupAdjustment(topValue);

    // Taking adds cards, but can be useful when it improves hand structure or

    // creates a four of a kind that can be shed on a later turn.

    score -= takeCount * 18;

    score += (evaluateHandComposition([...hand, ...cardsToTake]) - evaluateHandComposition(hand)) * 1.1;

    const handCounts = new Map<number, number>();

    for (const card of hand) handCounts.set(card.value, (handCounts.get(card.value) ?? 0) + 1);

    for (const card of cardsToTake) {

      if (card.value >= topValue && (handCounts.get(card.value) ?? 0) === 3) {

        score += 120;

        handCounts.set(card.value, 4);

      } else if (card.value >= topValue) {

        score += 4;

      }

    }

    // Human evaluations repeatedly preferred taking cards over spending a

    // King or Ace when those were the only cards that could answer the pile.

    // Preserve those top answers when there is still a multi-card hand to play.

    const legalAnswers = hand.filter(card => card.value >= topValue);

    if (state.players.length === 2 && hand.length > 1 && legalAnswers.length > 0 && legalAnswers.every(card => card.value >= 13)) {

      const demonstratedTakeRate = getDemonstratedHighPileTakeRate(topValue === 14 ? 14 : 13);

      score += Math.round(30 + 85 * demonstratedTakeRate);

      score += Math.min(15, Math.max(0, legalAnswers.length - 1) * 5);

      if (candidate.takeType === 'takeAll' && takeCount >= 8) score += 20;

    }

    if (opponentInfo.opponentCloseToWin && cardsToTake.some(card => card.value >= topValue)) score += 12;

    return score;

  }

  // Getting rid of cards matters, but keeping flexible high cards matters too.

  score += 18 * deltaHand;

  const myCards = hand.length;

  const endgame = myCards <= 4 || opponentInfo.opponentCloseToWin;

  if (endgame) score += 20;

  if (candidate.type === 'play') {

    score += evaluateHighCardControl(candidate.cards, hand, pile, state, playerId, tracker);

    if (candidate.cards.length === hand.length) score += SCORE_WEIGHTS.WINNING_MOVE_BONUS;

    for (const c of candidate.cards) {

      // A higher card is more flexible later, so its cost rises with rank.

      const preservationCost = Math.pow(c.value - 9, 1.35) * 4;

      score -= preservationCost + (c.value === 14 ? 12 : c.value === 13 ? 6 : 0);

    }

    // Prefer the lowest card that still makes the next player spend a higher

    // card or pick up. This avoids wasting an Ace when a King does the job.

    const playedValue = candidate.cards[0].value;

    // Human demonstrations often spend one of a triple of tens on a nine,

    // keeping the pair while making the next answer harder than a nine.

    if (candidate.cards.length === 1 && topValue === 9 && playedValue === 10) {

      const tensInHand = hand.filter(card => card.value === 10).length;

      if (tensInHand >= 3) score += 20;

      else if (tensInHand === 2) score += 10;

    }

    if (candidate.cards.length === 1) {

      score += evaluateLowCardBlock(candidate.cards[0], hand, pile, state, playerId, tracker);

      const higherRankCounts = new Map<number, number>();

      for (const card of hand) {

        if (card.value > playedValue) higherRankCounts.set(card.value, (higherRankCounts.get(card.value) ?? 0) + 1);

      }

      // Prefer a higher card from a pair or triple when an opponent is likely

      // holding one of our lower ranks. The higher play makes that rank illegal

      // and can stop the opponent from shedding or completing a same-rank set.

      for (const lowerValue of new Set(hand.filter(card => card.value + 1 === playedValue).map(card => card.value))) {

        const heldHigherCount = hand.filter(card => card.value === playedValue).length;

        if (heldHigherCount < 2 || heldHigherCount === 4) continue;

        const opponentMatchProbability = probabilityAnyOpponentHasValue(tracker, state, playerId, lowerValue);

        const rankPairBlockBonus = heldHigherCount >= 3 ? 42 : 22;

        score += rankPairBlockBonus * opponentMatchProbability;

      }

      // Conversely, avoid spending a low card when we hold a pair or triple

      // above it and an opponent may be waiting to play that same low rank.

      for (const [higherValue, heldCount] of higherRankCounts) {

        if (higherValue !== playedValue + 1 || heldCount < 2 || heldCount === 4) continue;

        const opponentMatchProbability = probabilityAnyOpponentHasValue(tracker, state, playerId, playedValue);

        const lowCardRiskPenalty = heldCount >= 3 ? 48 : 26;

        score -= lowCardRiskPenalty * opponentMatchProbability;

      }

    }

    const nextIdx = getNextPlayerIndex(state.players.findIndex(p => p.id === playerId), state.players);

    const nextPlayer = state.players[nextIdx];

    if (nextPlayer && !nextPlayer.hasFinished) {

      const nextHandSize = nextPlayer.hand.length;

      const forceProbability = 1 - probabilityOpponentCanAnswer(tracker, state, nextPlayer.id, playedValue);

      if (nextHandSize <= 1) score += 55 * forceProbability;

      else if (nextHandSize <= 2) score += 35 * forceProbability;

      else if (nextHandSize <= 3) score += 25 * forceProbability;

      else score += 18 * forceProbability;

      // Hard leans more strongly on tracked unseen cards when the next player

      // is close to finishing; an unanswered high play can force a pickup.

      if (nextHandSize <= 2) {

        score += (nextHandSize === 1 ? 160 : 100) * forceProbability;

      }

      // Retaining multiple high cards gives options on later turns.

      score += Math.min(3, hand.filter(c => c.value >= 12).length) * (playedValue >= 13 ? 4 : 0);

    }

  }

  if (candidate.type === 'play' && candidate.cards.length === 4) {

    const remainingAfterQuad = hand.filter(card => !candidate.cards.some(played => played.id === card.id));

    if (remainingAfterQuad.every(card => card.value >= candidate.cards[0].value)) {

      // Spending the quad clears the lowest cards remaining in hand.

      score += 150;

    } else {

      // The shared gate permits this only when the next opponent is close to

      // finishing and is unlikely to have a card that answers the raised rank.

      const nextIdx = getNextPlayerIndex(state.players.findIndex(p => p.id === playerId), state.players);

      const nextPlayer = state.players[nextIdx];

      const blockProbability = nextPlayer

        ? 1 - probabilityOpponentCanAnswer(tracker, state, nextPlayer.id, candidate.cards[0].value)

        : 0;

      score += 55 + 90 * blockProbability;

    }

    if (candidate.cards[0].value === 14) score += 10;

  }

  const nextIdx = getNextPlayerIndex(state.players.findIndex(p => p.id === playerId), state.players);

  const nextPlayer = state.players[nextIdx];

  const newTop = candidate.type === 'play' ? candidate.cards[candidate.cards.length - 1].value : pile[pile.length - 1].value;

  const probNextCanPlay = nextPlayer

    ? probabilityOpponentCanAnswer(tracker, state, nextPlayer.id, newTop)

    : 0;

  const forceProb = 1 - probNextCanPlay;

  // Reward plays that public-card tracking predicts will make the next player

  // spend a higher card or pick up, including before their endgame.

  score += 45 * forceProb;

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

  const enableProb = nextPlayer

    ? probabilityOpponentCanAnswer(tracker, state, nextPlayer.id, newTop + 1)

    : 0;

  score -= 8 * enableProb;

  return score;

}

export function getSearchHandStrength(hand: Card[]): number {

  let score = -hand.length * 90;

  const counts = new Map<number, number>();

  const earlyGame = hand.length >= 7;

  for (const card of hand) {

    counts.set(card.value, (counts.get(card.value) ?? 0) + 1);

    // Keep enough value on Kings and Aces that the search spends a Jack or

    // Queen to block low cards first. Their reserve value falls in the endgame.

    score += (card.value - 9) * 3;

    if (card.value === 13) score += earlyGame ? 34 : 18;

    if (card.value === 14) score += earlyGame ? 46 : 25;

  }

  for (const count of counts.values()) {

    if (count >= 2) score += 3;

    if (count >= 3) score += 9;

    if (count === 4) score += 14;

  }

  return score;

}

export function getSearchBlockedCardValue(hand: Card[], pileTop: number): number {

  return hand.reduce((score, card) => {

    if (card.value >= pileTop) return score;

    const blockedValue = card.value === 9 ? 8 : card.value === 10 ? 7 : card.value === 11 ? 6 : card.value === 12 ? 4 : 2;

    return score + blockedValue;

  }, 0);

}

export function evaluateSearchPosition(state: GameState, rootPlayerId: number): number {

  const root = state.players.find(player => player.id === rootPlayerId);

  if (!root) return -100000;

  const rootStrength = getSearchHandStrength(root.hand);

  const opponents = state.players.filter(player => player.id !== rootPlayerId && !player.hasFinished);

  const strongestOpponent = Math.max(-100000, ...opponents.map(opponent => getSearchHandStrength(opponent.hand)));

  let score = rootStrength - strongestOpponent;

  // Raising the pile can deny an opponent several of their cheapest cards at

  // once. Preserve that tempo value in the search leaves, while charging the

  // root a smaller cost for its own low cards becoming temporarily stranded.

  // The asymmetry reflects the race: making the next opponent spend a higher

  // answer can be worth carrying a low card until the pile drops again.

  if (opponents.length > 0) {

    const pileTop = state.pile[state.pile.length - 1]?.value ?? 9;

    const rootIndex = state.players.findIndex(player => player.id === rootPlayerId);

    const nextOpponent = state.players[getNextPlayerIndex(rootIndex, state.players)];

    const nextOpponentBlocked = nextOpponent && !nextOpponent.hasFinished

      ? getSearchBlockedCardValue(nextOpponent.hand, pileTop)

      : 0;

    const ownBlockedCards = getSearchBlockedCardValue(root.hand, pileTop);

    score += nextOpponentBlocked * 7 - ownBlockedCards * 3;

  }

  // Leaving an opponent with one or two cards creates a concrete near-term

  // threat; retaining a similar lead for the AI is correspondingly valuable.

  if (root.hand.length <= 2) score += (3 - root.hand.length) * 35;

  for (const opponent of opponents) {

    if (opponent.hand.length <= 2) score -= (3 - opponent.hand.length) * 35;

  }

  const current = state.players[state.currentPlayerIndex];

  if (current && !current.hasFinished) {

    const canPlay = getAIMoveCandidates(state, current.id, state.canContinueTurn)

      .some(candidate => candidate.type === 'play');

    if (current.id === rootPlayerId) score += canPlay ? 10 : -10;

    else score += canPlay ? -10 : 10;

  }

  return score;

}

export function evaluateTakeMove(takeCount: number, hand: Card[], pile: Card[], state: GameState, playerId: number) {

  let score = SCORE_WEIGHTS.TAKING_CARDS_BASE_PENALTY - takeCount * 12;

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

  score += handChange * 0.75;

  return score;

}


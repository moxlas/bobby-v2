import { Card, GameState, Player, PlayerMove, GameOptions, PlayError, DEFAULT_OPTIONS } from '../types/game';
import { createDeck, shuffleDeck, cutDeck, dealCards, findNineOfDiamonds, hasFourOfSameValue, sortHand } from './deckUtils';

export interface PlayerSetup {
  name: string;
  isAI: boolean;
}

export function initializeGame(playerSetups: PlayerSetup[], options: GameOptions = DEFAULT_OPTIONS): GameState {
  const deck = cutDeck(shuffleDeck(createDeck()));
  const hands = dealCards(deck, playerSetups.length);

  const players: Player[] = playerSetups.map((setup, index) => ({
    id: index,
    name: setup.name,
    hand: hands[index],
    isCurrentTurn: false,
    isConnected: true,
    isAI: setup.isAI,
    hasFinished: false,
    finishPosition: null,
    finishTime: null,
  }));

  let startingPlayerIndex = 0;
  for (let i = 0; i < players.length; i++) {
    if (findNineOfDiamonds(players[i].hand)) {
      startingPlayerIndex = i;
      break;
    }
  }

  const nineOfDiamonds = findNineOfDiamonds(players[startingPlayerIndex].hand)!;
  players[startingPlayerIndex].hand = players[startingPlayerIndex].hand.filter(c => c.id !== nineOfDiamonds.id);

  // 4-nines special rule: if starting player has all 4 nines, they continue
  const nineCount = players[startingPlayerIndex].hand.filter(c => c.value === 9).length;
  const canContinueWithFourNines = options.specialNinesRule && nineCount === 3;

  let currentPlayerIndex = startingPlayerIndex;
  if (!canContinueWithFourNines) {
    currentPlayerIndex = getNextPlayerIndex(startingPlayerIndex, players);
  }

  players.forEach((p, i) => {
    p.isCurrentTurn = i === currentPlayerIndex;
  });

  return {
    phase: 'playing',
    players,
    currentPlayerIndex,
    pile: [{ ...nineOfDiamonds, faceUp: true }],
    deck: [],
    direction: 'clockwise',
    finishOrder: [],
    loser: null,
    moveHistory: [{
      id: '0',
      type: 'play',
      playerId: startingPlayerIndex,
      playerName: players[startingPlayerIndex].name,
      cards: [{ ...nineOfDiamonds, faceUp: true }],
      timestamp: Date.now(),
      turnNumber: 0
    }],
    gameStartTime: Date.now(),
    pausedTime: null,
    totalPausedTime: 0,
    turnNumber: 1,
    options,
    canContinueTurn: canContinueWithFourNines,
    aiOnlyStartTurn: null,
  };
}

export function getNextPlayerIndex(currentIndex: number, players: Player[]): number {
  let nextIndex = (currentIndex + 1) % players.length;
  let attempts = 0;

  while (players[nextIndex].hasFinished && attempts < players.length) {
    nextIndex = (nextIndex + 1) % players.length;
    attempts++;
  }

  return nextIndex;
}

/**
 * Canonical order for a multi-card play: same-value groups ascend, matching the
 * order the cards land on the pile. Selection order therefore never matters.
 */
export function orderCardsForPlay(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.value - b.value);
}

export function validatePlay(cards: Card[], pile: Card[], isFirstMove: boolean, options: GameOptions): { valid: boolean; error?: PlayError; continueTurn?: boolean } {
  if (cards.length === 0) {
    return { valid: false, error: 'selectCards' };
  }

  if (new Set(cards.map(card => card.id)).size !== cards.length) {
    return { valid: false, error: 'duplicateCards' };
  }

  let topCard = pile[pile.length - 1];
  if (!topCard) {
    return { valid: false, error: 'noPile' };
  }

  const orderedCards = orderCardsForPlay(cards);
  const startsOnNineOfDiamonds = isFirstMove && pile.length === 1 &&
    pile[0].suit === 'diamonds' && pile[0].value === 9;
  let index = 0;
  let finalGroupContinuesTurn = false;

  // The selected cards are reordered into same-value groups, ascending by value.
  // Validate each consecutive group against the updated top card.
  while (index < orderedCards.length) {
    let groupEnd = index + 1;
    while (groupEnd < orderedCards.length && orderedCards[groupEnd].value === orderedCards[index].value) {
      groupEnd++;
    }

    const group = orderedCards.slice(index, groupEnd);
    const value = group[0].value;
    const isOpeningNineGroup = startsOnNineOfDiamonds && index === 0 && value === 9;
    let groupContinuesTurn = false;

    if (isOpeningNineGroup && group.length > 1 && !options.specialNinesRule) {
      return { valid: false, error: 'specialNinesOff' };
    }

    if (isOpeningNineGroup && group.length === 2) {
      return { valid: false, error: 'ninesOnDiamonds' };
    }

    if (value === 9 && topCard.value === 9 && group.length > 1 && !isOpeningNineGroup) {
      return { valid: false, error: 'nineOnNine' };
    }

    if (group.length === 2 || group.length === 3) {
      if (isOpeningNineGroup && group.length === 3 && options.specialNinesRule) {
        groupContinuesTurn = true;
      } else {
        return { valid: false, error: 'groupSize' };
      }
    } else if (group.length === 4) {
      if (isOpeningNineGroup && value === 9 && !options.specialNinesRule) {
        return { valid: false, error: 'specialNinesOff' };
      }
      if (value < topCard.value) {
        return { valid: false, error: 'valueTooLow' };
      }
      groupContinuesTurn = isOpeningNineGroup && value === 9
        ? true
        : options.fourOfAKindRule;
    } else if (value < topCard.value) {
      return { valid: false, error: 'valueTooLow' };
    }

    topCard = group[group.length - 1];
    finalGroupContinuesTurn = groupContinuesTurn;
    index = groupEnd;
  }

  return { valid: true, continueTurn: finalGroupContinuesTurn };
}

export function canContinueAfterPlay(hand: Card[], pile: Card[]): boolean {
  if (hand.length === 0) return false;

  const topCard = pile[pile.length - 1];
  const hasValidCard = hand.some(c => c.value >= topCard.value);
  const fourOfKindValue = hasFourOfSameValue(hand);

  return hasValidCard || fourOfKindValue !== null;
}

function checkAIOnlyLoop(
  state: GameState,
  players: Player[],
  turnNumber: number,
  pile: Card[],
  moveHistory: PlayerMove[],
  finishOrder: Player[],
  elapsedTime: number,
): GameState | null {
  const remainingActive = players.filter(p => !p.hasFinished);
  const allAI = remainingActive.length > 0 && remainingActive.every(p => p.isAI);
  let aiOnlyStartTurn = state.aiOnlyStartTurn;
  if (allAI && aiOnlyStartTurn === null) {
    aiOnlyStartTurn = turnNumber;
  }

  if (allAI && aiOnlyStartTurn !== null && turnNumber - aiOnlyStartTurn > 200) {
    const newFinishOrder = [...finishOrder];
    const finalPlayers = players.map(p => {
      if (p.hasFinished) return { ...p };
      const pos = newFinishOrder.length + 1;
      const finished = { ...p, hasFinished: true, finishPosition: pos, finishTime: elapsedTime };
      newFinishOrder.push(finished);
      return finished;
    });
    return {
      ...state,
      players: finalPlayers,
      pile: [...pile],
      phase: 'finished' as const,
      moveHistory: [...moveHistory],
      finishOrder: newFinishOrder,
      loser: finalPlayers[finalPlayers.length - 1],
      canContinueTurn: false,
      aiOnlyStartTurn,
    };
  }

  return null;
}

export function playCards(state: GameState, playerId: number, cards: Card[], continueTurn: boolean = false): GameState {
  const newPlayers = state.players.map(p => ({ ...p, hand: [...p.hand] }));
  const player = newPlayers[playerId];

  if (cards.length === 0) {
    const nextIndex = getNextPlayerIndex(state.currentPlayerIndex, newPlayers);
    newPlayers.forEach((p, i) => { p.isCurrentTurn = i === nextIndex; });

    const newTurnNumber = state.turnNumber + 1;
    const elapsedTime = state.gameStartTime
      ? (Date.now() - state.gameStartTime) / 1000 - state.totalPausedTime
      : 0;
    const finishOrder = [...state.finishOrder];
    const aiResult = checkAIOnlyLoop(state, newPlayers, newTurnNumber, state.pile, state.moveHistory, finishOrder, elapsedTime);
    if (aiResult) return aiResult;

    return {
      ...state,
      players: newPlayers,
      currentPlayerIndex: nextIndex,
      turnNumber: newTurnNumber,
      canContinueTurn: false,
    };
  }

  // Same-value groups always land on the pile in ascending order, regardless
  // of the order the caller passed the cards in.
  const orderedCards = orderCardsForPlay(cards);
  player.hand = sortHand(player.hand.filter(c => !orderedCards.find(pc => pc.id === c.id)));
  const newPile = [...state.pile, ...orderedCards.map(c => ({ ...c, faceUp: true }))];

  const elapsedTime = state.gameStartTime
    ? (Date.now() - state.gameStartTime) / 1000 - state.totalPausedTime
    : 0;

  const move: PlayerMove = {
    id: `move-${Date.now()}-${Math.random()}`,
    playerId,
    playerName: player.name,
    type: 'play',
    cards: orderedCards.map(c => ({ ...c })),
    timestamp: Date.now(),
    turnNumber: state.turnNumber,
  };
  const newMoveHistory = [...state.moveHistory, move];

  if (player.hand.length === 0) {
    player.hasFinished = true;
    player.finishPosition = state.finishOrder.length + 1;
    player.finishTime = elapsedTime;

    const newFinishOrder = [...state.finishOrder, { ...player }];
    const activePlayers = newPlayers.filter(p => !p.hasFinished);

    if (activePlayers.length === 1) {
      const loser = { ...activePlayers[0], hasFinished: true, finishPosition: newPlayers.length, finishTime: elapsedTime };
      const loserIdx = newPlayers.findIndex(p => p.id === loser.id);
      newPlayers[loserIdx] = loser;

      return {
        ...state,
        phase: 'finished',
        players: newPlayers,
        pile: newPile,
        finishOrder: [...newFinishOrder, loser],
        loser,
        moveHistory: newMoveHistory,
        canContinueTurn: false,
      };
    }

    const nextIndex = getNextPlayerIndex(state.currentPlayerIndex, newPlayers);
    newPlayers.forEach((p, i) => { p.isCurrentTurn = i === nextIndex; });
    const newTurnNumber = state.turnNumber + 1;

    const aiResult = checkAIOnlyLoop(state, newPlayers, newTurnNumber, newPile, newMoveHistory, newFinishOrder, elapsedTime);
    if (aiResult) return aiResult;

    return {
      ...state,
      players: newPlayers,
      pile: newPile,
      finishOrder: newFinishOrder,
      currentPlayerIndex: nextIndex,
      moveHistory: newMoveHistory,
      turnNumber: newTurnNumber,
      canContinueTurn: false,
    };
  }

  if (continueTurn) {
    return {
      ...state,
      players: newPlayers,
      pile: newPile,
      moveHistory: newMoveHistory,
      canContinueTurn: true,
    };
  }

  const nextIndex = getNextPlayerIndex(state.currentPlayerIndex, newPlayers);
  newPlayers.forEach((p, i) => { p.isCurrentTurn = i === nextIndex; });
  const newTurnNumber = state.turnNumber + 1;

  const finishOrder = [...state.finishOrder];
  const aiResult = checkAIOnlyLoop(state, newPlayers, newTurnNumber, newPile, newMoveHistory, finishOrder, elapsedTime);
  if (aiResult) return aiResult;

  return {
    ...state,
    players: newPlayers,
    pile: newPile,
    currentPlayerIndex: nextIndex,
    moveHistory: newMoveHistory,
    turnNumber: newTurnNumber,
    canContinueTurn: false,
  };
}

export function endTurn(state: GameState): GameState {
  const newPlayers = state.players.map(p => ({ ...p }));
  const nextIndex = getNextPlayerIndex(state.currentPlayerIndex, newPlayers);
  newPlayers.forEach((p, i) => { p.isCurrentTurn = i === nextIndex; });
  const newTurnNumber = state.turnNumber + 1;

  const elapsedTime = state.gameStartTime
    ? (Date.now() - state.gameStartTime) / 1000 - state.totalPausedTime
    : 0;
  const finishOrder = [...state.finishOrder];
  const aiResult = checkAIOnlyLoop(state, newPlayers, newTurnNumber, state.pile, state.moveHistory, finishOrder, elapsedTime);
  if (aiResult) return aiResult;

  return {
    ...state,
    players: newPlayers,
    currentPlayerIndex: nextIndex,
    turnNumber: newTurnNumber,
    canContinueTurn: false,
  };
}

export function takeCards(state: GameState, playerId: number, count: number): GameState {
  const newPlayers = state.players.map(p => ({ ...p, hand: [...p.hand] }));
  const player = newPlayers[playerId];
  const newPile = [...state.pile];

  const cardsToTake = newPile.splice(-count, count);
  player.hand = sortHand([...player.hand, ...cardsToTake]);

  const move: PlayerMove = {
    id: `move-${Date.now()}-${Math.random()}`,
    playerId,
    playerName: player.name,
    type: 'take',
    cards: cardsToTake.map(c => ({ ...c })),
    timestamp: Date.now(),
    turnNumber: state.turnNumber,
  };
  const newMoveHistory = [...state.moveHistory, move];

  const nextIndex = getNextPlayerIndex(state.currentPlayerIndex, newPlayers);
  newPlayers.forEach((p, i) => { p.isCurrentTurn = i === nextIndex; });
  const newTurnNumber = state.turnNumber + 1;

  const elapsedTime = state.gameStartTime
    ? (Date.now() - state.gameStartTime) / 1000 - state.totalPausedTime
    : 0;
  const finishOrder = [...state.finishOrder];
  const aiResult = checkAIOnlyLoop(state, newPlayers, newTurnNumber, newPile, newMoveHistory, finishOrder, elapsedTime);
  if (aiResult) return aiResult;

  return {
    ...state,
    players: newPlayers,
    pile: newPile,
    currentPlayerIndex: nextIndex,
    moveHistory: newMoveHistory,
    turnNumber: newTurnNumber,
    canContinueTurn: false,
  };
}

export function getTakeOptions(pile: Card[], options: GameOptions): { canTake3: boolean; canTakeAll: boolean; take3Count: number; takeAllCount: number } {
  const availableCards = pile.length - 1;

  return {
    canTake3: availableCards >= 1,
    canTakeAll: options.allowTakeAllCards && availableCards > 0,
    take3Count: Math.min(3, availableCards),
    takeAllCount: availableCards,
  };
}

export function pauseGame(state: GameState): GameState {
  if (state.phase !== 'playing') return state;
  return { ...state, phase: 'paused', pausedTime: Date.now() };
}

export function resumeGame(state: GameState): GameState {
  if (state.phase !== 'paused' || state.pausedTime === null) return state;
  const pauseDuration = (Date.now() - state.pausedTime) / 1000;
  return { ...state, phase: 'playing', pausedTime: null, totalPausedTime: state.totalPausedTime + pauseDuration };
}

export function getValidMoves(hand: Card[], pile: Card[]): { canPlay: boolean; canTake: boolean } {
  if (pile.length === 0) return { canPlay: true, canTake: false };

  const topCard = pile[pile.length - 1];
  const hasValidCard = hand.some(c => c.value >= topCard.value);
  const fourOfKindValue = hasFourOfSameValue(hand);

  return {
    canPlay: hasValidCard || fourOfKindValue !== null,
    canTake: pile.length > 1,
  };
}

import { useState, useEffect, useRef, useCallback, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from '../lib/i18n';
import { Card as CardType, GameOptions, PlayerMove } from '../types/game';
import { PlayerHand } from './PlayerHand';
import { Card as PlayingCard } from './Card';
import { GamePile } from './GamePile';
import { ConfirmPopup } from './ConfirmPopup';
import { TakeOptionsPopup } from './TakeOptionsPopup';
import { CardFlight, type CardFlightRequest } from './CardFlight';
import { validatePlay, getTakeOptions, getValidMoves } from '../utils/gameLogic';
import { getAIMove, getAIDelay } from '../utils/aiLogic';
import { animateShake } from '../lib/animations';
import {
  initAudio, setMuted, isMuted,
  playCardSound, playCardSelectSound, playCardPickupSound, playTakeSound, playComboSound,
  playWinSound, playLoseSound, playYourTurnSound, playClickSound,
} from '../utils/sounds';
import { ArrowRight, Clock, RotateCcw, Home, AlertCircle, Pause, Play, Zap, History, ChevronDown, ChevronUp, Crown, Skull, Volume2, VolumeX, X } from 'lucide-react';

interface GameBoardProps {
  gameState: any;
  onPlayCards: (playerId: number, cards: CardType[], continueTurn: boolean) => void;
  onTakeCards: (playerId: number, count: number) => void;
  onEndTurn: () => void;
  onPauseGame: () => void;
  onResumeGame: () => void;
  onForfeitPlayer: (playerId: number) => void;
  onFinishGame: () => void;
  onRestartGame: () => void;
  onNewGame: () => void;
}

interface CardPointerGesture {
  card: CardType;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function getCardDisplayName(card: CardType): string {
  const valueStr = card.value === 11 ? 'J' : card.value === 12 ? 'Q' : card.value === 13 ? 'K' : card.value === 14 ? 'A' : card.value.toString();
  const suitEmoji = card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠';
  return `${valueStr}${suitEmoji}`;
}

/** First visible element matching `selector` (each hand card exists in both layouts). */
function visibleElement(selector: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    if (element.getClientRects().length === 0) continue;
    return element;
  }
  return null;
}

function visibleRect(selector: string): DOMRect | null {
  return visibleElement(selector)?.getBoundingClientRect() ?? null;
}

function pileFlightTarget(): DOMRect | null {
  return visibleRect('[data-pile-top]') ?? visibleRect('[data-pile-drop-zone]');
}

/** Visible hand cards and the hand dock they sit in. */
function visibleHandCards(): { rects: DOMRect[]; dock: DOMRect | null } {
  const dock = visibleElement('[data-hand-drop-zone]');
  if (!dock) return { rects: [], dock: null };
  const rects = Array.from(dock.querySelectorAll<HTMLElement>('[data-card-id]'))
    .filter(element => element.getClientRects().length > 0)
    .map(element => element.getBoundingClientRect());
  return { rects, dock: dock.getBoundingClientRect() };
}

/**
 * Random start rects inside the visible hand band.
 *
 * Not tied to the real card slot on purpose: the starting point must not reveal
 * whether the played card sat at the low or high end of the sorted hand.
 */
function randomizedHandRects(count: number): DOMRect[] {
  const { rects, dock } = visibleHandCards();
  if (!dock) return [];

  const width = rects[0]?.width ?? 48;
  const height = rects[0]?.height ?? 67;
  const left = rects.length ? Math.min(...rects.map(rect => rect.left)) : dock.left;
  const right = rects.length ? Math.max(...rects.map(rect => rect.right)) : dock.right;
  const top = rects.length ? Math.min(...rects.map(rect => rect.top)) : dock.top + (dock.height - height) / 2;
  const bottom = rects.length ? Math.max(...rects.map(rect => rect.bottom)) : top + height;

  const minX = Math.max(left, 0);
  const maxX = Math.max(minX, Math.min(right, window.innerWidth) - width);
  const minY = Math.max(top, 0);
  const maxY = Math.max(minY, Math.min(bottom, window.innerHeight) - height);

  return Array.from({ length: count }, () => new DOMRect(
    minX + Math.random() * (maxX - minX),
    minY + Math.random() * (maxY - minY),
    width,
    height,
  ));
}

/** Landing spot at the left end of the hand, used when cards are picked up. */
function handLeftTarget(): DOMRect | null {
  const { rects, dock } = visibleHandCards();
  if (!dock) return null;
  if (rects.length === 0) return new DOMRect(dock.left + 8, dock.top + (dock.height - 67) / 2, 48, 67);

  return new DOMRect(
    Math.min(...rects.map(rect => rect.left)),
    Math.min(...rects.map(rect => rect.top)),
    rects[0].width,
    rects[0].height,
  );
}

export function GameBoard({
  gameState,
  onPlayCards,
  onTakeCards,
  onEndTurn,
  onPauseGame,
  onResumeGame,
  onRestartGame,
  onNewGame
}: GameBoardProps) {
  const { t, tPlural } = useTranslation();
  const [selectedCards, setSelectedCards] = useState<CardType[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingAction, setPendingAction] = useState<'play' | 'take3' | 'takeAll' | 'endTurn' | null>(null);
  const [pendingNavigationAction, setPendingNavigationAction] = useState<'newGame' | 'restartGame' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorSequence, setErrorSequence] = useState(0);
  const [flight, setFlight] = useState<CardFlightRequest | null>(null);
  const [isAIThinking, setIsAIThinking] = useState(false);
  const [showTakeOptions, setShowTakeOptions] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showHistory, setShowHistory] = useState(true);
  const [showMobileHistory, setShowMobileHistory] = useState(false);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [dragPreviewPosition, setDragPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  const [mutedState, setMutedState] = useState(() => isMuted());
  const historyContainerRef = useRef<HTMLDivElement>(null);
  const errorBannerRef = useRef<HTMLDivElement>(null);
  const mobileErrorBannerRef = useRef<HTMLDivElement>(null);
  const flightSequenceRef = useRef(0);
  const prevPlayerIndexRef = useRef<number | null>(null);
  const finishSoundPlayedRef = useRef(false);
  const cardPointerGestureRef = useRef<CardPointerGesture | null>(null);
  const cardGestureSoundPlayedRef = useRef(false);
  const suppressGestureClickRef = useRef(false);

  /** Set or clear the error banner; a new message bumps the sequence to re-trigger the shake. */
  const showError = (message: string | null) => {
    setError(message);
    if (message) setErrorSequence((sequence) => sequence + 1);
  };

  /** Fly ghost cards between the hand and the pile (or back) while the real state updates. */
  const launchCardFlight = useCallback(
    (cards: CardType[], direction: 'toPile' | 'toHand', faceUp = true) => {
      if (cards.length === 0) return;
      const to = direction === 'toPile' ? pileFlightTarget() : handLeftTarget();
      if (!to) return;

      const pileRect = direction === 'toHand' ? pileFlightTarget() : null;
      const from = direction === 'toPile'
        ? randomizedHandRects(cards.length)
        : cards.map(() => pileRect).filter((rect): rect is DOMRect => rect !== null);
      if (from.length === 0) return;

      flightSequenceRef.current += 1;
      setFlight({ id: flightSequenceRef.current, direction, cards, from, to, faceUp });
    },
    [],
  );

  const suppressGestureClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onPlayCardsRef = useRef(onPlayCards);
  const onTakeCardsRef = useRef(onTakeCards);
  const onEndTurnRef = useRef(onEndTurn);
  const gameStateRef = useRef(gameState);

  useEffect(() => {
    onPlayCardsRef.current = onPlayCards;
    onTakeCardsRef.current = onTakeCards;
    onEndTurnRef.current = onEndTurn;
    gameStateRef.current = gameState;
  });

  // Init audio context on mount
  useEffect(() => { initAudio(); }, []);

  // Your turn sound
  useEffect(() => {
    if (gameState.phase !== 'playing') return;
    const cur = gameState.players[gameState.currentPlayerIndex];
    if (!cur) return;
    if (prevPlayerIndexRef.current === null) {
      prevPlayerIndexRef.current = gameState.currentPlayerIndex;
      return;
    }
    if (prevPlayerIndexRef.current !== gameState.currentPlayerIndex) {
      prevPlayerIndexRef.current = gameState.currentPlayerIndex;
      if (!cur.isAI && !cur.hasFinished) {
        playYourTurnSound();
      }
    }
  }, [gameState.currentPlayerIndex, gameState.phase]);

  // Win / lose sound on game end
  useEffect(() => {
    if (gameState.phase === 'finished' && !finishSoundPlayedRef.current) {
      finishSoundPlayedRef.current = true;
      const human = gameState.players.find((p: any) => !p.isAI);
      if (!human) return;
      const totalPlayers = gameState.players.length;
      if (human.finishPosition === 1) {
        playWinSound();
      } else if (human.finishPosition === totalPlayers) {
        playLoseSound();
      } else {
        playWinSound();
      }
    }
    if (gameState.phase === 'playing') {
      finishSoundPlayedRef.current = false;
    }
  }, [gameState.phase]);

  useEffect(() => {
    if (showHistory && historyContainerRef.current) {
      historyContainerRef.current.scrollTop = 0;
    }
  }, [gameState.moveHistory, showHistory]);

  useEffect(() => {
    if (!showMobileHistory) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMobileHistory(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showMobileHistory]);

  useEffect(() => {
    if (gameState.phase === 'playing') {
      const interval = setInterval(() => {
        if (gameStateRef.current.gameStartTime) {
          const elapsed = (Date.now() - gameStateRef.current.gameStartTime) / 1000 - gameStateRef.current.totalPausedTime;
          setElapsedTime(elapsed);
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [gameState.phase]);

  useEffect(() => {
    if (gameState.phase === 'paused' && gameState.gameStartTime) {
      const elapsed = (gameState.pausedTime! - gameState.gameStartTime) / 1000 - gameState.totalPausedTime;
      setElapsedTime(elapsed);
    }
  }, [gameState.phase, gameState.gameStartTime, gameState.pausedTime, gameState.totalPausedTime]);

  useEffect(() => {
    const shouldReset = !gameState.canContinueTurn;
    if (shouldReset) {
      setSelectedCards([]);
      setShowConfirm(false);
      setPendingAction(null);
      showError(null);
      setShowTakeOptions(false);
      cardPointerGestureRef.current = null;
      setDraggingCardId(null);
      setDragPreviewPosition(null);
    }
  }, [gameState.currentPlayerIndex]);

  useEffect(() => {
    if (gameState.canContinueTurn) {
      setSelectedCards([]);
      showError(null);
    }
  }, [gameState.canContinueTurn]);

  useEffect(() => {
    if (!error) return;
    animateShake(errorBannerRef.current);
    animateShake(mobileErrorBannerRef.current);
  }, [error, errorSequence]);

  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const humanPlayers = gameState.players.filter((p: any) => !p.isAI);
  const allHumanPlayersFinished = humanPlayers.length > 0 && humanPlayers.every((p: any) => p.hasFinished);

  const isHumanTurn = currentPlayer && !currentPlayer.isAI && !currentPlayer.hasFinished && gameState.phase === 'playing';
  const isPlayerTurn = currentPlayer && !currentPlayer.hasFinished;
  const handCardsFaceUp = currentPlayer && (!currentPlayer.isAI || allHumanPlayersFinished);
  const pile = gameState.pile;
  const pileTopCard = pile[pile.length - 1];
  const options: GameOptions = gameState.options;

  const isFirstMove = pile.length === 1 && pile[0].suit === 'diamonds' && pile[0].value === 9;
  const takeOptions = getTakeOptions(pile, options);
  const validMoves = isPlayerTurn ? getValidMoves(currentPlayer.hand, pile) : { canPlay: false, canTake: false };

  const isFourNinesStart = gameState.canContinueTurn &&
    isFirstMove &&
    currentPlayer.hand.filter((c: CardType) => c.value === 9).length === 3;

  useEffect(() => {
    if (gameState.phase !== 'playing') {
      return;
    }

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    if (!currentPlayer || !currentPlayer.isAI || currentPlayer.id === 'human') {
      return;
    }

    if (currentPlayer.hasFinished) {
      const timeout = setTimeout(() => {
        const state = gameStateRef.current;
        if (state.phase !== 'playing') return;

        const activePlayers = state.players.filter((p: any) => !p.hasFinished);
        if (activePlayers.length <= 1) {
          return;
        }

        onPlayCardsRef.current(currentPlayer.id, [], false);
      }, 300);
      return () => clearTimeout(timeout);
    }

    setIsAIThinking(true);

    const executeAITurn = () => {
      const state = gameStateRef.current;
      if (state.phase !== 'playing') {
        setIsAIThinking(false);
        return;
      }

      const player = state.players[state.currentPlayerIndex];

      if (!player || !player.isAI || player.hasFinished) {
        setIsAIThinking(false);
        return;
      }

      const aiMove = getAIMove(state, player.id);

      if (aiMove.type === 'endTurn') {
        onEndTurnRef.current();
      } else if (aiMove.type === 'play' && aiMove.cards.length > 0) {
        const pile = state.pile;
        const isFirstMove = pile.length === 1 && pile[0].suit === 'diamonds' && pile[0].value === 9;
        const validation = validatePlay(aiMove.cards, pile, isFirstMove, state.options);

        if (validation.valid) {
          playCardSound(aiMove.cards.length);
          if (validation.continueTurn) playComboSound();
          launchCardFlight(aiMove.cards, 'toPile', false);
          onPlayCardsRef.current(player.id, aiMove.cards, validation.continueTurn || false);
        } else {
          const takeOpts = getTakeOptions(pile, state.options);
          const count = takeOpts.canTake3 ? takeOpts.take3Count : takeOpts.takeAllCount;
          if (count > 0) {
            playTakeSound();
            launchCardFlight(state.pile.slice(-count), 'toHand');
            onTakeCardsRef.current(player.id, count);
          } else {
            onPlayCardsRef.current(player.id, [], false);
          }
        }
      } else if (aiMove.type === 'take') {
        const takeOpts = getTakeOptions(state.pile, state.options);
        const count = aiMove.takeType === 'takeAll'
          ? takeOpts.takeAllCount
          : takeOpts.take3Count;

        if (count > 0) {
          playTakeSound();
          launchCardFlight(state.pile.slice(-count), 'toHand');
          onTakeCardsRef.current(player.id, count);
        } else {
          onPlayCardsRef.current(player.id, [], false);
        }
      } else {
        onPlayCardsRef.current(player.id, [], false);
      }

      setIsAIThinking(false);
    };

    const delay = getAIDelay(gameState.options.aiDifficulty);
    const timeout = setTimeout(executeAITurn, delay);

    return () => {
      clearTimeout(timeout);
      setIsAIThinking(false);
    };
  }, [gameState.currentPlayerIndex, gameState.phase, gameState.players, gameState.canContinueTurn, launchCardFlight]);

  const handleCardSelect = (card: CardType) => {
    if (!isHumanTurn) return;

    const isSelected = selectedCards.find(c => c.id === card.id);
    playCardSelectSound(!isSelected);
    if (isSelected) {
      setSelectedCards(selectedCards.filter(c => c.id !== card.id));
    } else {
      setSelectedCards([...selectedCards, card]);
    }
    showError(null);
  };

  const handleCardPointerDown = (card: CardType, event: ReactPointerEvent<HTMLElement>) => {
    if (!isHumanTurn || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;

    cardPointerGestureRef.current = {
      card,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
    };
    cardGestureSoundPlayedRef.current = false;
    setDragPreviewPosition(null);
  };

  const handleCardPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = cardPointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const isMouseDrag = gesture.pointerType === 'mouse' && Math.hypot(deltaX, deltaY) > 8;
    const isTouchSwipeUp = gesture.pointerType !== 'mouse' && deltaY < -8 && Math.abs(deltaY) > Math.abs(deltaX) * 0.8;

    if (isMouseDrag || isTouchSwipeUp) {
      if (!cardGestureSoundPlayedRef.current) {
        playCardPickupSound();
        cardGestureSoundPlayedRef.current = true;
      }
      setDraggingCardId(gesture.card.id);
      setDragPreviewPosition({ x: event.clientX, y: event.clientY });
    }
  };

  const handleCardPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = cardPointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    cardPointerGestureRef.current = null;
    setDraggingCardId(null);
    setDragPreviewPosition(null);

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const movedDistance = Math.hypot(deltaX, deltaY);
    const releasedOverPile = Boolean(document.elementFromPoint(event.clientX, event.clientY)
      ?.closest('[data-pile-drop-zone]'));
    const isTouchSwipeUp = gesture.pointerType !== 'mouse' && deltaY < -42 && Math.abs(deltaY) > Math.abs(deltaX) * 1.1;
    const isMouseDropOnPile = gesture.pointerType === 'mouse' && releasedOverPile && movedDistance > 10;

    if (!isTouchSwipeUp && !isMouseDropOnPile) return;

    if (!cardGestureSoundPlayedRef.current) {
      playCardPickupSound();
      cardGestureSoundPlayedRef.current = true;
    }

    suppressGestureClickRef.current = true;
    if (suppressGestureClickTimerRef.current) clearTimeout(suppressGestureClickTimerRef.current);
    suppressGestureClickTimerRef.current = setTimeout(() => {
      suppressGestureClickRef.current = false;
      suppressGestureClickTimerRef.current = null;
    }, 500);

    const cardsToPlay = selectedCards.some(selected => selected.id === gesture.card.id)
      ? selectedCards
      : [gesture.card];
    setSelectedCards(cardsToPlay);
    const validation = validatePlay(cardsToPlay, pile, isFirstMove, options);
    if (!validation.valid) {
      showError(validation.error ?? 'invalidMove');
      return;
    }

    showError(null);
    if (options.skipConfirmations && applyPlay(cardsToPlay)) return;
    setPendingAction('play');
    setShowConfirm(true);
  };

  const handleCardPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (cardPointerGestureRef.current?.pointerId !== event.pointerId) return;
    cardPointerGestureRef.current = null;
    setDraggingCardId(null);
    setDragPreviewPosition(null);
  };

  const handleGestureClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressGestureClickRef.current) return;
    suppressGestureClickRef.current = false;
    if (suppressGestureClickTimerRef.current) clearTimeout(suppressGestureClickTimerRef.current);
    suppressGestureClickTimerRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  };

  /** Commit a play: validate, animate the cards, and hand the move to the game. */
  const applyPlay = (cards: CardType[]) => {
    const validation = validatePlay(cards, pile, isFirstMove, options);
    if (!validation.valid) {
      showError(validation.error ?? 'invalidMove');
      return false;
    }
    playCardSound(cards.length);
    if (validation.continueTurn) playComboSound();
    launchCardFlight(cards, 'toPile');
    onPlayCards(currentPlayer.id, cards, validation.continueTurn || false);
    setSelectedCards([]);
    return true;
  };

  /** Commit a pickup after the 3/all choice has been made. */
  const applyTake = (action: 'take3' | 'takeAll') => {
    const count = action === 'take3' ? takeOptions.take3Count : takeOptions.takeAllCount;
    playTakeSound();
    launchCardFlight(pile.slice(-count), 'toHand');
    onTakeCards(currentPlayer.id, count);
  };

  const handlePlayClick = () => {
    playClickSound();
    if (selectedCards.length === 0) {
      showError('selectCards');
      return;
    }

    const validation = validatePlay(selectedCards, pile, isFirstMove, options);
    if (!validation.valid) {
      showError(validation.error ?? 'invalidMove');
      return;
    }

    showError(null);
    if (options.skipConfirmations) {
      applyPlay(selectedCards);
      return;
    }
    setPendingAction('play');
    setShowConfirm(true);
  };

  const handleTakeClick = () => {
    playClickSound();
    showError(null);
    if (takeOptions.canTake3 && takeOptions.canTakeAll) {
      setShowTakeOptions(true);
    } else if (takeOptions.canTakeAll) {
      if (options.skipConfirmations) {
        applyTake('takeAll');
      } else {
        setPendingAction('takeAll');
        setShowConfirm(true);
      }
    } else if (options.skipConfirmations) {
      applyTake('take3');
    } else {
      setPendingAction('take3');
      setShowConfirm(true);
    }
  };

  const handleTake3 = () => {
    playClickSound();
    showError(null);
    setShowTakeOptions(false);
    if (options.skipConfirmations) {
      applyTake('take3');
      return;
    }
    setPendingAction('take3');
    setShowConfirm(true);
  };

  const handleTakeAll = () => {
    playClickSound();
    showError(null);
    setShowTakeOptions(false);
    if (options.skipConfirmations) {
      applyTake('takeAll');
      return;
    }
    setPendingAction('takeAll');
    setShowConfirm(true);
  };

  const handleEndTurnClick = () => {
    playClickSound();
    showError(null);
    setPendingAction('endTurn');
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    if (pendingAction === 'play') {
      if (!applyPlay(selectedCards)) {
        setShowConfirm(false);
        setPendingAction(null);
        return;
      }
    } else if (pendingAction === 'take3') {
      applyTake('take3');
    } else if (pendingAction === 'takeAll') {
      applyTake('takeAll');
    } else if (pendingAction === 'endTurn') {
      playClickSound();
      onEndTurn();
    }

    setShowConfirm(false);
    setPendingAction(null);
    setSelectedCards([]);
  };

  const handleCancel = () => {
    playClickSound();
    setShowConfirm(false);
    setPendingAction(null);
    setShowTakeOptions(false);
  };

  const requestNewGame = () => {
    playClickSound();
    setPendingNavigationAction('newGame');
  };
  const requestRestartGame = () => {
    playClickSound();
    setPendingNavigationAction('restartGame');
  };

  const handlePauseClick = () => {
    playClickSound();
    onPauseGame();
  };

  const handleResumeClick = () => {
    playClickSound();
    onResumeGame();
  };

  const handleNavigationConfirm = () => {
    const action = pendingNavigationAction;
    setPendingNavigationAction(null);
    if (action === 'newGame') onNewGame();
    if (action === 'restartGame') onRestartGame();
  };

  const navigationConfirmDialog = pendingNavigationAction && (
    <ConfirmPopup
      titleKey="confirmPopup.areYouSure"
      message={pendingNavigationAction === 'restartGame' ? t('game.restartGame.confirm') : t('confirmPopup.newGame')}
      onConfirm={handleNavigationConfirm}
      onCancel={() => setPendingNavigationAction(null)}
    />
  );

  const moveHistoryEntries = gameState.moveHistory.length === 0 ? (
    <p className="text-emerald-400 text-xs italic text-center py-4">{t('game.history.noMoves')}</p>
  ) : (
    gameState.moveHistory.slice().reverse().map((move: PlayerMove) => (
      <div
        key={move.id}
        className={`text-xs p-2 rounded ${move.type === 'play' ? 'bg-emerald-700/50' : 'bg-amber-900/30'}`}
      >
        <div className="flex items-center justify-between mb-0.5">
          <span className={`font-medium ${move.type === 'play' ? 'text-amber-300' : 'text-emerald-300'}`}>
            {move.playerName}
          </span>
          <span className="text-emerald-500 text-[10px]">T{move.turnNumber}</span>
        </div>
        <div className="text-emerald-200 truncate">
          {move.type === 'play' ? (
            <span className="flex items-center gap-1">
              <span className="text-emerald-400">→</span>
              {move.cards.map(c => getCardDisplayName(c)).join(' ')}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <span className="text-amber-400">↑</span>
              {t('game.history.took', { count: move.cards.length })}
            </span>
          )}
        </div>
      </div>
    ))
  );

  const getConfirmMessage = () => {
    if (pendingAction === 'play') {
      const cardNames = selectedCards
        .map(c => t('card.format', { value: t(`card.value.${c.value}`), suit: t(`card.suit.${c.suit}`) }))
        .join(', ');
      return t('game.confirm.playCards', { cards: cardNames });
    } else if (pendingAction === 'take3') {
      return tPlural('game.confirm.takeCards', takeOptions.take3Count);
    } else if (pendingAction === 'takeAll') {
      return tPlural('game.confirm.takeAll', takeOptions.takeAllCount);
    } else if (pendingAction === 'endTurn') {
      return t('game.confirm.endTurn');
    }
    return '';
  };

  if (gameState.phase === 'finished') {
    return (
      <div className="min-h-screen bg-emerald-900 flex items-center justify-center p-4">
        <div className="bg-emerald-800 rounded-2xl p-6 sm:p-8 max-w-md w-full text-center shadow-2xl border border-emerald-600">
          <h2 className="text-2xl sm:text-3xl font-bold text-amber-300 mb-2">{t('game.finished.title')}</h2>

          <div className="flex items-center justify-center gap-2 mb-4 sm:mb-6">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-300" />
            <span className="text-emerald-200 text-base sm:text-lg">{t('game.finished.totalTime', { time: formatTime(elapsedTime) })}</span>
          </div>

          <div className="space-y-2 sm:space-y-3 mb-6 sm:mb-8">
            <h3 className="text-sm sm:text-base text-emerald-200 font-semibold">{t('game.finished.rankings')}</h3>
            {gameState.finishOrder.map((player: any, index: number) => (
              <div
                key={player.id}
                className={`flex items-center justify-between p-2 sm:p-3 rounded-lg text-sm ${
                  index === 0 ? 'bg-amber-500 text-emerald-900' :
                  index === gameState.finishOrder.length - 1 ? 'bg-red-500 text-white' :
                  'bg-emerald-600 text-white'
                }`}
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="font-medium">
                    {index + 1}. {player.name}
                  </span>
                  {index === gameState.finishOrder.length - 1 && (
                    <span className="text-xs font-bold flex items-center gap-1"><Skull className="w-3 h-3" /> {t('game.finished.loser')}</span>
                  )}
                  {index === 0 && (
                    <span className="text-xs font-bold flex items-center gap-1"><Crown className="w-3 h-3" /> {t('game.finished.winner')}</span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs sm:text-sm">
                  <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span>{formatTime(player.finishTime || 0)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => {
                playClickSound();
                onRestartGame();
              }}
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-emerald-900 font-bold text-sm sm:text-base py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {t('game.finished.playAgain')}
            </button>
            <button
              onClick={requestNewGame}
              className="flex-1 bg-emerald-600 border border-emerald-400 text-white hover:bg-emerald-500 text-sm sm:text-base py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Home className="w-4 h-4" />
              {t('game.finished.newGame')}
            </button>
          </div>
        </div>
        {navigationConfirmDialog}
      </div>
    );
  }

  if (gameState.phase === 'paused') {
    return (
      <div className="min-h-screen bg-emerald-900 flex items-center justify-center p-4">
        <div className="bg-emerald-800 rounded-2xl p-6 sm:p-8 max-w-md w-full text-center shadow-2xl border border-emerald-600">
          <div className="flex items-center justify-center gap-2 sm:gap-3 mb-4 sm:mb-6">
            <Pause className="w-6 h-6 sm:w-8 sm:h-8 text-amber-300" />
            <h2 className="text-2xl sm:text-3xl font-bold text-amber-300">{t('game.paused.title')}</h2>
          </div>

          <div className="flex items-center justify-center gap-2 mb-6 sm:mb-8">
            <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-300" />
            <span className="text-emerald-200 text-xl sm:text-2xl font-mono">{formatTime(elapsedTime)}</span>
          </div>

          <div className="space-y-3 sm:space-y-4">
            <button
              onClick={handleResumeClick}
              className="w-full bg-amber-500 hover:bg-amber-600 text-emerald-900 font-bold text-base sm:text-lg py-4 sm:py-6 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Play className="w-4 h-4 sm:w-5 sm:h-5" />
              {t('game.paused.resume')}
            </button>

            <button
              type="button"
              aria-pressed={!mutedState}
              aria-label={t(mutedState ? 'game.topBar.unmute' : 'game.topBar.mute')}
              onClick={() => {
                const next = !mutedState;
                setMutedState(next);
                setMuted(next);
              }}
              className="w-full bg-emerald-700 border border-emerald-500 text-emerald-100 hover:bg-emerald-600 text-sm sm:text-base py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {mutedState ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              {t(mutedState ? 'game.topBar.unmute' : 'game.topBar.mute')}
            </button>

            <button
              onClick={requestRestartGame}
              className="w-full bg-emerald-600 border border-emerald-400 text-white hover:bg-emerald-500 text-sm sm:text-base py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {t('game.paused.restartGame')}
            </button>

            <button
              onClick={requestNewGame}
              className="w-full bg-emerald-600 border border-emerald-400 text-white hover:bg-emerald-500 text-sm sm:text-base py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Home className="w-4 h-4" />
              {t('game.paused.newGame')}
            </button>
          </div>
        </div>
        {navigationConfirmDialog}
      </div>
    );
  }

  const shouldShowHand = currentPlayer && !currentPlayer.hasFinished;
  const draggedCards = draggingCardId && currentPlayer
    ? selectedCards.some(card => card.id === draggingCardId)
      ? selectedCards
      : currentPlayer.hand.filter((card: CardType) => card.id === draggingCardId)
    : [];

  const canTakeCards = validMoves.canTake && !gameState.canContinueTurn;

  return (
    <div
      className="h-[100dvh] min-h-0 overflow-hidden bg-emerald-900 flex flex-col pb-[max(env(safe-area-inset-bottom),3.5rem)] lg:pb-0"
      onPointerMove={handleCardPointerMove}
      onPointerUp={handleCardPointerUp}
      onPointerCancel={handleCardPointerCancel}
      onClickCapture={handleGestureClickCapture}
    >
      {/* Top bar */}
      <div className="bg-emerald-800 border-b border-emerald-600 px-2 sm:px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2 sm:py-3 flex-shrink-0">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 sm:gap-4">
            <h1 className="text-base sm:text-xl font-bold text-amber-300">{t('game.topBar.title')}</h1>
            <span className="text-emerald-300 text-xs hidden sm:inline">
              {t('game.topBar.turn', { turn: gameState.turnNumber })}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3">
            <div className="flex items-center gap-1.5 sm:gap-2 bg-emerald-700 px-2 sm:px-4 py-2 rounded-lg">
              <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-amber-300" />
              <span className="text-white font-mono text-sm sm:text-lg">{formatTime(elapsedTime)}</span>
            </div>

            <button
              onClick={handlePauseClick}
              className="bg-emerald-700 border border-emerald-500 text-emerald-100 hover:bg-emerald-600 hidden lg:flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
            >
              <Pause className="w-4 h-4" />
              {t('game.topBar.pause')}
            </button>

            <button
              onClick={requestNewGame}
              aria-label={t('game.topBar.newGame')}
              className="bg-emerald-700 border border-emerald-500 text-emerald-100 hover:bg-emerald-600 flex items-center gap-2 px-2.5 sm:px-3 py-2 rounded-lg text-sm transition-colors"
            >
              <Home className="w-4 h-4" />
              <span className="hidden lg:inline">{t('game.topBar.newGame')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main game area */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2 sm:gap-4 px-2 pt-2 pb-2 sm:p-4 max-w-screen-2xl mx-auto w-full overflow-hidden">
        {/* Mobile: compact player seats above the table */}
        <div className="lg:hidden flex flex-shrink-0 flex-wrap justify-center gap-1.5 rounded-lg bg-emerald-800/70 p-1.5">
          {gameState.players.map((player: any) => {
            const isCurrent = player.id === currentPlayer?.id;
            return (
              <div
                key={player.id}
                className={`flex min-w-[88px] max-w-[112px] flex-1 basis-24 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${
                  isCurrent
                    ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                    : 'border-emerald-600 bg-emerald-700/50 text-emerald-100'
                } ${player.hasFinished ? 'opacity-60' : ''}`}
              >
                <span className="min-w-0 truncate font-medium">{player.name}</span>
                {player.isAI && <span className="flex-shrink-0 rounded bg-emerald-900/70 px-1 text-[9px] font-bold text-emerald-300">{t('game.sidebar.ai')}</span>}
                <span className="flex-shrink-0 text-emerald-300">{player.hasFinished ? `#${player.finishPosition}` : player.hand.length}</span>
              </div>
            );
          })}
        </div>

        {/* Left sidebar - Players (Desktop) */}
        <div className="hidden lg:flex lg:w-40 flex-col gap-2 overflow-y-auto flex-shrink-0">
          <div className="text-emerald-300 text-xs font-medium uppercase tracking-wide mb-1 px-1">{t('game.sidebar.players')}</div>
          {gameState.players.map((player: any) => {
            const isCurrent = player.id === currentPlayer?.id;

            return (
              <div
                key={player.id}
                className={`flex-shrink-0 rounded-lg p-2 border transition-all ${
                  isCurrent
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-emerald-600 bg-emerald-800/50'
                } ${player.hasFinished ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    player.hasFinished ? 'bg-gray-500' : isCurrent ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className={`text-sm font-medium truncate ${isCurrent ? 'text-amber-300' : 'text-white'}`}>
                        {player.name}
                      </span>
                      {player.isAI && <span className="text-[10px] text-emerald-400">{t('game.sidebar.ai')}</span>}
                    </div>
                    <div className="text-xs text-emerald-400">
                      {player.hasFinished ? (
                        <span className="text-amber-400 flex items-center gap-1">
                          {player.finishPosition === 1 ? <Crown className="w-3 h-3" /> :
                           player.finishPosition === gameState.players.length ? <Skull className="w-3 h-3" /> : null}
                          #{player.finishPosition}
                        </span>
                      ) : (
                        `${player.hand.length} ${tPlural('game.sidebar.cards', player.hand.length)}`
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Center - Pile and actions */}
        <div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] place-items-center overflow-hidden rounded-xl bg-emerald-800/20 px-2 py-2 sm:px-4 lg:gap-2 lg:py-4">
          <div className="hidden text-center self-end lg:block">
            <div className="flex items-center gap-1 sm:gap-2 justify-center mb-0">
              <span className="text-emerald-300 text-xs sm:text-sm">{t('game.center.currentTurn')}</span>
              <span className="text-amber-300 font-bold text-sm sm:text-lg">{currentPlayer?.name}</span>
              {currentPlayer?.isAI && <span className="text-[10px] sm:text-xs text-emerald-400">({t('game.sidebar.ai')})</span>}
              {isAIThinking && <span className="text-amber-400 text-xs sm:text-sm animate-pulse">{t('game.center.thinking')}</span>}
            </div>
          </div>

          <div data-pile-drop-zone="true" className="flex min-h-0 items-center justify-center lg:row-start-2">
            <GamePile
              pile={pile}
              onTakeClick={isHumanTurn && canTakeCards && !showTakeOptions ? handleTakeClick : undefined}
            />
          </div>

          <div className="hidden row-start-3 self-start w-full max-w-sm flex-col items-center gap-3 sm:gap-4 lg:flex">
          {error && (
            <div ref={errorBannerRef} className="flex items-center gap-2 bg-red-500 text-white px-3 sm:px-4 py-2 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4" />
              {t(`game.error.${error}`)}
            </div>
          )}

          {/* Continue turn banner - 4 Nines Start */}
          {gameState.canContinueTurn && isHumanTurn && isFourNinesStart && (
            <div className="bg-purple-600 rounded-lg p-4 sm:p-4 border-2 border-purple-400 shadow-lg w-full">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🃏</span>
                <span className="text-white font-bold text-base sm:text-lg">{t('game.ninesStart.title')}</span>
              </div>
              <p className="text-purple-100 text-xs sm:text-sm mb-4 sm:mb-3">
                {t('game.ninesStart.text')}
              </p>
              <div className="flex gap-4 sm:gap-3">
                <button
                  onClick={handlePlayClick}
                  disabled={selectedCards.length === 0}
                  className="bg-white hover:bg-gray-100 text-purple-700 font-bold text-xs sm:text-sm px-4 py-3 sm:py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {t('game.ninesStart.playSelected', { count: selectedCards.length })}
                </button>
                <button
                  onClick={handleEndTurnClick}
                  className="bg-purple-700 border border-purple-500 text-white hover:bg-purple-600 text-xs sm:text-sm px-4 py-3 sm:py-2 rounded-lg transition-colors"
                >
                  {t('game.ninesStart.saveForLater')}
                </button>
              </div>
            </div>
          )}

          {/* Continue turn banner - Regular 4 of a kind */}
          {gameState.canContinueTurn && isHumanTurn && !isFourNinesStart && (
            <div className="bg-amber-600 rounded-lg p-4 sm:p-4 border-2 border-amber-400 shadow-lg w-full">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-900" />
                <span className="text-emerald-900 font-bold text-base sm:text-lg">{t('game.combo.title')}</span>
              </div>
              <p className="text-emerald-900 text-xs sm:text-sm mb-4 sm:mb-3">
                {t('game.combo.text')}
              </p>
              <div className="flex gap-4 sm:gap-3">
                <button
                  onClick={handlePlayClick}
                  disabled={selectedCards.length === 0}
                  className="bg-emerald-800 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm px-4 py-3 sm:py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {t('game.combo.playSelected', { count: selectedCards.length })}
                </button>
                <button
                  onClick={handleEndTurnClick}
                  className="bg-emerald-800 border border-emerald-600 text-white hover:bg-emerald-700 text-xs sm:text-sm px-4 py-3 sm:py-2 rounded-lg transition-colors"
                >
                  {t('game.combo.endTurn')}
                </button>
              </div>
            </div>
          )}

          {/* Action buttons - Desktop only */}
          {isHumanTurn && !showTakeOptions && !gameState.canContinueTurn && (
            <div className="hidden lg:flex flex-wrap gap-3 justify-center">
              <button
                onClick={handlePlayClick}
                disabled={selectedCards.length === 0}
                className="bg-amber-500 hover:bg-amber-600 text-emerald-900 font-bold px-6 py-2 text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                {t('game.mobile.play', { count: selectedCards.length })}
              </button>

              {canTakeCards && (
                <button
                  onClick={handleTakeClick}
                  className="bg-emerald-600 border border-emerald-400 text-white hover:bg-emerald-500 text-sm px-6 py-2 rounded-lg transition-colors"
                >
                {t('game.actions.takeCards')}
                </button>
              )}
            </div>
          )}

          </div>
        </div>

        {/* Right sidebar - Move History (Desktop) */}
        <div className="hidden lg:flex lg:w-52 flex-col gap-3 flex-shrink-0">
          <div className="bg-emerald-800 rounded-lg border border-emerald-600 flex flex-col" style={{ maxHeight: '400px' }}>
            <button
              onClick={() => {
                playClickSound();
                setShowHistory(!showHistory);
              }}
              className="flex items-center justify-between p-3 border-b border-emerald-600 flex-shrink-0"
            >
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-amber-400" />
                <span className="text-white font-medium text-sm">{t('game.history.title')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 text-xs">{gameState.moveHistory.length}</span>
                {showHistory ? (
                  <ChevronUp className="w-4 h-4 text-emerald-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-emerald-400" />
                )}
              </div>
            </button>

            {showHistory && (
              <div ref={historyContainerRef} className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
                {moveHistoryEntries}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile: turn indicator sits above and outside the hand dock */}
      {shouldShowHand && (
        <div className="lg:hidden flex-shrink-0 border-t border-emerald-700 bg-emerald-900/50 px-3 py-1.5">
          <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-300">
            <span>{t('game.center.currentTurn')}</span>
            <span className="font-bold text-amber-300">{currentPlayer.name}</span>
            {currentPlayer.isAI && <span className="text-[10px] text-emerald-400">({t('game.sidebar.ai')})</span>}
            {isAIThinking && <span className="animate-pulse text-amber-400">{t('game.center.thinking')}</span>}
          </div>
        </div>
      )}

      {/* Mobile: Arena hand dock */}
      {shouldShowHand && (
        <div className="lg:hidden flex-shrink-0 border-t border-emerald-600 bg-emerald-800 px-2 pt-1.5 pb-2">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-emerald-200">
            <span className="font-medium">
              {isHumanTurn ? t('game.hand.your') : t('game.hand.their', { name: currentPlayer.name })} {tPlural('game.hand.hand', currentPlayer.hand.length)}
            </span>
            <span className="text-emerald-400">{isHumanTurn ? t('game.mobile.swipeCards') : ''}</span>
          </div>
          <div data-hand-drop-zone="true" className="flex flex-nowrap justify-start gap-1.5 overflow-x-auto pb-0.5 touch-pan-x">
            {currentPlayer.hand.map((card: CardType) => {
              const isSelected = handCardsFaceUp && selectedCards.some(c => c.id === card.id);
              const valueStr = card.value === 11 ? 'J' : card.value === 12 ? 'Q' : card.value === 13 ? 'K' : card.value === 14 ? 'A' : card.value.toString();
              const suitSymbol = card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠';
              const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

              if (!handCardsFaceUp) {
                return (
                  <div
                    key={card.id}
                    data-card-id={card.id}
                    aria-hidden="true"
                    className="flex aspect-[3/4] w-[12vw] max-w-12 flex-shrink-0 items-center justify-center rounded-lg border-2 border-blue-400 bg-blue-600 opacity-75 shadow-sm"
                  >
                    <div className="h-11 w-8 rounded border border-blue-300 bg-blue-500" />
                  </div>
                );
              }

              return (
                <button
                  key={card.id}
                  data-card-id={card.id}
                  type="button"
                  aria-label={getCardDisplayName(card)}
                  aria-pressed={isSelected}
                  onPointerDown={event => handleCardPointerDown(card, event)}
                  onClick={() => handleCardSelect(card)}
                  disabled={!isHumanTurn}
                  className={`relative flex aspect-[3/4] w-[12vw] max-w-12 flex-shrink-0 select-none flex-col items-center justify-center rounded-lg border-2 text-sm font-bold shadow-sm transition-all ${draggingCardId === card.id ? 'z-20 -translate-y-3 rotate-2 scale-105 shadow-xl' : ''} ${
                    isSelected
                      ? 'scale-105 border-amber-400 bg-amber-50 shadow-md'
                      : 'border-slate-300 bg-white hover:border-slate-400 hover:shadow'
                  } ${!isHumanTurn ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <span className={`${isRed ? 'text-red-600' : 'text-slate-900'} text-base leading-none`}>{valueStr}</span>
                  <span className={`${isRed ? 'text-red-600' : 'text-slate-900'} mt-0.5 text-lg leading-none`}>{suitSymbol}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="lg:hidden flex-shrink-0 border-y border-emerald-700 bg-emerald-900/50 px-3 py-1 text-center">
        {pileTopCard && (
          <>
            <div className="text-[9px] text-emerald-300">{t('pile.top')}</div>
            <div className="text-[11px] font-bold text-amber-300">
              {t('card.format', {
                value: t(`card.value.${pileTopCard.value}`),
                suit: t(`card.suit.${pileTopCard.suit}`),
              })}
            </div>
          </>
        )}
      </div>

      <div className="lg:hidden flex-shrink-0 space-y-2 bg-emerald-900/70 px-3 pt-2 pb-3">
        {error && (
          <div ref={mobileErrorBannerRef} className="mx-auto flex max-w-md items-center gap-2 rounded-lg bg-red-500 px-3 py-1.5 text-xs text-white">
            <AlertCircle className="h-3.5 w-3.5" />
            {t(`game.error.${error}`)}
          </div>
        )}

        <div className="mx-auto flex min-h-11 w-full max-w-md gap-2">
          {showTakeOptions ? null : gameState.canContinueTurn && isHumanTurn ? (
            <div className="w-full rounded-xl border border-amber-400 bg-amber-600 p-2.5 text-center text-emerald-950">
              <p className="mb-2 text-xs font-semibold">
                {t(isFourNinesStart ? 'game.ninesStart.title' : 'game.combo.title')}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handlePlayClick}
                  disabled={selectedCards.length === 0}
                  className="flex-1 rounded-lg bg-emerald-800 px-2 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  {t(isFourNinesStart ? 'game.ninesStart.playSelected' : 'game.combo.playSelected', { count: selectedCards.length })}
                </button>
                <button
                  onClick={handleEndTurnClick}
                  className="flex-1 rounded-lg border border-emerald-800 bg-emerald-700 px-2 py-2 text-xs font-medium text-white"
                >
                  {t(isFourNinesStart ? 'game.ninesStart.saveForLater' : 'game.combo.endTurn')}
                </button>
              </div>
            </div>
          ) : isHumanTurn ? (
            <>
              <button
                onClick={handlePlayClick}
                disabled={selectedCards.length === 0}
                className="min-h-11 flex-1 rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-bold text-emerald-900 transition-colors hover:bg-amber-600 disabled:opacity-50"
              >
                {t('game.mobile.play', { count: selectedCards.length })}
              </button>
              {canTakeCards && (
                <button
                  onClick={handleTakeClick}
                  className="min-h-11 flex-1 rounded-lg border border-emerald-400 bg-emerald-600 px-3 py-2.5 text-sm text-white transition-colors hover:bg-emerald-500"
                >
                  {t('game.mobile.take')}
                </button>
              )}
            </>
          ) : null}
        </div>

        <div className="flex justify-center gap-2">
          <button
            onClick={handlePauseClick}
            className="flex items-center gap-2 rounded-lg border border-emerald-500 bg-emerald-700 px-4 py-2 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-600"
          >
            <Pause className="h-3.5 w-3.5" />
            {t('game.mobile.pause')}
          </button>
          <button
            onClick={() => {
              playClickSound();
              setShowMobileHistory(true);
            }}
            aria-haspopup="dialog"
            aria-expanded={showMobileHistory}
            className="flex items-center gap-2 rounded-lg border border-emerald-500 bg-emerald-700 px-4 py-2 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-600"
          >
            <History className="h-3.5 w-3.5 text-amber-300" />
            {t('game.history.title')}
            <span className="text-emerald-300">{gameState.moveHistory.length}</span>
          </button>
        </div>
      </div>

      {/* Desktop: Player Hand at bottom */}
      {shouldShowHand && (
        <div className="hidden lg:block min-h-[300px] bg-emerald-800 border-t border-emerald-600 p-4 flex-shrink-0">
          <div data-hand-drop-zone="true" className="max-w-5xl mx-auto">
            <div className="text-center mb-3">
              <span className="text-emerald-300 text-sm">
                {isHumanTurn ? t('game.hand.your') : t('game.hand.their', { name: currentPlayer.name })} {tPlural('game.hand.hand', currentPlayer.hand.length)}
              </span>
            </div>
            <PlayerHand
              hand={currentPlayer.hand}
              selectedCards={selectedCards}
              onCardSelect={handleCardSelect}
              onCardPointerDown={handleCardPointerDown}
              draggingCardId={draggingCardId}
              disabled={!isHumanTurn}
              faceUp={handCardsFaceUp}
            />
          </div>
        </div>
      )}

      {showConfirm && (
        <ConfirmPopup
          message={getConfirmMessage()}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
      {showTakeOptions && isHumanTurn && (
        <TakeOptionsPopup
          takeAllCount={takeOptions.takeAllCount}
          onTake3={handleTake3}
          onTakeAll={handleTakeAll}
          onCancel={handleCancel}
        />
      )}
      {flight && (
        <CardFlight request={flight} onComplete={() => setFlight(null)} />
      )}
      {draggedCards.length > 0 && dragPreviewPosition && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[60] h-24 w-20 -translate-x-1/2 -translate-y-1/2 lg:h-28 lg:w-24"
          style={{ left: dragPreviewPosition.x, top: dragPreviewPosition.y }}
        >
          {draggedCards.map((card: CardType, index: number) => (
            <div
              key={card.id}
              className="absolute"
              style={{ left: `${index * 4}px`, top: `${-index * 3}px`, zIndex: index + 1 }}
            >
              <PlayingCard card={{ ...card, faceUp: true }} size="sm" />
            </div>
          ))}
        </div>
      )}
      {navigationConfirmDialog}
      {showMobileHistory && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 lg:hidden"
          onClick={() => {
            playClickSound();
            setShowMobileHistory(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-history-title"
            onClick={event => event.stopPropagation()}
            className="flex max-h-[82dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-emerald-500 bg-emerald-900 shadow-2xl"
          >
            <header className="flex flex-shrink-0 items-center justify-between border-b border-emerald-700 bg-emerald-800 px-4 py-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-amber-300" />
                <h2 id="mobile-history-title" className="font-semibold text-white">
                  {t('game.history.title')}
                </h2>
                <span className="text-xs text-emerald-300">{gameState.moveHistory.length}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  playClickSound();
                  setShowMobileHistory(false);
                }}
                aria-label={t('confirmPopup.cancel')}
                className="rounded-lg p-2 text-emerald-200 transition-colors hover:bg-emerald-700 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div ref={historyContainerRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {moveHistoryEntries}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

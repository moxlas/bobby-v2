import { useState, useEffect, useRef } from 'react';
import { Card as CardType, GameOptions, PlayerMove } from '../types/game';
import { PlayerHand } from './PlayerHand';
import { GamePile } from './GamePile';
import { ConfirmPopup } from './ConfirmPopup';
import { useTranslation } from '../lib/i18n';
import { validatePlay, getTakeOptions, getValidMoves } from '../utils/gameLogic';
import { getAIMove, getAIDelay } from '../utils/aiLogic';
import {
  initAudio, setMuted, isMuted,
  playCardSound, playTakeSound, playComboSound,
  playWinSound, playLoseSound, playYourTurnSound, playClickSound,
} from '../utils/sounds';
import { ArrowRight, Clock, RotateCcw, Home, AlertCircle, Pause, Play, Zap, History, ChevronDown, ChevronUp, Crown, Skull, Volume2, VolumeX, BookOpen } from 'lucide-react';

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

export function GameBoard({
  gameState,
  onPlayCards,
  onTakeCards,
  onEndTurn,
  onPauseGame,
  onResumeGame,
  onForfeitPlayer,
  onFinishGame,
  onRestartGame,
  onNewGame
}: GameBoardProps) {
  const { t, tArray } = useTranslation();
  const [selectedCards, setSelectedCards] = useState<CardType[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showForfeitConfirm, setShowForfeitConfirm] = useState(false);
  const [pendingAction, setPendingAction] = useState<'play' | 'take3' | 'takeAll' | 'endTurn' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAIThinking, setIsAIThinking] = useState(false);
  const [showTakeOptions, setShowTakeOptions] = useState(false);
  const [showNewGameConfirm, setShowNewGameConfirm] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showHistory, setShowHistory] = useState(true);
  const [showPauseRules, setShowPauseRules] = useState(false);
  const [mutedState, setMutedState] = useState(false);
  const historyContainerRef = useRef<HTMLDivElement>(null);
  const prevPlayerIndexRef = useRef<number | null>(null);
  const finishSoundPlayedRef = useRef(false);

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

  // Combo (4-of-a-kind bonus turn) sound
  useEffect(() => {
    if (gameState.canContinueTurn) {
      playComboSound();
    }
  }, [gameState.canContinueTurn]);

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
      setError(null);
      setShowTakeOptions(false);
    }
  }, [gameState.currentPlayerIndex]);

  useEffect(() => {
    if (gameState.canContinueTurn) {
      setSelectedCards([]);
      setError(null);
    }
  }, [gameState.canContinueTurn]);

  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const humanPlayers = gameState.players.filter((p: any) => !p.isAI);
  const allHumanPlayersFinished = humanPlayers.length > 0 && humanPlayers.every((p: any) => p.hasFinished);

  const isHumanTurn = currentPlayer && !currentPlayer.isAI && !currentPlayer.hasFinished && gameState.phase === 'playing';
  const isPlayerTurn = currentPlayer && !currentPlayer.hasFinished;
  const handCardsFaceUp = currentPlayer && (!currentPlayer.isAI || allHumanPlayersFinished);
  const pile = gameState.pile;
  const options: GameOptions = gameState.options;

  const topCard = pile.length > 0 ? pile[pile.length - 1] : null;
  const historySpacerHeight = (() => {
    const count = gameState.moveHistory.length;
    if (count === 0) return 104;
    return Math.max(0, 3 - Math.min(count, 3)) * 48;
  })();

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

      const tryPlayLowestCard = (playerId: number, hand: CardType[]) => {
        const sorted = [...hand].sort((a, b) => a.value - b.value);
        if (sorted.length > 0) {
          onPlayCardsRef.current(playerId, [sorted[0]], false);
        } else {
          onPlayCardsRef.current(playerId, [], false);
        }
      };

      if (aiMove.type === 'endTurn') {
        const pile = state.pile;
        // Never end turn when pile has only the 9 of diamonds — play lowest card instead
        if (pile.length === 1 && pile[0].value === 9 && pile[0].suit === 'diamonds') {
          tryPlayLowestCard(player.id, player.hand);
        } else {
          onEndTurnRef.current();
        }
      } else if (aiMove.type === 'play' && aiMove.cards.length > 0) {
        const pile = state.pile;
        const isFirstMove = pile.length === 1 && pile[0].suit === 'diamonds' && pile[0].value === 9;
        const validation = validatePlay(aiMove.cards, pile, isFirstMove, state.options);

        if (validation.valid) {
          onPlayCardsRef.current(player.id, aiMove.cards, validation.continueTurn || false);
        } else {
          // AI's play was invalid — try taking if possible, otherwise play lowest card
          const takeOpts = getTakeOptions(pile, state.options);
          const count = takeOpts.canTake3 ? takeOpts.take3Count : takeOpts.takeAllCount;
          if (count > 0) {
            onTakeCardsRef.current(player.id, count);
          } else {
            tryPlayLowestCard(player.id, player.hand);
          }
        }
      } else if (aiMove.type === 'take') {
        const takeOpts = getTakeOptions(state.pile, state.options);
        const count = aiMove.takeType === 'takeAll'
          ? takeOpts.takeAllCount
          : takeOpts.take3Count;

        if (count > 0) {
          onTakeCardsRef.current(player.id, count);
        } else {
          tryPlayLowestCard(player.id, player.hand);
        }
      } else {
        tryPlayLowestCard(player.id, player.hand);
      }

      setIsAIThinking(false);
    };

    const delay = getAIDelay(gameState.options?.aiDifficulty || 'medium');
    const timeout = setTimeout(executeAITurn, delay);

    return () => {
      clearTimeout(timeout);
      setIsAIThinking(false);
    };
  }, [gameState.currentPlayerIndex, gameState.phase, gameState.players, gameState.canContinueTurn]);

  const handleCardSelect = (card: CardType) => {
    if (!isHumanTurn) return;

    const isSelected = selectedCards.find(c => c.id === card.id);
    if (isSelected) {
      setSelectedCards(selectedCards.filter(c => c.id !== card.id));
    } else {
      setSelectedCards([...selectedCards, card]);
    }
    setError(null);
  };

  const handlePlayClick = () => {
    if (selectedCards.length === 0) {
      setError(t('game.error.selectCards'));
      return;
    }

    const validation = validatePlay(selectedCards, pile, isFirstMove, options);
    if (!validation.valid) {
      setError(validation.error || t('game.error.invalidMove'));
      return;
    }

    setPendingAction('play');
    setShowConfirm(true);
  };

  const handleTakeClick = () => {
    if (takeOptions.canTake3 && takeOptions.canTakeAll) {
      setShowTakeOptions(true);
    } else if (takeOptions.canTakeAll) {
      setPendingAction('takeAll');
      setShowConfirm(true);
    } else {
      setPendingAction('take3');
      setShowConfirm(true);
    }
  };

  const handleTake3 = () => {
    setPendingAction('take3');
    setShowConfirm(true);
    setShowTakeOptions(false);
  };

  const handleTakeAll = () => {
    setPendingAction('takeAll');
    setShowConfirm(true);
    setShowTakeOptions(false);
  };

  const handleEndTurnClick = () => {
    setPendingAction('endTurn');
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    if (pendingAction === 'play') {
      const validation = validatePlay(selectedCards, pile, isFirstMove, options);
      if (validation.continueTurn) {
        playComboSound();
      } else {
        playCardSound();
      }
      onPlayCards(currentPlayer.id, selectedCards, validation.continueTurn || false);
    } else if (pendingAction === 'take3') {
      playTakeSound();
      onTakeCards(currentPlayer.id, takeOptions.take3Count);
    } else if (pendingAction === 'takeAll') {
      playTakeSound();
      onTakeCards(currentPlayer.id, takeOptions.takeAllCount);
    } else if (pendingAction === 'endTurn') {
      playClickSound();
      onEndTurn();
    }

    setShowConfirm(false);
    setPendingAction(null);
    setSelectedCards([]);
  };

  const handleCancel = () => {
    setShowConfirm(false);
    setPendingAction(null);
    setShowTakeOptions(false);
  };

  const getConfirmMessage = () => {
    if (pendingAction === 'play') {
      const cardNames = selectedCards.map(c =>
        t('card.format', { value: t(`card.value.${c.value}`), suit: t(`card.suit.${c.suit}`) })
      ).join(', ');
      return t('game.confirm.playCards', { cards: cardNames });
    } else if (pendingAction === 'take3') {
      return t(takeOptions.take3Count === 1 ? 'game.confirm.takeCards_one' : 'game.confirm.takeCards_other', { count: takeOptions.take3Count });
    } else if (pendingAction === 'takeAll') {
      return t('game.confirm.takeAll', { count: takeOptions.takeAllCount });
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
              onClick={onRestartGame}
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-emerald-900 font-bold text-sm sm:text-base py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {t('game.finished.playAgain')}
            </button>
            <button
              onClick={onNewGame}
              className="flex-1 bg-emerald-600 border border-emerald-400 text-white hover:bg-emerald-500 text-sm sm:text-base py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Home className="w-4 h-4" />
              {t('game.finished.newGame')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gameState.phase === 'paused') {
    const activeHumans = gameState.players.filter((p: any) => !p.isAI && !p.hasFinished);
    const hasActiveHumans = activeHumans.length > 0;

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
              onClick={onResumeGame}
              className="w-full bg-amber-500 hover:bg-amber-600 text-emerald-900 font-bold text-base sm:text-lg py-4 sm:py-6 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Play className="w-4 h-4 sm:w-5 sm:h-5" />
              {t('game.paused.resume')}
            </button>

            <button
              onClick={() => setShowPauseRules(!showPauseRules)}
              className="w-full bg-emerald-600 border border-emerald-400 text-white hover:bg-emerald-500 text-sm sm:text-base py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <BookOpen className="w-4 h-4" />
              {t('game.paused.gameRules')}
              {showPauseRules ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showPauseRules && (
              <div className="bg-emerald-700/40 rounded-lg p-4 space-y-2.5 border border-emerald-600 text-left max-h-64 overflow-y-auto">
                {(tArray('setup.rules') as { title: string; text: string }[]).map((rule, index) => (
                  <div key={index} className="text-sm">
                    <span className="text-amber-400 font-medium">{rule.title}: </span>
                    <span className="text-emerald-200">{rule.text}</span>
                  </div>
                ))}
              </div>
            )}

            {hasActiveHumans ? (
              <button
                onClick={() => setShowForfeitConfirm(true)}
                className="w-full bg-red-600 border border-red-400 text-white hover:bg-red-500 text-sm sm:text-base py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                <Skull className="w-4 h-4" />
                {t('game.paused.forfeit')}
              </button>
            ) : (
              <button
                onClick={() => setShowForfeitConfirm(true)}
                className="w-full bg-red-600 border border-red-400 text-white hover:bg-red-500 text-sm sm:text-base py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                <Skull className="w-4 h-4" />
                {t('game.paused.finishGame')}
              </button>
            )}

            {showForfeitConfirm && (
              <ConfirmPopup
                message={hasActiveHumans
                  ? t('game.forfeit.confirm')
                  : t('game.finishGame.confirm')}
                onConfirm={() => {
                  setShowForfeitConfirm(false);
                  if (hasActiveHumans) {
                    onForfeitPlayer(activeHumans[0].id);
                  } else {
                    onFinishGame();
                  }
                }}
                onCancel={() => setShowForfeitConfirm(false)}
              />
            )}

            <button
              onClick={() => setShowRestartConfirm(true)}
              className="w-full bg-emerald-600 border border-emerald-400 text-white hover:bg-emerald-500 text-sm sm:text-base py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {t('game.paused.restartGame')}
            </button>
          </div>
        </div>

        {showRestartConfirm && (
          <ConfirmPopup
            titleKey="confirmPopup.areYouSure"
            message={t('game.restartGame.confirm')}
            onConfirm={() => {
              setShowRestartConfirm(false);
              onRestartGame();
            }}
            onCancel={() => setShowRestartConfirm(false)}
          />
        )}
      </div>
    );
  }

  const shouldShowHand = currentPlayer && !currentPlayer.hasFinished;

  const canTakeCards = validMoves.canTake && !gameState.canContinueTurn;

  const playerCount = gameState.players.length;
  const estimatedPlayerListHeight = Math.max(playerCount * 42 + Math.max(0, playerCount - 1) * 4, 180);

  return (
    <div className="min-h-screen bg-emerald-900 flex flex-col">
      {/* Top bar */}
      <div className="bg-emerald-800 border-b border-emerald-600 px-2 sm:px-4 py-3 sm:py-3 flex-shrink-0">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-1 sm:gap-4">
            <h1 className="text-base sm:text-xl font-bold text-amber-300">{t('game.topBar.title')}</h1>
            <span className="text-emerald-300 text-xs hidden sm:inline">
              {t('game.topBar.turn', { turn: gameState.turnNumber })}
            </span>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2 bg-emerald-700 px-3 sm:px-4 py-2 sm:py-2 rounded-lg">
              <Clock className="w-5 h-5 text-amber-300" />
              <span className="text-white font-mono text-base sm:text-lg">{formatTime(elapsedTime)}</span>
            </div>

            <button
              onClick={onPauseGame}
              className="bg-emerald-700 border border-emerald-500 text-emerald-100 hover:bg-emerald-600 lg:flex hidden items-center gap-1 px-3 py-2 rounded-lg text-sm transition-colors"
            >
              <Pause className="w-4 h-4" />
              {t('game.topBar.pause')}
            </button>

            <button
              onClick={() => {
                const next = !mutedState;
                setMutedState(next);
                setMuted(next);
              }}
              title={mutedState ? t('game.topBar.unmute') : t('game.topBar.mute')}
              className="bg-emerald-700 border border-emerald-500 text-emerald-100 hover:bg-emerald-600 flex items-center px-3 py-2.5 sm:py-2 rounded-lg text-sm transition-colors"
            >
              {mutedState ? <VolumeX className="w-5 h-5 sm:w-4 sm:h-4" /> : <Volume2 className="w-5 h-5 sm:w-4 sm:h-4" />}
            </button>

            <button
              onClick={() => setShowNewGameConfirm(true)}
              className="bg-emerald-700 border border-emerald-500 text-emerald-100 hover:bg-emerald-600 flex items-center gap-1 px-3 py-2.5 sm:py-2 rounded-lg text-sm transition-colors"
            >
              <Home className="w-5 h-5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">{t('game.topBar.newGame')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main game area */}
      <div className="flex-1 flex flex-col sm:flex-row items-start gap-1 sm:gap-4 px-1 sm:px-4 pt-2 pb-0 sm:p-4 max-w-6xl mx-auto w-full overflow-hidden">
        {/* Left sidebar - Players */}
        <div className="hidden sm:flex w-full sm:w-32 lg:w-44 flex-col gap-1 sm:gap-2 overflow-y-auto flex-shrink-0">
          <div className="text-emerald-300 text-[10px] sm:text-xs font-medium uppercase tracking-wide mb-0.5 sm:mb-1 px-0.5 sm:px-1 hidden sm:block">{t('game.sidebar.players')}</div>
          {gameState.players.map((player: any) => {
            const isCurrent = player.id === currentPlayer?.id;

            return (
              <div
                key={player.id}
                className={`flex-shrink-0 rounded-lg p-1 sm:p-2 border transition-all ${
                  isCurrent
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-emerald-600 bg-emerald-800/50'
                } ${player.hasFinished ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-1 sm:gap-2">
                  <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full flex-shrink-0 ${
                    player.hasFinished ? 'bg-gray-500' : isCurrent ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-0.5 sm:gap-1">
                      <span className={`text-xs sm:text-sm font-medium truncate ${isCurrent ? 'text-amber-300' : 'text-white'}`}>
                        {player.name}
                      </span>
                      {player.isAI && <span className="text-[8px] sm:text-[10px] text-emerald-400">{t('game.sidebar.ai')}</span>}
                    </div>
                    <div className="text-[10px] sm:text-xs text-emerald-400">
                      {player.hasFinished ? (
                        <span className="text-amber-400 flex items-center gap-0.5 sm:gap-1">
                          {player.finishPosition === 1 ? <Crown className="w-2 h-2 sm:w-3 sm:h-3" /> :
                           player.finishPosition === gameState.players.length ? <Skull className="w-2 h-2 sm:w-3 sm:h-3" /> : null}
                          #{player.finishPosition}
                        </span>
                      ) : (
                        <span>{t('game.sidebar.cards')} ({player.hand.length})</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Center - Pile and actions */}
        <div className="flex-1 w-full sm:w-auto order-3 sm:order-2 grid grid-rows-[auto_1fr_min-content] sm:grid-rows-[auto_auto_min-content] place-items-center gap-3 sm:gap-4 overflow-y-auto min-h-0">
          {/* Narrow: current turn (left), pile count (center), top card (right) */}
          <div className="flex sm:hidden items-start w-full px-1 pt-1">
            <div className="flex-1">
              <div className="text-emerald-300 text-xs">{t('game.center.currentTurn')}</div>
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-amber-300 font-bold text-sm">{currentPlayer?.name}</span>
                {currentPlayer?.isAI && <span className="text-[10px] text-emerald-400">({t('game.sidebar.ai')})</span>}
                {isAIThinking && <span className="text-amber-400 text-xs animate-pulse">{t('game.center.thinking')}</span>}
              </div>
            </div>
            <div className="flex-shrink-0 px-1">
              <div className="text-emerald-300 text-xs text-center">{t('game.sidebar.cards')}</div>
              <div className="text-amber-300 font-bold text-sm text-center">{pile.length}</div>
            </div>
            <div className="flex-1 text-right">
              <div className="text-emerald-300 text-xs">{t('pile.top')}</div>
              <div className="text-amber-300 font-bold text-sm">
                {topCard ? t('card.format', { value: t(`card.value.${topCard.value}`), suit: t(`card.suit.${topCard.suit}`) }) : ''}
              </div>
            </div>
          </div>

          {/* Current turn (medium+) */}
          <div className="hidden sm:block text-center">
            <div className="mb-1 sm:mb-2">
              <div className="text-emerald-300 text-xs sm:text-sm">{t('game.center.currentTurn')}</div>
              <div className="flex items-center justify-center gap-1 sm:gap-2 flex-wrap">
                <span className="text-amber-300 font-bold text-sm sm:text-lg">{currentPlayer?.name}</span>
                {currentPlayer?.isAI && <span className="text-[10px] sm:text-xs text-emerald-400">({t('game.sidebar.ai')})</span>}
                {isAIThinking && <span className="text-amber-400 text-xs sm:text-sm animate-pulse">{t('game.center.thinking')}</span>}
              </div>
            </div>
          </div>

          <div className="row-start-2 flex items-center justify-center">
            <GamePile pile={pile} onTakeClick={isHumanTurn && !showTakeOptions && !gameState.canContinueTurn && canTakeCards ? handleTakeClick : undefined} />
          </div>

          <div className="row-start-3 self-start flex w-full max-w-sm flex-col items-center gap-4 sm:gap-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-500 text-white px-3 sm:px-4 py-2 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {/* Continue turn banner - 4 Nines Start */}
          {gameState.canContinueTurn && isHumanTurn && isFourNinesStart && (
            <div className="bg-purple-600 rounded-lg p-3 sm:p-4 border-2 border-purple-400 shadow-lg w-full">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🃏</span>
                <span className="text-white font-bold text-base sm:text-lg">{t('game.ninesStart.title')}</span>
              </div>
              <p className="text-purple-100 text-xs sm:text-sm mb-3 sm:mb-3">
                {t('game.ninesStart.text')}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-3">
                <button
                  onClick={handlePlayClick}
                  disabled={selectedCards.length === 0}
                  className="bg-white hover:bg-gray-100 text-purple-700 font-bold text-xs sm:text-sm px-3 py-2.5 sm:py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {t('game.ninesStart.playSelected', { count: selectedCards.length })}
                </button>
                <button
                  onClick={handleEndTurnClick}
                  className="bg-purple-700 border border-purple-500 text-white hover:bg-purple-600 text-xs sm:text-sm px-3 py-2.5 sm:py-2 rounded-lg transition-colors"
                >
                  {t('game.ninesStart.saveForLater')}
                </button>
              </div>
            </div>
          )}

          {/* Continue turn banner - Regular 4 of a kind */}
          {gameState.canContinueTurn && isHumanTurn && !isFourNinesStart && (
            <div className="bg-amber-600 rounded-lg p-3 sm:p-4 border-2 border-amber-400 shadow-lg w-full">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-900" />
                <span className="text-emerald-900 font-bold text-base sm:text-lg">{t('game.combo.title')}</span>
              </div>
              <p className="text-emerald-900 text-xs sm:text-sm mb-3 sm:mb-3">
                {t('game.combo.text')}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-3">
                <button
                  onClick={handlePlayClick}
                  disabled={selectedCards.length === 0}
                  className="bg-emerald-800 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm px-3 py-2.5 sm:py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {t('game.combo.playSelected', { count: selectedCards.length })}
                </button>
                <button
                  onClick={handleEndTurnClick}
                  className="bg-emerald-800 border border-emerald-600 text-white hover:bg-emerald-700 text-xs sm:text-sm px-3 py-2.5 sm:py-2 rounded-lg transition-colors"
                >
                  {t('game.combo.endTurn')}
                </button>
              </div>
            </div>
          )}

          {/* Take options popup */}
          {showTakeOptions && (
            <div className="bg-emerald-700 rounded-lg p-4 sm:p-4 border border-emerald-500 shadow-lg w-full">
              <p className="text-emerald-100 mb-4 sm:mb-3 text-center font-medium text-sm sm:text-base">{t('game.takeOptions.title')}</p>
              <div className="flex flex-col sm:flex-row gap-4 sm:gap-3 items-center justify-center">
                <button
                  onClick={handleTake3}
                  className="bg-amber-500 hover:bg-amber-600 text-emerald-900 font-bold text-sm px-4 py-3 sm:py-2 rounded-lg transition-colors"
                >
                  {t('game.takeOptions.take3')}
                </button>
                <button
                  onClick={handleTakeAll}
                  className="bg-amber-500 hover:bg-amber-600 text-emerald-900 font-bold text-sm px-4 py-3 sm:py-2 rounded-lg transition-colors"
                >
                  {t('game.takeOptions.takeAll', { count: takeOptions.takeAllCount })}
                </button>
              </div>
              <button
                onClick={handleCancel}
                className="w-full mt-4 sm:mt-3 bg-emerald-600 border border-emerald-400 text-white hover:bg-emerald-500 text-sm px-4 py-3 sm:py-2 rounded-lg transition-colors"
              >
                {t('game.takeOptions.cancel')}
              </button>
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
                {t('game.actions.play', { count: selectedCards.length })}
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

        {/* Right sidebar - Move History */}
        <div className="hidden sm:flex w-full sm:w-36 lg:w-56 flex-col gap-1 sm:gap-3 flex-shrink-0 order-2 sm:order-3">
          <div className="bg-emerald-800 rounded-lg border border-emerald-600 flex flex-col" style={{ maxHeight: `${estimatedPlayerListHeight}px` }}>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center justify-between p-2 sm:p-3 border-b border-emerald-600 flex-shrink-0"
            >
              <div className="flex items-center gap-1 sm:gap-2">
                <History className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" />
                <span className="text-white font-medium text-sm truncate">{t('game.history.title')}</span>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                <span className="text-emerald-400 text-xs">{gameState.moveHistory.length}</span>
                {showHistory ? (
                  <ChevronUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
                )}
              </div>
            </button>

            {showHistory && (
              <div ref={historyContainerRef} className="flex-1 overflow-y-auto p-1.5 sm:p-2 space-y-1 min-h-0">
                {gameState.moveHistory.length === 0 ? (
                  <p className="text-emerald-400 text-xs italic text-center py-2 sm:py-4">{t('game.history.noMoves')}</p>
                ) : (
                  gameState.moveHistory.slice().reverse().map((move: PlayerMove) => (
                    <div
                      key={move.id}
                      className={`text-xs p-1.5 sm:p-2 rounded ${
                        move.type === 'play'
                          ? 'bg-emerald-700/50'
                          : 'bg-amber-900/30'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`font-medium truncate max-w-[60%] ${move.type === 'play' ? 'text-amber-300' : 'text-emerald-300'}`}>
                          {move.playerName}
                        </span>
                        <span className="text-emerald-500 text-[10px] flex-shrink-0">T{move.turnNumber}</span>
                      </div>
                      <div className="text-emerald-200 truncate">
                        {move.type === 'play' ? (
                          <span className="flex items-center gap-1">
                            <span className="text-emerald-400 flex-shrink-0">→</span>
                            <span className="truncate">{move.cards.map(c => getCardDisplayName(c)).join(' ')}</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <span className="text-amber-400 flex-shrink-0">↑</span>
                            {t('game.history.took', { count: move.cards.length })}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile: Bottom Section */}
      <div className="lg:hidden bg-emerald-800 border-t border-emerald-600 flex flex-col">
        {shouldShowHand && (
          <div className="border-b border-emerald-600 px-2 pt-1 pb-2 sm:p-3 flex-shrink-0 max-h-[460px] sm:max-h-none overflow-y-auto">
            <div className="text-center mb-1">
              <span className="text-emerald-300 text-xs sm:text-sm">{isHumanTurn ? t('game.hand.your') : t('game.hand.their', { name: currentPlayer.name })} {t('game.hand.hand', { count: currentPlayer.hand.length })}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {currentPlayer.hand.map((card: CardType) => {
                const isSelected = handCardsFaceUp && selectedCards.some(c => c.id === card.id);
                const valueStr = card.value === 11 ? 'J' : card.value === 12 ? 'Q' : card.value === 13 ? 'K' : card.value === 14 ? 'A' : card.value.toString();
                const suitSymbol = card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠';
                const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

                if (!handCardsFaceUp) {
                  return (
                    <div
                      key={card.id}
                      className="w-14 h-20 rounded-lg border-2 border-blue-400 bg-blue-600 flex items-center justify-center shadow-sm opacity-75"
                    >
                      <div className="w-8 h-12 bg-blue-500 rounded border border-blue-300" />
                    </div>
                  );
                }

                return (
                  <button
                    key={card.id}
                    onClick={() => handleCardSelect(card)}
                    disabled={!isHumanTurn}
                    className={`w-14 h-20 rounded-lg border-2 flex flex-col items-center justify-center text-lg sm:text-base font-bold transition-all shadow-sm ${
                      isSelected
                        ? 'border-amber-400 bg-amber-50 scale-105 shadow-md'
                        : 'border-slate-300 bg-white hover:border-slate-400 hover:shadow'
                    } ${!isHumanTurn ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className={`${isRed ? 'text-red-600' : 'text-slate-900'} leading-none`}>
                      {valueStr}
                    </span>
                    <span className={`${isRed ? 'text-red-600' : 'text-slate-900'} text-base sm:text-sm mt-0.5`}>
                      {suitSymbol}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          {isHumanTurn && !showTakeOptions && !gameState.canContinueTurn && (
            <div className="px-3 py-2 sm:p-3 border-b border-emerald-600">
              <div className="flex gap-4 sm:gap-3 justify-center">
                <button
                  onClick={handlePlayClick}
                  disabled={selectedCards.length === 0}
                  className="bg-amber-500 hover:bg-amber-600 text-emerald-900 font-bold px-5 py-3 text-sm rounded-lg flex-1 max-w-32 transition-colors disabled:opacity-50"
                >
                  {t('game.mobile.play', { count: selectedCards.length })}
                </button>

                {canTakeCards && (
                  <button
                    onClick={handleTakeClick}
                    className="bg-emerald-600 border border-emerald-400 text-white hover:bg-emerald-500 px-5 py-3 text-sm rounded-lg flex-1 max-w-32 transition-colors"
                  >
                    {t('game.mobile.take')}
                  </button>
                )}
              </div>
            </div>
          )}

          {gameState.phase === 'playing' && (
            <div className="flex justify-center p-3 sm:p-2 border-b border-emerald-600 lg:hidden">
              <button
                onClick={onPauseGame}
                className="bg-emerald-700 border border-emerald-500 text-emerald-100 hover:bg-emerald-600 py-2 px-4 text-xs font-medium rounded-lg flex items-center gap-2 transition-colors"
              >
                <Pause className="w-3 h-3" />
                {t('game.mobile.pause')}
              </button>
            </div>
          )}

          {/* Narrow only: Player list */}
          <div className="sm:hidden border-t border-emerald-600 px-2 py-1">
            <div className="flex flex-wrap gap-1 justify-center pb-0.5">
              {gameState.players.map((player: any) => {
                const isCurrent = player.id === currentPlayer?.id;
                return (
                  <div key={player.id} className={`flex-shrink-0 flex items-center gap-1 rounded-lg px-1.5 py-0.5 border text-[10px] ${
                    isCurrent
                      ? 'bg-amber-500/10 border-amber-400/40'
                      : 'bg-emerald-700/50 border-emerald-600'
                  } ${player.hasFinished ? 'opacity-60' : ''}`}>
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      player.hasFinished ? 'bg-gray-500' : isCurrent ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'
                    }`} />
                    <span className="text-white font-medium truncate max-w-[50px]">{player.name}</span>
                    {player.isAI && <span className="text-emerald-400 text-[8px] flex-shrink-0">AI</span>}
                    <span className="text-emerald-300 text-[9px] flex-shrink-0">{player.hasFinished ? `#${player.finishPosition}` : `(${player.hand.length})`}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Narrow only: Move history (last 3 moves visible) */}
          <div className="sm:hidden border-t border-emerald-600">
            <div className="flex items-center justify-between px-2 py-1.5">
              <div className="flex items-center gap-1">
                <History className="w-3 h-3 text-amber-400" />
                <span className="text-white font-medium text-xs">{t('game.history.title')}</span>
              </div>
              <span className="text-emerald-400 text-[10px]">{gameState.moveHistory.length}</span>
            </div>
            <div className="overflow-y-auto max-h-[155px] px-2 pb-2 space-y-1">
              {gameState.moveHistory.length === 0 ? (
                <p className="text-emerald-400 text-xs italic text-center py-2">{t('game.history.noMoves')}</p>
              ) : (
                gameState.moveHistory.slice().reverse().map((move: PlayerMove) => (
                  <div key={move.id} className={`text-[11px] p-1.5 rounded ${
                    move.type === 'play'
                      ? 'bg-emerald-700/50'
                      : 'bg-amber-900/30'
                  }`}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`font-medium truncate max-w-[65%] ${move.type === 'play' ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {move.playerName}
                      </span>
                      <span className="text-emerald-500 text-[9px] flex-shrink-0">T{move.turnNumber}</span>
                    </div>
                    <div className="text-emerald-200 truncate">
                      {move.type === 'play' ? (
                        <span className="flex items-center gap-0.5">
                          <span className="text-emerald-400 flex-shrink-0">→</span>
                          <span className="truncate">{move.cards.map(c => getCardDisplayName(c)).join(' ')}</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5">
                          <span className="text-amber-400 flex-shrink-0">↑</span>
                          {t('game.history.took', { count: move.cards.length })}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div style={{ height: `${historySpacerHeight}px` }} />
          </div>
        </div>
      </div>

      {/* Desktop: Player Hand at bottom */}
      {shouldShowHand && (
        <div className="hidden lg:block bg-emerald-800 border-t border-emerald-600 p-4 flex-shrink-0">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-3">
              <span className="text-emerald-300 text-sm">{isHumanTurn ? t('game.hand.your') : t('game.hand.their', { name: currentPlayer.name })} {t('game.hand.hand', { count: currentPlayer.hand.length })}</span>
            </div>
            <PlayerHand
              hand={currentPlayer.hand}
              selectedCards={selectedCards}
              onCardSelect={handleCardSelect}
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

      {showNewGameConfirm && (
        <ConfirmPopup
          titleKey="confirmPopup.areYouSure"
          message={t('game.newGame.confirm')}
          onConfirm={() => {
            setShowNewGameConfirm(false);
            onNewGame();
          }}
          onCancel={() => setShowNewGameConfirm(false)}
        />
      )}
    </div>
  );
}

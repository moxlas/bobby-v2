import { useState, useCallback, useRef, useEffect } from 'react';
import { SetupScreen } from './components/SetupScreen';
import { GameBoard } from './components/GameBoard';
import { DealingAnimation } from './components/DealingAnimation';
import { OnlineEntry } from './components/OnlineEntry';
import { OnlineRoom } from './components/OnlineRoom';
import { Card, GameState, GameOptions } from './types/game';
import type { OnlineSession } from './types/online';
import {
  initializeGame,
  playCards,
  takeCards,
  endTurn,
  pauseGame,
  resumeGame,
  forfeitPlayer,
  finishGame,
  type PlayerSetup,
} from './utils/gameLogic';
import { saveGameResults } from './utils/leaderboard';
import { normalizeRoomCode } from './utils/roomCode';
import { readJoinCodeFromLocation } from './lib/onlineConfig';
import { clearActiveRoom, loadActiveRoom, loadOnlineName } from './lib/onlineIdentity';
import { I18nProvider } from './lib/i18n';

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function App() {
  const [mode, setMode] = useState<'local' | 'online'>(() => (readJoinCodeFromLocation() || loadActiveRoom() ? 'online' : 'local'));
  const [joinCode, setJoinCode] = useState<string | null>(() => {
    const code = readJoinCodeFromLocation();
    return code ? normalizeRoomCode(code) : null;
  });
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(() => {
    // A /join link always wins: it opens the entry form pre-filled instead of
    // silently reusing a seat from this tab's previous room.
    if (readJoinCodeFromLocation()) return null;
    const active = loadActiveRoom();
    return active ? { code: active.code, create: false, name: active.name } : null;
  });
  const [appPhase, setAppPhase] = useState<'setup' | 'dealing' | 'playing'>('setup');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [initialPlayers, setInitialPlayers] = useState<PlayerSetup[]>([]);
  const gameOptionsRef = useRef<GameOptions | null>(null);
  const leaderboardSavedRef = useRef(false);

  useEffect(() => {
    if (gameState?.phase === 'finished' && !leaderboardSavedRef.current) {
      leaderboardSavedRef.current = true;
      const totalPlayers = gameState.players.length;
      const results = gameState.finishOrder.map(p => ({
        playerName: p.name,
        isAI: p.isAI,
        finishPosition: p.finishPosition ?? totalPlayers,
        totalPlayers,
      }));
      saveGameResults(results);
    }
  }, [gameState?.phase]);

  const handleStartGame = useCallback((players: PlayerSetup[], options: GameOptions) => {
    const playersToUse = options.randomSeating ? shuffleArray(players) : players;
    gameOptionsRef.current = options;
    leaderboardSavedRef.current = false;
    setInitialPlayers(playersToUse);
    setGameState(initializeGame(playersToUse, options));
    setAppPhase('dealing');
  }, []);

  const handleDealingComplete = useCallback(() => {
    setAppPhase('playing');
  }, []);

  const handlePlayCards = useCallback((playerId: number, cards: Card[], continueTurn: boolean) => {
    setGameState(prev => (prev ? playCards(prev, playerId, cards, continueTurn) : prev));
  }, []);

  const handleTakeCards = useCallback((playerId: number, count: number) => {
    setGameState(prev => (prev ? takeCards(prev, playerId, count) : prev));
  }, []);

  const handleEndTurn = useCallback(() => {
    setGameState(prev => (prev ? endTurn(prev) : prev));
  }, []);

  const handlePauseGame = useCallback(() => {
    setGameState(prev => (prev ? pauseGame(prev) : prev));
  }, []);

  const handleResumeGame = useCallback(() => {
    setGameState(prev => (prev ? resumeGame(prev) : prev));
  }, []);

  const handleForfeitPlayer = useCallback((playerId: number) => {
    setGameState(prev => (prev ? forfeitPlayer(prev, playerId) : prev));
  }, []);

  const handleFinishGame = useCallback(() => {
    setGameState(prev => (prev ? finishGame(prev) : prev));
  }, []);

  const handleRestartGame = useCallback(() => {
    if (initialPlayers.length === 0 || !gameOptionsRef.current) return;
    leaderboardSavedRef.current = false;

    let playersToUse = initialPlayers;

    if (gameOptionsRef.current.rankedSeating && gameState?.finishOrder && gameState.finishOrder.length > 0) {
      playersToUse = gameState.finishOrder
        .filter(p => !p.isAI || true)
        .map(fp => {
          const match = initialPlayers.find(ip => ip.name === fp.name);
          return match || { name: fp.name, isAI: fp.isAI };
        });
      setInitialPlayers(playersToUse);
    }

    setGameState(initializeGame(playersToUse, gameOptionsRef.current));
    setAppPhase('dealing');
  }, [initialPlayers, gameState]);

  const handleNewGame = useCallback(() => {
    setGameState(null);
    setInitialPlayers([]);
    leaderboardSavedRef.current = false;
    setAppPhase('setup');
  }, []);

  const handlePlayOnline = useCallback(() => {
    setJoinCode(null);
    setMode('online');
  }, []);

  const handleEnterOnline = useCallback((session: OnlineSession) => {
    // Leave the /join/CODE path behind so a reload does not try to rejoin.
    window.history.replaceState({}, '', '/');
    setJoinCode(null);
    setOnlineSession(session);
  }, []);

  const handleExitOnline = useCallback(() => {
    clearActiveRoom();
    window.history.replaceState({}, '', '/');
    setOnlineSession(null);
    setJoinCode(null);
    setMode('local');
  }, []);

  useEffect(() => {
    if (gameState?.options.theme) {
      document.documentElement.dataset.theme = gameState.options.theme;
    }
  }, [gameState?.options.theme]);

  return (
    <I18nProvider>
      {mode === 'online' ? (
        onlineSession ? (
          <OnlineRoom
            key={`${onlineSession.create ? 'create' : 'join'}-${onlineSession.code}`}
            session={onlineSession}
            onExit={handleExitOnline}
          />
        ) : (
          <OnlineEntry
            initialCode={joinCode}
            defaultName={loadOnlineName()}
            onEnter={handleEnterOnline}
            onCancel={handleExitOnline}
          />
        )
      ) : appPhase === 'setup' || !gameState ? (
        <SetupScreen onStartGame={handleStartGame} onPlayOnline={handlePlayOnline} />
      ) : appPhase === 'dealing' ? (
        (() => {
          const openingPlayerId = gameState.moveHistory[0]?.playerId;
          const playerInfos = gameState.players.map(p => ({
            name: p.name,
            isAI: p.isAI,
            cardCount: p.hand.length + (p.id === openingPlayerId ? 1 : 0),
          }));
          return <DealingAnimation players={playerInfos} onComplete={handleDealingComplete} />;
        })()
      ) : (
        <GameBoard
          gameState={gameState}
          onPlayCards={handlePlayCards}
          onTakeCards={handleTakeCards}
          onEndTurn={handleEndTurn}
          onPauseGame={handlePauseGame}
          onResumeGame={handleResumeGame}
          onForfeitPlayer={handleForfeitPlayer}
          onFinishGame={handleFinishGame}
          onRestartGame={handleRestartGame}
          onNewGame={handleNewGame}
        />
      )}
    </I18nProvider>
  );
}

export default App;

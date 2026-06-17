import { useState } from 'react';
import { GameOptions, DEFAULT_OPTIONS, AIDifficulty } from '../types/game';
import { Play, BookOpen, ChevronDown, ChevronUp, AlertCircle, Settings, Zap, Trophy } from 'lucide-react';
import { Leaderboard } from './Leaderboard';
import { loadSettings, saveSettings } from '../utils/settings';

interface PlayerSetup {
  name: string;
  isAI: boolean;
}

interface SetupScreenProps {
  onStartGame: (players: PlayerSetup[], options: GameOptions) => void;
}

export const GAME_RULES = [
  { title: "Overview", text: "A shedding-type card game for 2-8 players. The goal is to be the first to discard all cards from your hand. The last player with cards loses!" },
  { title: "Deck & Deal", text: "Uses 24 cards (9 through Ace). All cards are shuffled, cut, and dealt face-down one at a time. Every card is dealt — no draw pile remains." },
  { title: "Starting the Game", text: "The 9 of Diamonds always starts. Whoever holds it places it face-up in the center. The 9 of Diamonds never leaves the pile — it stays at the bottom as the foundation for the entire game." },
  { title: "Playing Cards", text: "On your turn, play a card equal to or higher in value than the top card on the pile (e.g., if the top card is Queen, you may play Queen, King, or Ace). If you have 4 cards of the same value, you may play them all as a single move (if the 4 of a Kind rule is enabled)." },
  { title: "4 of a Kind Continuation", text: "After playing 4 cards of the same value, you may optionally play another valid card or another 4 of a kind on top before ending your turn. This can chain multiple times." },
  { title: "Taking Cards", text: "If you cannot play a valid card, you must take 3 cards from the top of the pile (or take ALL cards if the Take All rule is enabled and you choose that option). The 9 of Diamonds is never taken. If fewer than 3 cards are above it, you take whatever is there (1 or 2). Your turn then ends." },
  { title: "Special 9's Rule", text: "If the 9 of Diamonds is the only card on the table at the start of your turn and you hold other 9s in hand, you may play up to 3 additional 9s on top. After that, you may optionally play another valid card or 4 of a kind on top, then end your turn." },
  { title: "Winning", text: "The first player to discard all cards from their hand wins. The game can continue to determine 2nd, 3rd, and last place." },
  { title: "Strategy Tips", text: "Conserve high cards (Aces, Kings) for when you need them. Force opponents to pick up by playing cards that limit their options. Save 4-of-a-kind sets for when the pile is large. Sometimes taking all cards gives you more options than taking 3." },
];

const AI_DIFFICULTY_OPTIONS: { value: AIDifficulty; label: string; description: string }[] = [
  { value: 'easy', label: 'Easy', description: 'Plays simple moves, ends turn after each play' },
  { value: 'medium', label: 'Medium', description: 'Uses combos and multi-9 moves strategically' },
  { value: 'hard', label: 'Hard', description: 'Calculates optimal moves, seeks combos, blocks opponents' },
];

interface ToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

function Toggle({ enabled, onToggle }: ToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
        enabled ? 'bg-amber-500' : 'bg-emerald-600'
      }`}
    >
      <span
        className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
          enabled ? 'left-7' : 'left-1'
        }`}
      />
    </button>
  );
}

export function SetupScreen({ onStartGame }: SetupScreenProps) {
  const saved = loadSettings();
  const [playerCount, setPlayerCount] = useState(saved?.players.length || 2);
  const [players, setPlayers] = useState<PlayerSetup[]>(
    saved?.players || [
      { name: 'Player 1', isAI: false },
      { name: 'Player 2', isAI: true },
    ]
  );
  const [showRules, setShowRules] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameWarningIndex, setNameWarningIndex] = useState<number | null>(null);

  const [specialNinesRule, setSpecialNinesRule] = useState(saved?.options.specialNinesRule ?? DEFAULT_OPTIONS.specialNinesRule);
  const [allowTakeAllCards, setAllowTakeAllCards] = useState(saved?.options.allowTakeAllCards ?? DEFAULT_OPTIONS.allowTakeAllCards);
  const [fourOfAKindRule, setFourOfAKindRule] = useState(saved?.options.fourOfAKindRule ?? DEFAULT_OPTIONS.fourOfAKindRule);
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>(saved?.options.aiDifficulty ?? DEFAULT_OPTIONS.aiDifficulty);

  const handlePlayerCountChange = (count: number) => {
    setPlayerCount(count);
    const newPlayers: PlayerSetup[] = [];
    for (let i = 0; i < count; i++) {
      newPlayers.push({
        name: players[i]?.name || `Player ${i + 1}`,
        isAI: players[i]?.isAI ?? (i > 0),
      });
    }
    setPlayers(newPlayers);
    setError(null);
  };

  const handlePlayerNameChange = (index: number, name: string) => {
    if (name.length > 16) {
      setNameWarningIndex(index);
      setTimeout(() => setNameWarningIndex(null), 2000);
    }
    const newPlayers = [...players];
    newPlayers[index] = { ...newPlayers[index], name: name.slice(0, 16) };
    setPlayers(newPlayers);
    setError(null);
  };

  const handlePlayerTypeChange = (index: number, isAI: boolean) => {
    const newPlayers = [...players];
    newPlayers[index] = { ...newPlayers[index], isAI };
    setPlayers(newPlayers);
    setError(null);
  };

  const handleStartGame = () => {
    const humanPlayers = players.filter(p => !p.isAI);
    if (humanPlayers.length === 0) {
      setError('At least one human player is required!');
      return;
    }
    const emptyNames = players.filter(p => p.name.trim() === '');
    if (emptyNames.length > 0) {
      setError('All players must have a name!');
      return;
    }

    const options: GameOptions = {
      specialNinesRule,
      allowTakeAllCards,
      fourOfAKindRule,
      aiDifficulty,
    };

    saveSettings(players, options);
    onStartGame(players, options);
  };

  return (
    <>
      <div className="min-h-screen bg-emerald-900 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-emerald-800 rounded-xl shadow-2xl overflow-hidden border border-emerald-600">
          <div className="bg-amber-500 p-6 text-center relative">
            <h1 className="text-3xl font-bold text-emerald-900 mb-1">🃏 The Bobby</h1>
            <p className="text-amber-700 text-sm">A multiplayer card game</p>
            <button
              onClick={() => setShowLeaderboard(true)}
              className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 bg-emerald-900/20 hover:bg-emerald-900/30 text-emerald-900 font-medium text-sm px-3 py-2 rounded-lg transition-colors"
            >
              <Trophy className="w-4 h-4" />
              <span className="hidden sm:inline">Leaderboard</span>
            </button>
          </div>

          <div className="p-6 space-y-5">
            {error && (
              <div className="bg-red-500/20 border border-red-500 rounded-lg p-3 flex items-center gap-2 text-red-200">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            {/* Player count */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-emerald-300">Number of Players</label>
              <div className="flex gap-2 flex-wrap">
                {[2, 3, 4, 5, 6, 7, 8].map((count) => (
                  <button
                    key={count}
                    onClick={() => handlePlayerCountChange(count)}
                    className={`w-10 h-10 rounded-lg font-medium transition-all text-sm ${
                      playerCount === count
                        ? 'bg-amber-500 text-emerald-900'
                        : 'bg-emerald-600 text-emerald-300 hover:bg-emerald-500'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            {/* Players */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-emerald-300">Players</label>
              {players.map((player, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={player.name}
                      onChange={(e) => handlePlayerNameChange(index, e.target.value)}
                      placeholder={`Player ${index + 1}`}
                      className="w-full px-4 py-2 rounded-lg bg-emerald-700 border border-emerald-500 text-white placeholder-emerald-400 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                    />
                    {nameWarningIndex === index && (
                      <div className="absolute -top-8 left-0 bg-red-600 text-white text-xs px-2 py-1 rounded shadow whitespace-nowrap">
                        Max 16 characters
                        <div className="absolute left-3 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-red-600" />
                      </div>
                    )}
                  </div>
                  <div className="flex rounded-lg overflow-hidden border border-emerald-500">
                    <button
                      onClick={() => handlePlayerTypeChange(index, false)}
                      className={`px-3 py-2 text-sm font-medium transition-all ${
                        !player.isAI
                          ? 'bg-emerald-500 text-white'
                          : 'bg-emerald-700 text-emerald-400 hover:bg-emerald-600'
                      }`}
                    >
                      Human
                    </button>
                    <button
                      onClick={() => handlePlayerTypeChange(index, true)}
                      className={`px-3 py-2 text-sm font-medium transition-all ${
                        player.isAI
                          ? 'bg-amber-500 text-emerald-900'
                          : 'bg-emerald-700 text-emerald-400 hover:bg-emerald-600'
                      }`}
                    >
                      AI
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Game Options */}
            <div>
              <button
                onClick={() => setShowOptions(!showOptions)}
                className="w-full flex items-center justify-between p-4 rounded-lg bg-emerald-700 hover:bg-emerald-600 transition-colors border border-emerald-500"
              >
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-amber-400" />
                  <span className="text-white font-medium">Game Options</span>
                </div>
                {showOptions ? (
                  <ChevronUp className="w-5 h-5 text-emerald-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-emerald-400" />
                )}
              </button>

              {showOptions && (
                <div className="mt-2 bg-emerald-700/40 rounded-lg p-4 space-y-5 border border-emerald-600">
                  {/* Special 9's Rule */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <span className="text-white font-medium text-sm">Special 9's Rule</span>
                      </div>
                      <p className="text-emerald-400 text-xs">
                        When enabled, if only the 9 of Diamonds is on the table and you have other 9s in hand, you may play up to 3 additional 9s on top, then optionally play another valid card or 4 of a kind before ending your turn.
                      </p>
                    </div>
                    <Toggle enabled={specialNinesRule} onToggle={() => setSpecialNinesRule(v => !v)} />
                  </div>

                  {/* Take All Cards */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <span className="text-white font-medium text-sm">Take All Cards</span>
                      </div>
                      <p className="text-emerald-400 text-xs">
                        When enabled, if you must take cards from the pile you may choose to take ALL cards (instead of just 3). The 9 of Diamonds is never taken. If fewer than 3 cards are available, you take whatever is above the 9 of Diamonds.
                      </p>
                    </div>
                    <Toggle enabled={allowTakeAllCards} onToggle={() => setAllowTakeAllCards(v => !v)} />
                  </div>

                  {/* 4 of a Kind Rule */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <span className="text-white font-medium text-sm">4 of a Kind Rule</span>
                      </div>
                      <p className="text-emerald-400 text-xs">
                        When enabled, you may play all 4 cards of the same value as a single move. After playing 4 of a kind, you may play another valid card (or another 4 of a kind) on top before ending your turn.
                      </p>
                    </div>
                    <Toggle enabled={fourOfAKindRule} onToggle={() => setFourOfAKindRule(v => !v)} />
                  </div>

                  {/* AI Difficulty */}
                  <div className="pt-2 border-t border-emerald-600/50">
                    <label className="text-sm font-medium text-emerald-300 mb-2 block">AI Difficulty</label>
                    <div className="grid grid-cols-3 gap-2">
                      {AI_DIFFICULTY_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setAiDifficulty(option.value)}
                          className={`p-2.5 rounded-lg text-left transition-all border ${
                            aiDifficulty === option.value
                              ? 'bg-amber-500 border-amber-400 text-emerald-900'
                              : 'bg-emerald-600 border-emerald-500 text-emerald-300 hover:bg-emerald-500'
                          }`}
                        >
                          <div className="font-semibold text-sm">{option.label}</div>
                          <div className={`text-xs mt-0.5 leading-tight ${aiDifficulty === option.value ? 'text-amber-800' : 'text-emerald-400'}`}>
                            {option.description}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Game Rules */}
            <div>
              <button
                onClick={() => setShowRules(!showRules)}
                className="w-full flex items-center justify-between p-4 rounded-lg bg-emerald-700 hover:bg-emerald-600 transition-colors border border-emerald-500"
              >
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-amber-400" />
                  <span className="text-white font-medium">Game Rules</span>
                </div>
                {showRules ? (
                  <ChevronUp className="w-5 h-5 text-emerald-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-emerald-400" />
                )}
              </button>

              {showRules && (
                <div className="mt-2 bg-emerald-700/40 rounded-lg p-4 space-y-2.5 border border-emerald-600">
                  {GAME_RULES.map((rule, index) => (
                    <div key={index} className="text-sm">
                      <span className="text-amber-400 font-medium">{rule.title}: </span>
                      <span className="text-emerald-200">{rule.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleStartGame}
              className="w-full py-4 text-lg font-bold bg-amber-500 hover:bg-amber-600 text-emerald-900 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Play className="w-5 h-5" />
              Start Game
            </button>
          </div>
        </div>
      </div>

      {showLeaderboard && <Leaderboard onClose={() => setShowLeaderboard(false)} />}
    </>
  );
}

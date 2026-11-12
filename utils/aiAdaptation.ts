import { type AIDifficulty } from '../types/game';
import { loadLeaderboard } from './leaderboard';

export interface HumanPerformanceSummary {
  games: number;
  winRate: number;
  averagePosition: number;
}

/**
 * Summarize the human results recorded on this device.
 *
 * Returns null when there is not enough data to adapt safely.
 */
export function getHumanPerformanceSummary(): HumanPerformanceSummary | null {
  const data = loadLeaderboard();
  const records = data.records.filter(record => record.totalGames > 0);
  if (records.length === 0) return null;

  const games = records.reduce((total, record) => total + record.totalGames, 0);
  const wins = records.reduce((total, record) => total + record.wins, 0);
  const positions = records.reduce((total, record) => total + record.totalPosition, 0);

  if (games < 5) return null;

  return {
    games,
    winRate: wins / games,
    averagePosition: positions / games,
  };
}

/**
 * Adjust a chosen AI difficulty using recent human performance.
 *
 * The change is deliberately small: one level at a time. This keeps the game
 * challenging without making difficulty jumps feel arbitrary.
 */
export function getAdaptiveAIDifficulty(
  base: AIDifficulty,
  summary: HumanPerformanceSummary | null = getHumanPerformanceSummary(),
): AIDifficulty {
  if (!summary) return base;

  const strong = summary.winRate >= 0.55 || summary.averagePosition <= 2.2;
  const weak = summary.winRate <= 0.25 || summary.averagePosition >= 3.2;

  switch (base) {
    case 'easy':
      return strong ? 'medium' : 'easy';
    case 'medium':
      if (strong) return 'hard';
      if (weak) return 'easy';
      return 'medium';
    case 'hard':
      if (strong) return 'expert';
      if (weak) return 'medium';
      return 'hard';
    case 'expert':
      return weak ? 'hard' : 'expert';
  }
}

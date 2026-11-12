import { describe, expect, it } from 'vitest';
import { getAdaptiveAIDifficulty } from './aiAdaptation';
import type { HumanPerformanceSummary } from './aiAdaptation';

describe('getAdaptiveAIDifficulty', () => {
  it('does not change difficulty without enough data', () => {
    expect(getAdaptiveAIDifficulty('hard', null)).toBe('hard');
  });

  it('raises difficulty for strong human results', () => {
    const strong: HumanPerformanceSummary = { games: 10, winRate: 0.7, averagePosition: 1.8 };
    expect(getAdaptiveAIDifficulty('medium', strong)).toBe('hard');
    expect(getAdaptiveAIDifficulty('hard', strong)).toBe('expert');
  });

  it('lowers difficulty for weak human results', () => {
    const weak: HumanPerformanceSummary = { games: 10, winRate: 0.1, averagePosition: 3.8 };
    expect(getAdaptiveAIDifficulty('medium', weak)).toBe('easy');
    expect(getAdaptiveAIDifficulty('expert', weak)).toBe('hard');
  });

  it('never changes by more than one level', () => {
    const strong: HumanPerformanceSummary = { games: 10, winRate: 1, averagePosition: 1 };
    expect(getAdaptiveAIDifficulty('easy', strong)).toBe('medium');
  });
});

import { describe, expect, it } from 'vitest';
import { hasDuplicatePlayerNames, isPlayerNameTaken, playerNameKey } from './playerNames';

describe('playerNameKey', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(playerNameKey('  Bob ')).toBe('bob');
    expect(playerNameKey('BOB')).toBe('bob');
  });

  it('preserves inner spacing', () => {
    expect(playerNameKey('Big Bob')).toBe('big bob');
    expect(playerNameKey('BigBob')).toBe('bigbob');
  });
});

describe('hasDuplicatePlayerNames', () => {
  it('detects exact duplicates', () => {
    expect(hasDuplicatePlayerNames([{ name: 'Alice' }, { name: 'Alice' }])).toBe(true);
  });

  it('detects duplicates that differ only by case or padding', () => {
    expect(hasDuplicatePlayerNames([{ name: 'Alice' }, { name: ' alice ' }])).toBe(true);
  });

  it('allows unique names', () => {
    expect(hasDuplicatePlayerNames([{ name: 'Alice' }, { name: 'Bob' }])).toBe(false);
  });

  it('ignores blank names because they are rejected separately', () => {
    expect(hasDuplicatePlayerNames([{ name: '' }, { name: '   ' }])).toBe(false);
  });
});

describe('isPlayerNameTaken', () => {
  it('matches an existing participant regardless of case or padding', () => {
    expect(isPlayerNameTaken([{ name: 'Alice' }], ' ALICE ')).toBe(true);
  });

  it('does not match a new name or a blank name', () => {
    expect(isPlayerNameTaken([{ name: 'Alice' }], 'Bob')).toBe(false);
    expect(isPlayerNameTaken([{ name: 'Alice' }], '   ')).toBe(false);
  });
});

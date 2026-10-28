import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from './roomCode';

describe('room codes', () => {
  it('generates a code of the right length from the unambiguous alphabet', () => {
    const code = generateRoomCode(() => 0);

    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect(code).toBe('A'.repeat(ROOM_CODE_LENGTH));
    expect(isValidRoomCode(code)).toBe(true);
  });

  it('builds a different code from different random values', () => {
    const values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    let index = 0;
    const code = generateRoomCode(() => values[index++]);

    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect(isValidRoomCode(code)).toBe(true);
    expect(code).not.toBe('AAAAAA');
  });

  it('never uses characters that are easy to confuse', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[01IO]/);
  });

  it('accepts only six-character codes from the alphabet', () => {
    expect(isValidRoomCode('ABC234')).toBe(true);
    expect(isValidRoomCode('abc234')).toBe(false);
    expect(isValidRoomCode('ABC23')).toBe(false);
    expect(isValidRoomCode('ABC2345')).toBe(false);
    expect(isValidRoomCode('ABCI34')).toBe(false);
    expect(isValidRoomCode('ABC034')).toBe(false);
  });

  it('normalizes pasted codes and share links', () => {
    expect(normalizeRoomCode(' abc234 ')).toBe('ABC234');
    expect(normalizeRoomCode('https://bobby.example/join/abc-234')).toBe('ABC234');
    expect(normalizeRoomCode('abc 234')).toBe('ABC234');
  });
});

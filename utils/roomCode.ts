import type { RandomFn } from './deckUtils';

/** No 0/O or 1/I: room codes are read aloud and typed on phones. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export function generateRoomCode(rng: RandomFn = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Accept pasted share links and sloppy typing: ".../join/abc-234" becomes "ABC234". */
export function normalizeRoomCode(input: string): string {
  const trimmed = input.trim();
  const lastSegment = trimmed.split(/[/?#]/).filter(Boolean).pop() ?? trimmed;
  return lastSegment.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(input: string): boolean {
  return ROOM_CODE_PATTERN.test(input);
}

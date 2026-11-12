import { describe, expect, it } from 'vitest';
import { cycleOptionIndex } from './optionCarousel';

describe('cycleOptionIndex', () => {
  it('moves forward and wraps from the last item to the first', () => {
    expect(cycleOptionIndex(0, 'next', 4)).toBe(1);
    expect(cycleOptionIndex(3, 'next', 4)).toBe(0);
  });

  it('moves backward and wraps from the first item to the last', () => {
    expect(cycleOptionIndex(2, 'previous', 4)).toBe(1);
    expect(cycleOptionIndex(0, 'previous', 4)).toBe(3);
  });

  it('handles an empty list safely', () => {
    expect(cycleOptionIndex(0, 'next', 0)).toBe(0);
    expect(cycleOptionIndex(5, 'previous', 0)).toBe(0);
  });

  it('normalizes out-of-range indexes', () => {
    expect(cycleOptionIndex(7, 'next', 4)).toBe(0);
    expect(cycleOptionIndex(-1, 'previous', 4)).toBe(2);
  });
});

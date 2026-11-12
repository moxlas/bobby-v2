export type CarouselDirection = 'next' | 'previous';

/**
 * Move through a circular option list.
 *
 * The selector is intentionally cyclic so the first and last options are
 * equally easy to reach with either chevron or a swipe.
 */
export function cycleOptionIndex(
  current: number,
  direction: CarouselDirection,
  length: number,
): number {
  if (length <= 0) return 0;
  const normalizedCurrent = ((current % length) + length) % length;

  if (direction === 'next') {
    return (normalizedCurrent + 1) % length;
  }

  return (normalizedCurrent - 1 + length) % length;
}

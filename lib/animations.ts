/**
 * Hand-rolled micro-animations built on the Web Animations API.
 *
 * No animation library, and every helper is a no-op when the user asks the OS
 * for reduced motion. Animations use the individual `scale` / `translate`
 * properties where the element already has a Tailwind transform, so the class
 * transform keeps composing instead of being overwritten.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The top card of the pile bumps up as it lands. */
export function animatePileLand(element: Element | null): void {
  if (!element || prefersReducedMotion()) return;

  element.animate(
    [
      { scale: '1', translate: '0 0' },
      { scale: '1.06', translate: '0 -4px', offset: 0.45 },
      { scale: '1', translate: '0 0' },
    ],
    { duration: 280, easing: EASE_OUT },
  );
}

/** An error banner shakes to draw the eye. */
export function animateShake(element: Element | null): void {
  if (!element || prefersReducedMotion()) return;

  element.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)', offset: 0.15 },
      { transform: 'translateX(6px)', offset: 0.35 },
      { transform: 'translateX(-4px)', offset: 0.55 },
      { transform: 'translateX(4px)', offset: 0.75 },
      { transform: 'translateX(0)' },
    ],
    { duration: 360, easing: 'ease-in-out' },
  );
}

/** A dialog panel pops in when it mounts. */
export function animatePopIn(element: Element | null): void {
  if (!element || prefersReducedMotion()) return;

  element.animate(
    [
      { opacity: 0, transform: 'translateY(10px) scale(0.96)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ],
    { duration: 200, easing: EASE_OUT },
  );
}

/** Ref + mount animation for a dialog panel. */
export function usePopIn<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    animatePopIn(ref.current);
  }, []);

  return ref;
}

/** Ref + animation that re-runs whenever `cardId` changes (i.e. a new top card). */
export function usePileLand(cardId: string | undefined) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardId) return;
    animatePileLand(ref.current);
  }, [cardId]);

  return ref;
}

/**
 * Ref for a hand container; cards that appear after the first render slide in,
 * so a pickup visibly fills the hand instead of popping into it.
 *
 * `ownerKey` resolves to the seat whose hand is on screen. When it changes the
 * new hand is adopted silently: swapping from one player's hand to the next
 * must not look like a full-hand pickup.
 */
export function useHandArrivals<T extends HTMLElement = HTMLDivElement>(
  cards: Array<{ id: string }>,
  ownerKey?: string | number | null,
  /** Skip the arrival animation, e.g. while a pickup is already being revealed. */
  animate = true,
) {
  const ref = useRef<T>(null);
  const seenRef = useRef<Set<string> | null>(null);
  const ownerRef = useRef<string | number | null | undefined>(ownerKey);
  const cardKey = cards.map(card => card.id).join('|');

  useLayoutEffect(() => {
    const ids = cards.map(card => card.id);

    if (seenRef.current === null || ownerRef.current !== ownerKey) {
      ownerRef.current = ownerKey;
      seenRef.current = new Set(ids);
      return;
    }

    if (!animate || prefersReducedMotion()) {
      seenRef.current = new Set(ids);
      return;
    }

    const nodes = new Map<string, HTMLElement>();
    ref.current?.querySelectorAll<HTMLElement>('[data-card-id]').forEach(node => {
      const id = node.dataset.cardId;
      if (id) nodes.set(id, node);
    });

    let index = 0;
    for (const id of ids) {
      if (seenRef.current.has(id)) continue;
      const node = nodes.get(id);
      if (!node) continue;
      node.animate(
        [
          { opacity: 0, transform: 'translateY(18px) scale(0.82)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ],
        { duration: 260, delay: index * 45, easing: EASE_OUT },
      );
      index += 1;
    }

    seenRef.current = new Set(ids);
    // cardKey identifies the hand; the array itself is rebuilt every render.
  }, [cardKey, ownerKey, animate]);

  return ref;
}

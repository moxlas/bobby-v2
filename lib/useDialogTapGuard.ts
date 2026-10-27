import { useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

/**
 * Keep dialog buttons responsive while still ignoring "ghost" clicks.
 *
 * A card swipe/drag can leave a compatibility click behind. When that click
 * lands where a dialog has just appeared, the browser would target the newly
 * mounted button even though the interaction started on the board. Ignoring
 * clicks that were not preceded by a pointerdown inside the dialog prevents
 * that accidental activation without ever swallowing a real tap: every real
 * tap starts with a pointerdown on the dialog itself.
 *
 * Keyboard activation (`detail === 0`) is always allowed.
 */
export function useDialogTapGuard() {
  const pointerStartedInside = useRef(false);

  const onPointerDownCapture = () => {
    pointerStartedInside.current = true;
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    // Without pointer events there is no pointerdown to gate on, so never block.
    const pointerEventsSupported = typeof window !== 'undefined' && 'PointerEvent' in window;
    if (pointerEventsSupported && event.detail > 0 && !pointerStartedInside.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    pointerStartedInside.current = false;
  };

  return { onPointerDownCapture, onClickCapture };
}

import { useLayoutEffect, useRef } from 'react';
import { Card as CardType } from '../types/game';
import { Card } from './Card';
import { prefersReducedMotion } from '../lib/animations';

export interface CardFlightRequest {
  id: number;
  direction: 'toPile' | 'toHand';
  cards: CardType[];
  from: DOMRect[];
  to: DOMRect;
}

interface CardFlightProps {
  request: CardFlightRequest;
  onComplete: () => void;
}

const FLIGHT_DURATION = 380;
const FLIGHT_STAGGER = 55;

/**
 * Ghost cards that fly between two measured rectangles.
 *
 * GameBoard mounts this overlay with the source/target rects captured before
 * the state update, so the ghost covers the instant move of the real card.
 */
export function CardFlight({ request, onComplete }: CardFlightProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const nodes = Array.from(layer.children) as HTMLElement[];
    if (nodes.length === 0 || prefersReducedMotion()) {
      completeRef.current();
      return;
    }

    const animations: Animation[] = [];
    let remaining = nodes.length;

    nodes.forEach((node, index) => {
      const natural = node.getBoundingClientRect();
      const from = request.from[index] ?? request.from[request.from.length - 1];
      const { to } = request;

      if (!from || natural.width === 0 || natural.height === 0) {
        remaining -= 1;
        return;
      }

      const startScale = from.width / natural.width;
      const maxEndScale = request.direction === 'toPile' ? 1.25 : 1;
      const endScale = Math.max(0.45, Math.min(to.width / natural.width, maxEndScale));

      const fromX = from.left + from.width / 2;
      const fromY = from.top + from.height / 2;
      const toX = to.left + to.width / 2;
      const toY = to.top + to.height / 2;
      const dx = toX - fromX;
      const dy = toY - fromY;

      node.style.left = `${fromX - natural.width / 2}px`;
      node.style.top = `${fromY - natural.height / 2}px`;
      node.style.transform = `scale(${startScale})`;
      node.style.opacity = '1';

      const tilt = request.direction === 'toPile' ? '-5deg' : '5deg';
      const animation = node.animate(
        [
          { transform: `translate(0px, 0px) scale(${startScale}) rotate(0deg)`, opacity: 1 },
          {
            transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 22}px) scale(${(startScale + endScale) / 2}) rotate(${tilt})`,
            opacity: 1,
            offset: 0.55,
          },
          {
            transform: `translate(${dx}px, ${dy}px) scale(${endScale}) rotate(0deg)`,
            opacity: request.direction === 'toPile' ? 0.15 : 0.35,
          },
        ],
        {
          duration: FLIGHT_DURATION,
          delay: index * FLIGHT_STAGGER,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards',
        },
      );

      animations.push(animation);
      animation.onfinish = () => {
        node.style.visibility = 'hidden';
        remaining -= 1;
        if (remaining === 0) completeRef.current();
      };
    });

    if (remaining === 0) completeRef.current();

    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [request.id]);

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      data-card-flight="true"
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
    >
      {request.cards.map((card, index) => (
        <div key={`${card.id}-${index}`} className="absolute opacity-0">
          <Card card={{ ...card, faceUp: true }} size="md" />
        </div>
      ))}
    </div>
  );
}

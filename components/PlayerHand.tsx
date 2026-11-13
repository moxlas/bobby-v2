import { Card as CardType } from '../types/game';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Card } from './Card';
import { sortHand } from '../utils/deckUtils';
import { useHandArrivals } from '../lib/animations';

interface PlayerHandProps {
  hand: CardType[];
  selectedCards: CardType[];
  onCardSelect: (card: CardType) => void;
  onCardPointerDown?: (card: CardType, event: ReactPointerEvent<HTMLDivElement>) => void;
  draggingCardId?: string;
  disabled?: boolean;
  faceUp?: boolean;
  /** Cards currently flying as ghosts; keep their slots but hide the faces. */
  hiddenCardIds?: Set<string> | null;
  /** Seat whose hand this is; stops arrivals from replaying on hand swaps. */
  ownerId?: number | null;
  /** Animate cards that arrive after the first render. */
  animateArrivals?: boolean;
}

export function PlayerHand({
  hand,
  selectedCards,
  onCardSelect,
  onCardPointerDown,
  draggingCardId,
  disabled,
  faceUp = true,
  hiddenCardIds,
  ownerId,
  animateArrivals = true,
}: PlayerHandProps) {
  const sortedHand = sortHand(hand);
  const handRef = useHandArrivals<HTMLDivElement>(hand, ownerId, animateArrivals);

  return (
    <div ref={handRef} className="flex flex-wrap gap-2 justify-center max-w-5xl mx-auto">
      {sortedHand.map((card) => (
        <Card
          key={card.id}
          card={{ ...card, faceUp }}
          onClick={() => onCardSelect(card)}
          onPointerDown={disabled || !faceUp ? undefined : event => onCardPointerDown?.(card, event)}
          isSelected={faceUp && selectedCards.some(c => c.id === card.id)}
          isDragging={draggingCardId === card.id}
          disabled={disabled || !faceUp}
          hidden={hiddenCardIds?.has(card.id) ?? false}
          size="md"
        />
      ))}
    </div>
  );
}

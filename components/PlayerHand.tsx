import { Card as CardType } from '../types/game';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Card } from './Card';
import { sortHand } from '../utils/deckUtils';

interface PlayerHandProps {
  hand: CardType[];
  selectedCards: CardType[];
  onCardSelect: (card: CardType) => void;
  onCardPointerDown?: (card: CardType, event: ReactPointerEvent<HTMLDivElement>) => void;
  draggingCardId?: string;
  disabled?: boolean;
  faceUp?: boolean;
}

export function PlayerHand({ hand, selectedCards, onCardSelect, onCardPointerDown, draggingCardId, disabled, faceUp = true }: PlayerHandProps) {
  const sortedHand = sortHand(hand);

  return (
    <div className="flex flex-wrap gap-2 justify-center max-w-5xl mx-auto">
      {sortedHand.map((card) => (
        <Card
          key={card.id}
          card={{ ...card, faceUp }}
          onClick={() => onCardSelect(card)}
          onPointerDown={disabled || !faceUp ? undefined : event => onCardPointerDown?.(card, event)}
          isSelected={faceUp && selectedCards.some(c => c.id === card.id)}
          isDragging={draggingCardId === card.id}
          disabled={disabled || !faceUp}
          size="md"
        />
      ))}
    </div>
  );
}

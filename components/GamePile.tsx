import { Card as CardType } from '../types/game';
import { Card } from './Card';
import { useTranslation } from '../lib/i18n';

interface GamePileProps {
  pile: CardType[];
}

export function GamePile({ pile }: GamePileProps) {
  const { t } = useTranslation();
  const visibleCount = Math.min(3, pile.length);
  const visibleCards = pile.slice(-visibleCount);
  const topCard = pile[pile.length - 1];

  if (pile.length === 0) {
    return (
      <div className="relative flex flex-col items-center">
        <div className="w-24 h-32 border-2 border-dashed border-emerald-500 rounded-lg flex items-center justify-center">
          <span className="text-emerald-400 text-sm">{t('pile.empty')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center">
      <div className="mt-0 mb-3 bg-emerald-700 px-3 py-1.5 rounded-full text-emerald-200 text-base whitespace-nowrap">
        {t('pile.count', { count: pile.length, s: pile.length !== 1 ? 's' : '' })}
      </div>

      <div className="relative h-36 sm:h-40 flex items-center justify-center -translate-x-12 translate-y-1">
        {visibleCards.map((card, index) => {
          const totalWidth = (visibleCount - 1) * 16;
          const offsetX = index * 16 - totalWidth / 2;
          const offsetY = index * -3;

          return (
            <div
              key={card.id}
              className="absolute transition-all duration-200"
              style={{ left: `${offsetX}px`, top: `${offsetY}px`, zIndex: index + 1 }}
            >
              <Card card={{ ...card, faceUp: true }} size="lg" />
            </div>
          );
        })}
      </div>

      <div className="mt-3 mb-2 text-center">
        <span className="text-emerald-300 text-xs">{t('pile.top')}</span>
        <span className="text-amber-300 font-bold text-sm">
          {t('card.format', { value: t(`card.value.${topCard.value}`), suit: t(`card.suit.${topCard.suit}`) })}
        </span>
      </div>
    </div>
  );
}

import { Card as CardType } from '../types/game';
import { Card } from './Card';
import { useTranslation } from '../lib/i18n';

interface GamePileProps {
  pile: CardType[];
  onTakeClick?: () => void;
}

export function GamePile({ pile, onTakeClick }: GamePileProps) {
  const { t } = useTranslation();
  const visibleCount = Math.min(3, pile.length);
  const visibleCards = pile.slice(-visibleCount);
  const topCard = pile[pile.length - 1];
  const clickable = pile.length > 1 && onTakeClick;

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
    <div
      className={`relative flex flex-col items-center ${clickable ? 'cursor-pointer' : ''}`}
      onClick={clickable ? onTakeClick : undefined}
    >
      <div className={`mt-0 mb-3 px-3 py-1.5 rounded-full text-base whitespace-nowrap ${clickable ? 'bg-amber-600 text-amber-100 hover:bg-amber-500 transition-colors' : 'bg-emerald-700 text-emerald-200'}`}>
        {t(pile.length === 1 ? 'pile.count_one' : 'pile.count_other', { count: pile.length })}
      </div>

      <div className="relative h-36 sm:h-40 flex items-center justify-center -translate-x-12 translate-y-1">
        {visibleCards.map((card, index) => {
          const totalWidth = (visibleCount - 1) * 16;
          const offsetX = index * 16 - totalWidth / 2;
          const offsetY = index * -3;

          return (
            <div
              key={card.id}
              className={`absolute transition-all duration-200 ${clickable ? 'hover:-translate-y-2' : ''}`}
              style={{ left: `${offsetX}px`, top: `${offsetY}px`, zIndex: index + 1 }}
            >
              <Card card={{ ...card, faceUp: true }} size="lg" />
            </div>
          );
        })}
      </div>

      <div className="mt-3 mb-2 text-center">
        <div className="text-emerald-300 text-xs">{t('pile.top')}</div>
        <div className="text-amber-300 font-bold text-sm">
          {t('card.format', { value: t(`card.value.${topCard.value}`), suit: t(`card.suit.${topCard.suit}`) })}
        </div>
      </div>
    </div>
  );
}

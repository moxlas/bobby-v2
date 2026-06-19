import { Card as CardType } from '../types/game';

interface CardProps {
  card: CardType;
  onClick?: () => void;
  isSelected?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const SUIT_COLORS: Record<string, string> = {
  hearts: 'text-red-500',
  diamonds: 'text-red-500',
  clubs: 'text-gray-900',
  spades: 'text-gray-900',
};

const VALUE_DISPLAY: Record<number, string> = {
  9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

function renderCenter(card: CardType, suitSymbol: string, suitColor: string, size: string) {
  const v = card.value;
  const isLg = size === 'lg';
  const pipSize = isLg ? 'text-lg' : 'text-sm';
  const rowW = isLg ? 'w-11' : 'w-9';
  const symCls = `${suitColor} ${pipSize} leading-none`;

  if (v === 14) {
    return <div className={`text-4xl leading-none ${suitColor}`}>{suitSymbol}</div>;
  }

  if (v === 9) {
    return (
      <div className={`flex flex-col items-center gap-0 ${suitColor}`}>
        {[[0,0],[0,0],[0],[0,0],[0,0]].map((row, ri) => (
          <div key={ri} className={`flex ${row.length === 1 ? 'justify-center' : 'justify-between'} ${rowW}`}>
            {row.map((_, ci) => <span key={ci} className={symCls}>{suitSymbol}</span>)}
          </div>
        ))}
      </div>
    );
  }

  if (v === 10) {
    return (
      <div className={`flex flex-col items-center gap-0 ${suitColor}`}>
        {[[0,0],[0],[0,0],[0,0],[0],[0,0]].map((row, ri) => (
          <div key={ri} className={`flex ${row.length === 1 ? 'justify-center' : 'justify-between'} ${rowW}`}>
            {row.map((_, ci) => <span key={ci} className={symCls}>{suitSymbol}</span>)}
          </div>
        ))}
      </div>
    );
  }

  if (v === 11 || v === 12 || v === 13) {
    const color = suitColor;
    const suit = card.suit;

    // Shared facial features
    const face = (
      <>
        <ellipse cx="34" cy="28" rx="12" ry="16" transform="rotate(-4, 34, 28)" />
        <polygon points="22,26 11,30 22,34" />
        <rect x="30" y="44" width="7" height="8" rx="2" />
        <circle cx="23" cy="24" r="1.2" />
        <ellipse cx="23" cy="26" rx="0.6" ry="0.4" transform="rotate(-10, 23, 26)" />
        <path d="M 20 21 Q 23 19 26 21" fill="none" stroke="currentColor" strokeWidth="0.6" />
        <path d="M 18 35 Q 21 37 24 35" fill="none" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" />
        <path d="M 24 36 Q 28 44 34 46" fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.6" />
        <path d="M 14 30 Q 16 31 18 30" fill="none" stroke="currentColor" strokeWidth="0.4" />
      </>
    );

    // Shoulder styles
    const shoulderPaths: Record<string, string> = {
      hearts: 'M 8 56 Q 30 52 52 56 Q 54 72 30 76 Q 6 72 8 56 Z',
      diamonds: 'M 10 56 L 48 58 L 52 72 L 30 78 L 6 74 Z',
      clubs: 'M 4 56 Q 30 50 56 56 Q 60 74 30 78 Q 0 74 4 56 Z',
      spades: 'M 12 56 L 50 56 L 54 74 L 30 76 L 4 72 Z',
    };

    // King suit-specific details
    const kingData: Record<string, {
      crown: string; band: string; beard: string; cross?: string; jewel?: string
    }> = {
      hearts: {
        crown: '18,18 15,6 23,12 30,4 37,12 45,6 42,18',
        band: 'M 18 17 h 24',
        beard: 'M 22 42 Q 26 56 34 50 Q 28 48 26 42 Z',
        cross: 'M 28 6 v 6 M 25 9 h 6',
        jewel: 'M 23 12 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0 M 37 12 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0',
      },
      diamonds: {
        crown: '18,18 14,6 24,10 30,2 36,10 44,6 42,18',
        band: 'M 18 17 h 24',
        beard: 'M 22 42 L 28 54 L 32 46 Z',
        jewel: 'M 24 10 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0 M 36 10 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0',
      },
      clubs: {
        crown: '18,18 14,8 20,4 26,10 30,2 34,10 40,4 46,8 42,18',
        band: 'M 18 17 h 24',
        beard: 'M 22 42 Q 26 58 34 52 Q 28 48 22 42 Z',
        cross: 'M 28 2 v 8',
        jewel: 'M 20 4 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0 M 40 4 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0',
      },
      spades: {
        crown: '18,18 14,8 20,4 26,10 30,0 34,10 40,4 46,8 42,18',
        band: 'M 18 17 h 24',
        beard: 'M 22 42 L 28 52 L 34 44 Z',
        jewel: 'M 20 4 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0 M 40 4 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0',
      },
    };

    // Queen suit-specific details
    const queenData: Record<string, { crown: string; band: string; hair: string; jewel?: string }> = {
      hearts: {
        crown: '18,18 16,8 23,13 30,6 37,13 44,8 42,18',
        band: 'M 18 17 h 24',
        hair: 'M 42 14 Q 52 18 50 34 Q 48 50 54 56 Q 50 58 46 48 Q 48 34 46 24 Z',
        jewel: 'M 30 6 m -1.5 0 a 1.5 1.5 0 1 0 3 0 a 1.5 1.5 0 1 0 -3 0',
      },
      diamonds: {
        crown: '18,18 14,8 22,12 30,4 38,12 46,8 42,18',
        band: 'M 18 17 h 24',
        hair: 'M 42 12 L 52 30 L 48 50 L 54 56 L 44 44 L 46 22 Z',
        jewel: 'M 30 4 m -1.5 0 a 1.5 1.5 0 1 0 3 0 a 1.5 1.5 0 1 0 -3 0',
      },
      clubs: {
        crown: '18,18 16,8 22,10 26,4 30,6 34,4 38,10 44,8 42,18',
        band: 'M 18 17 h 24',
        hair: 'M 42 12 Q 54 20 52 38 Q 50 54 56 58 Q 52 56 48 46 Q 50 30 46 18 Z',
        jewel: 'M 30 6 m -1.5 0 a 1.5 1.5 0 1 0 3 0 a 1.5 1.5 0 1 0 -3 0',
      },
      spades: {
        crown: '18,18 14,10 20,6 26,12 30,2 34,12 40,6 46,10 42,18',
        band: 'M 18 17 h 24',
        hair: 'M 40 12 L 54 28 L 50 48 L 56 56 L 46 42 L 44 20 Z',
        jewel: 'M 30 2 m -1.5 0 a 1.5 1.5 0 1 0 3 0 a 1.5 1.5 0 1 0 -3 0',
      },
    };

    // Jack suit-specific details
    const jackData: Record<string, { hat: string; hatTop?: string; collar: string; detail?: string }> = {
      hearts: {
        hat: 'M 18 22 Q 30 10 44 16 L 44 20 Q 30 14 18 22 Z',
        hatTop: 'M 38 14 Q 48 14 50 22 L 48 24 Q 46 16 38 14 Z',
        collar: 'M 22 54 L 26 62 L 30 56 L 34 62 L 38 54 Z',
        detail: 'M 30 56 L 30 62',
      },
      diamonds: {
        hat: 'M 18 20 L 40 8 L 44 18 L 44 20 L 20 24 Z',
        collar: 'M 22 54 L 28 64 L 30 56 L 34 64 L 38 54 Z',
        detail: 'M 30 56 L 30 64',
      },
      clubs: {
        hat: 'M 16 24 Q 30 8 46 18 L 44 22 Q 30 12 18 22 Z',
        hatTop: 'M 36 12 Q 44 10 48 18 L 46 20 Q 42 14 36 12 Z',
        collar: 'M 20 54 L 26 64 L 30 56 L 34 64 L 40 54 Z',
        detail: 'M 30 56 L 30 64',
      },
      spades: {
        hat: 'M 20 18 L 40 6 L 46 20 L 44 22 L 38 12 L 22 20 Z',
        collar: 'M 24 54 L 28 62 L 30 56 L 34 62 L 36 54 Z',
        detail: 'M 30 56 L 30 62',
      },
    };

    return (
      <svg viewBox="0 0 60 80" fill="currentColor" className={`w-3/5 h-3/5 ${color}`}>
        {face}
        <path d={shoulderPaths[suit]} />

        {v === 13 && (
          <>
            <polygon points={kingData[suit].crown} />
            <path d={kingData[suit].band} />
            <path d={kingData[suit].beard} />
            {kingData[suit].cross && <path d={kingData[suit].cross} />}
            {kingData[suit].jewel && <path d={kingData[suit].jewel} />}
          </>
        )}

        {v === 12 && (
          <>
            <polygon points={queenData[suit].crown} />
            <path d={queenData[suit].band} />
            <path d={queenData[suit].hair} />
            {queenData[suit].jewel && <path d={queenData[suit].jewel} />}
          </>
        )}

        {v === 11 && (
          <>
            <path d={jackData[suit].hat} />
            {jackData[suit].hatTop && <path d={jackData[suit].hatTop} />}
            <path d={jackData[suit].collar} />
            {jackData[suit].detail && <path d={jackData[suit].detail} fill="none" stroke="currentColor" strokeWidth="0.5" />}
          </>
        )}
      </svg>
    );
  }

  return <div className={`text-lg ${suitColor}`}>{suitSymbol}</div>;
}

export function Card({ card, onClick, isSelected, disabled, size = 'md' }: CardProps) {
  const sizeClasses = {
    sm: 'w-16 h-24',
    md: 'w-20 h-28',
    lg: 'w-24 h-32',
  };

  const suitSymbol = SUIT_SYMBOLS[card.suit] || '?';
  const suitColor = SUIT_COLORS[card.suit] || 'text-gray-900';
  const valueDisplay = VALUE_DISPLAY[card.value] || String(card.value);

  if (!card.faceUp) {
    return (
      <div
        className={`${sizeClasses[size]} bg-blue-600 rounded-lg border-2 border-blue-400 flex items-center justify-center cursor-pointer shadow-md ${disabled ? 'opacity-50' : ''}`}
        onClick={onClick}
      >
        <div className="w-10 h-14 bg-blue-500 rounded border border-blue-300" />
      </div>
    );
  }

  const isLg = size === 'lg';
  const cornerValCls = isLg ? 'text-base' : 'text-sm';
  const cornerSuitCls = isLg ? 'text-sm' : 'text-xs';
  const topCorner = isLg ? 'top-1 left-1.5' : 'top-0.5 left-1';
  const btmCorner = isLg ? 'bottom-1 right-1.5' : 'bottom-0.5 right-1';

  return (
    <div
      className={`${sizeClasses[size]} relative bg-white rounded-lg border-2 ${isSelected ? 'border-amber-400 ring-2 ring-amber-300' : 'border-gray-300'} cursor-pointer shadow-md hover:shadow-lg transition-shadow ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      onClick={disabled ? undefined : onClick}
    >
      <div className={`absolute ${topCorner} z-10 ${cornerValCls} font-bold ${suitColor} leading-none`}>
        <div>{valueDisplay}</div>
        <div className={cornerSuitCls}>{suitSymbol}</div>
      </div>
      <div className={`absolute ${btmCorner} z-10 ${cornerValCls} font-bold ${suitColor} rotate-180 leading-none`}>
        <div>{valueDisplay}</div>
        <div className={cornerSuitCls}>{suitSymbol}</div>
      </div>
      <div className="flex items-center justify-center w-full h-full">
        {renderCenter(card, suitSymbol, suitColor, size)}
      </div>
    </div>
  );
}

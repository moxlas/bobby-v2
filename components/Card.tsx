import { Card as CardType } from '../types/game';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface CardProps {
  card: CardType;
  onClick?: () => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  isSelected?: boolean;
  isDragging?: boolean;
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
    return (
      <div className={`relative flex ${isLg ? 'h-[72%] w-[72%]' : 'h-[68%] w-[68%]'} items-center justify-center ${suitColor}`}>
        <span aria-hidden="true" className="absolute inset-0 rounded-full border border-current/20" />
        <span aria-hidden="true" className="absolute inset-[12%] rotate-45 rounded-[22%] border border-current/15" />
        <span aria-hidden="true" className="absolute inset-[22%] rounded-full border border-current/15" />
        <span className={`relative drop-shadow-sm ${isLg ? 'text-5xl' : 'text-4xl'} leading-none`}>{suitSymbol}</span>
      </div>
    );
  }

  if (v === 9 || v === 10) {
    const rows = v === 9 ? [2, 2, 1, 2, 2] : [2, 1, 2, 2, 1, 2];
    return (
      <div className={`flex ${isLg ? 'h-[74%] w-12' : 'h-[70%] w-9'} flex-col items-center justify-around ${suitColor}`}>
        {rows.map((pipCount, ri) => (
          <div key={ri} className={`flex items-center ${pipCount === 1 ? 'justify-center' : 'justify-between'} ${rowW}`}>
            {Array.from({ length: pipCount }, (_, ci) => (
              <span key={ci} className={`${symCls} ${ri >= Math.ceil(rows.length / 2) ? 'rotate-180' : ''}`}>
                {suitSymbol}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (v === 11 || v === 12 || v === 13) {
    const color = suitColor;
    const suit = card.suit;
    const portraitInk = '#392b31';
    const portraitGold = '#d3a34d';
    const gemColor = suit === 'hearts' || suit === 'diamonds' ? '#c83b52' : suit === 'clubs' ? '#2e8a68' : '#4275b5';

    // Layered portrait base: warm skin, dark hair, and fine readable features.
    const face = (
      <>
        <path d="M 28 42 L 27 56 L 36 56 L 35 42 Z" fill="#dca77e" stroke={portraitInk} strokeWidth="0.8" />
        <g transform="translate(-3.6 -3.6) scale(1.12)">
          <path d="M 21 30 C 18 16 26 8 37 9 C 48 10 50 21 46 34 L 43 43 L 24 43 Z" fill="#493438" stroke={portraitInk} strokeWidth="1" />
          <path d="M 23 25 C 24 16 31 13 38 15 C 44 17 46 23 44 31 L 42 38 C 40 45 35 49 30 46 C 25 44 22 37 22 31 Z" fill="#f0c69e" stroke={portraitInk} strokeWidth="0.9" />
          <path d="M 23 27 C 24 19 30 16 37 16 C 32 19 29 22 25 24 Z" fill="#493438" />
          <path d="M 23 27 Q 27 24 30 26" fill="none" stroke={portraitInk} strokeWidth="1.1" strokeLinecap="round" />
          <path d="M 34 25 Q 37 23.5 40 25" fill="none" stroke={portraitInk} strokeWidth="1.1" strokeLinecap="round" />
          <path d="M 24.5 29 Q 27 27 30 29 M 35 28 Q 37 26.5 39 28" fill="none" stroke={portraitInk} strokeWidth="0.9" strokeLinecap="round" />
          <circle cx="28" cy="29" r="0.8" fill={portraitInk} />
          <circle cx="37" cy="28" r="0.8" fill={portraitInk} />
          <path d="M 32 29 C 31 33 29 35 31 36 L 34 36" fill="none" stroke="#a45e4e" strokeWidth="0.9" strokeLinecap="round" />
          <path d="M 29 40 Q 32 41.5 35 39.5" fill="none" stroke="#8e4350" strokeWidth="0.9" strokeLinecap="round" />
          <path d="M 26 36 Q 27 37 28 36" fill="none" stroke="#d89b7f" strokeWidth="0.7" strokeLinecap="round" />
        </g>
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
      crown: string; band: string; beard: string; moustache: string; cross?: string; jewel?: string
    }> = {
      hearts: {
        crown: '18,18 15,6 23,12 30,4 37,12 45,6 42,18',
        band: 'M 18 17 h 24',
        beard: 'M 24 44 Q 31 47 42 43 L 39 50 Q 34 55 29 52 Q 25 49 24 44 Z',
        moustache: 'M 28 37 Q 31 35 33 37 Q 36 35 39 37 Q 37 41 34 39 Q 31 41 28 37 Z',
        cross: 'M 28 6 v 6 M 25 9 h 6',
        jewel: 'M 23 12 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0 M 37 12 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0',
      },
      diamonds: {
        crown: '18,18 14,6 24,10 30,2 36,10 44,6 42,18',
        band: 'M 18 17 h 24',
        beard: 'M 24 44 Q 31 46 42 43 L 38 50 L 32 54 L 27 50 Z',
        moustache: 'M 28 37 Q 31 35 33 37 Q 36 35 39 37 Q 37 40 34 39 Q 31 40 28 37 Z',
        jewel: 'M 24 10 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0 M 36 10 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0',
      },
      clubs: {
        crown: '18,18 14,8 20,4 26,10 30,2 34,10 40,4 46,8 42,18',
        band: 'M 18 17 h 24',
        beard: 'M 24 44 Q 32 47 42 43 L 40 50 Q 35 56 30 53 Q 25 50 24 44 Z',
        moustache: 'M 27 37 Q 31 35 33 37 Q 36 35 40 37 Q 37 41 34 39 Q 30 41 27 37 Z',
        cross: 'M 28 2 v 8',
        jewel: 'M 20 4 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0 M 40 4 m -1 0 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0',
      },
      spades: {
        crown: '18,18 14,8 20,4 26,10 30,0 34,10 40,4 46,8 42,18',
        band: 'M 18 17 h 24',
        beard: 'M 24 44 Q 32 47 42 43 L 38 50 L 33 54 L 27 50 Z',
        moustache: 'M 28 37 Q 31 35 33 37 Q 36 35 39 37 Q 37 40 34 39 Q 31 40 28 37 Z',
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
      <svg viewBox="0 0 60 80" className={`w-[78%] h-[82%] -translate-x-1 overflow-visible ${color}`} aria-hidden="true">
        <path d={shoulderPaths[suit]} fill="currentColor" stroke={portraitInk} strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M 18 56 L 26 54 L 30 62 L 34 54 L 42 56 L 50 78 L 10 78 Z" fill="#eee4d1" stroke={portraitInk} strokeWidth="1" strokeLinejoin="round" />
        <path d="M 18 57 L 26 56 L 30 63 L 24 77 L 12 77 Z M 42 57 L 34 56 L 30 63 L 36 77 L 48 77 Z" fill="currentColor" />
        <path d="M 26 55 L 30 63 L 34 55 M 30 63 L 30 77" fill="none" stroke={portraitGold} strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="30" cy="68" r="1.5" fill={gemColor} stroke={portraitGold} strokeWidth="0.7" />
        <circle cx="30" cy="74" r="1.2" fill={portraitGold} />
        {face}

        {v === 13 && (
          <>
            <path d={kingData[suit].beard} fill="#493438" stroke={portraitInk} strokeWidth="0.8" strokeLinejoin="round" />
            <path d={kingData[suit].moustache} fill="#493438" stroke={portraitInk} strokeWidth="0.55" strokeLinejoin="round" />
            <path d="M 30 42 Q 33 44 36 42" fill="none" stroke="#d98978" strokeWidth="1.2" strokeLinecap="round" />
            <g transform="translate(4 -3)">
              <polygon points={kingData[suit].crown} fill={portraitGold} stroke="#79572b" strokeWidth="0.9" strokeLinejoin="round" />
              <path d={kingData[suit].band} fill="none" stroke="#79572b" strokeWidth="1.3" />
              {kingData[suit].cross && <path d={kingData[suit].cross} fill="none" stroke="#fff0c6" strokeWidth="1" strokeLinecap="round" />}
              {kingData[suit].jewel && <path d={kingData[suit].jewel} fill={gemColor} stroke="#fff0c6" strokeWidth="0.35" />}
            </g>
          </>
        )}

        {v === 12 && (
          <>
            <path d={queenData[suit].hair} fill="#493438" stroke={portraitInk} strokeWidth="0.9" strokeLinejoin="round" />
            <path d="M 45 27 Q 49 34 45 43" fill="none" stroke="#b98658" strokeWidth="0.7" />
            <circle cx="44" cy="38" r="1.3" fill={gemColor} stroke={portraitGold} strokeWidth="0.6" />
            <g transform="translate(4 -3)">
              <polygon points={queenData[suit].crown} fill={portraitGold} stroke="#79572b" strokeWidth="0.9" strokeLinejoin="round" />
              <path d={queenData[suit].band} fill="none" stroke="#79572b" strokeWidth="1.3" />
              {queenData[suit].jewel && <path d={queenData[suit].jewel} fill={gemColor} stroke="#fff0c6" strokeWidth="0.35" />}
            </g>
          </>
        )}

        {v === 11 && (
          <>
            <path d="M 25 37.5 C 27.5 34.5 30.5 35 33 37 C 35.5 35 38.5 34.5 41 37.5 C 39 40 36.5 40 33 38.5 C 29.5 40 27 40 25 37.5 Z" fill="#493438" stroke={portraitInk} strokeWidth="0.7" strokeLinejoin="round" />
            <path d="M 29 41 Q 33 43 37 41 L 36 45 Q 34.5 48 33 49 Q 30.5 47 29 45 Z" fill="#493438" stroke={portraitInk} strokeWidth="0.65" strokeLinejoin="round" />
            <path d={jackData[suit].hat} fill="currentColor" stroke={portraitInk} strokeWidth="1" strokeLinejoin="round" />
            {jackData[suit].hatTop && <path d={jackData[suit].hatTop} fill="#493438" stroke={portraitInk} strokeWidth="0.8" />}
            <path d="M 22 20 Q 31 15 43 19" fill="none" stroke={portraitGold} strokeWidth="1.4" />
            <path d="M 39 17 C 45 13 47 8 44 4 C 52 8 52 15 45 21 Z" fill={gemColor} stroke={portraitInk} strokeWidth="0.8" strokeLinejoin="round" />
            <circle cx="31" cy="19" r="1.5" fill={portraitGold} />
            <path d={jackData[suit].collar} fill="#eee4d1" stroke={portraitInk} strokeWidth="0.8" strokeLinejoin="round" />
            {jackData[suit].detail && <path d={jackData[suit].detail} fill="none" stroke={portraitGold} strokeWidth="1" />}
          </>
        )}
      </svg>
    );
  }

  return <div className={`text-lg ${suitColor}`}>{suitSymbol}</div>;
}

export function Card({ card, onClick, onPointerDown, isSelected, isDragging, disabled, size = 'md' }: CardProps) {
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
        className={`${sizeClasses[size]} relative flex items-center justify-center rounded-xl border-2 border-sky-100/80 bg-gradient-to-br from-indigo-600 via-blue-800 to-slate-950 shadow-[0_5px_12px_rgba(15,23,42,0.28)] ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
        data-card-id={card.id}
        onClick={disabled ? undefined : onClick}
      >
        <div aria-hidden="true" className="absolute inset-[4px] rounded-[9px] border border-sky-100/70" />
        <div aria-hidden="true" className="absolute inset-[8px] rounded-[6px] border border-sky-200/30" />
        <div aria-hidden="true" className="relative flex h-[68%] w-[62%] items-center justify-center rounded-md border border-sky-100/30 bg-sky-100/5">
          <span className="text-3xl font-serif text-sky-100/80">✦</span>
          <span className="absolute inset-[12%] rotate-45 border border-sky-100/30" />
        </div>
      </div>
    );
  }

  const isLg = size === 'lg';
  const cornerValCls = 'text-base';
  const cornerSuitCls = 'text-sm';
  const topCorner = isLg ? 'top-1 left-1.5' : 'top-0.5 left-1';
  const btmCorner = isLg ? 'bottom-1 right-1.5' : 'bottom-0.5 right-1';

  return (
      <div
        className={`${sizeClasses[size]} relative select-none rounded-xl border ${isSelected ? 'border-amber-400 ring-2 ring-amber-300' : 'border-slate-300'} bg-gradient-to-br from-white via-[#fffefa] to-[#f1eee6] shadow-[0_3px_8px_rgba(15,23,42,0.18)] transition-all duration-200 ${isDragging ? 'z-20 -translate-y-3 rotate-2 scale-105 shadow-xl' : ''} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:-translate-y-1 hover:shadow-[0_7px_14px_rgba(15,23,42,0.24)] active:translate-y-0'} ${!disabled && isSelected ? 'hover:-translate-y-1' : ''}`}
        data-card-id={card.id}
        onClick={disabled ? undefined : onClick}
        onPointerDown={disabled ? undefined : onPointerDown}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-[3px] rounded-[9px] border border-slate-200/80" />
      <div className={`absolute ${topCorner} z-10 ${cornerValCls} font-serif font-black ${suitColor} leading-none drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]`}>
        <div>{valueDisplay}</div>
        <div className={cornerSuitCls}>{suitSymbol}</div>
      </div>
      <div className={`absolute ${btmCorner} z-10 ${cornerValCls} font-serif font-black ${suitColor} rotate-180 leading-none drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]`}>
        <div>{valueDisplay}</div>
        <div className={cornerSuitCls}>{suitSymbol}</div>
      </div>
      <div className="flex items-center justify-center w-full h-full">
        {renderCenter(card, suitSymbol, suitColor, size)}
      </div>
    </div>
  );
}

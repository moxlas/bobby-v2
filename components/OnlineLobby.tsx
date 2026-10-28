import { useState } from 'react';
import { Check, Copy, Crown, LogOut, Minus, Play, Plus, Users, X, Zap } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { Toggle } from './SetupScreen';
import { buildShareUrl } from '../lib/onlineConfig';
import type { ClientMessage, RoomView } from '../types/online';
import type { GameRules } from '../types/game';

interface OnlineLobbyProps {
  room: RoomView;
  connected: boolean;
  send: (message: ClientMessage) => void;
  onLeave: () => void;
}

const RULE_KEYS: { key: keyof GameRules; label: string; description: string }[] = [
  { key: 'specialNinesRule', label: 'setup.option.specialNines.title', description: 'setup.option.specialNines.desc' },
  { key: 'allowTakeAllCards', label: 'setup.option.takeAll.title', description: 'setup.option.takeAll.desc' },
  { key: 'fourOfAKindRule', label: 'setup.option.fourOfAKind.title', description: 'setup.option.fourOfAKind.desc' },
];

export function OnlineLobby({ room, connected, send, onLeave }: OnlineLobbyProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const you = room.seats.find((seat) => seat.id === room.youId) ?? null;
  const isHost = you?.isHost ?? false;
  const humans = room.seats.filter((seat) => !seat.isAI).length;
  const aiCount = room.seats.filter((seat) => seat.isAI).length;
  const canAddAI = room.seats.length < room.maxSeats;
  const canRemoveAI = aiCount > 0;
  const canStart = room.seats.length >= room.minSeats;

  const copy = async (kind: 'code' | 'link') => {
    const value = kind === 'code' ? room.code : buildShareUrl(room.code);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1500);
    } catch {
      setCopied(null);
    }
  };

  const setRules = (next: GameRules) => send({ type: 'setRules', rules: next });

  const toggleRule = (key: keyof GameRules) => {
    setRules({ ...room.rules, [key]: !room.rules[key] });
  };

  return (
    <div className="min-h-[100dvh] bg-emerald-900 p-4">
      <div className="mx-auto w-full max-w-2xl space-y-4 py-2">
        <header className="rounded-xl border border-emerald-600 bg-emerald-800 p-4 text-center shadow-xl">
          <h1 className="flex items-center justify-center gap-2 text-xl font-bold text-amber-300">
            <Users className="w-5 h-5" />
            {t('online.lobby.title')}
          </h1>
          <p className="mt-1 text-sm text-emerald-300">
            {isHost ? t('online.lobby.hostHint') : t('online.lobby.guestHint')}
          </p>

          <div className="mt-4 rounded-lg border border-emerald-500 bg-emerald-900/60 p-3">
            <div className="text-xs uppercase tracking-wide text-emerald-400">{t('online.lobby.codeLabel')}</div>
            <div className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-amber-300">{room.code}</div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => copy('code')}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-600"
              >
                {copied === 'code' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied === 'code' ? t('online.lobby.copied') : t('online.lobby.copyCode')}
              </button>
              <button
                type="button"
                onClick={() => copy('link')}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-600"
              >
                {copied === 'link' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied === 'link' ? t('online.lobby.copied') : t('online.lobby.copyLink')}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-emerald-400">{t('online.lobby.shareHint')}</p>
          </div>
        </header>

        {!connected && (
          <p className="rounded-lg border border-amber-500 bg-amber-500/15 p-3 text-center text-sm text-amber-200">
            {t('online.lobby.reconnecting')}
          </p>
        )}

        <section className="space-y-2 rounded-xl border border-emerald-600 bg-emerald-800 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-300">{t('online.lobby.seats')}</h2>
            <span className="text-xs text-emerald-400">
              {t('online.lobby.seatCount', { count: room.seats.length, max: room.maxSeats })}
            </span>
          </div>

          <ul className="space-y-2">
            {room.seats.map((seat) => (
              <li
                key={seat.id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                  seat.isConnected ? 'border-emerald-500 bg-emerald-700/50' : 'border-emerald-700 bg-emerald-900/40 opacity-70'
                }`}
              >
                <span className="flex-1 truncate text-sm font-medium text-white">{seat.name}</span>
                {seat.isHost && (
                  <span className="flex items-center gap-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-emerald-900">
                    <Crown className="w-3 h-3" />
                    {t('online.lobby.host')}
                  </span>
                )}
                {seat.isAI && (
                  <span className="rounded bg-emerald-900/70 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                    {t('online.lobby.ai')}
                  </span>
                )}
                {seat.id === room.youId && (
                  <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {t('online.lobby.you')}
                  </span>
                )}
                {!seat.isConnected && (
                  <span className="text-[10px] font-medium text-amber-300">{t('online.lobby.offline')}</span>
                )}
              </li>
            ))}
          </ul>

          {isHost && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-600 bg-emerald-900/40 px-3 py-2">
              <div>
                <div className="text-sm font-medium text-white">{t('online.lobby.aiSeats')}</div>
                <div className="text-xs text-emerald-400">{t('online.lobby.aiSeatsHint')}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => send({ type: 'setAICount', count: aiCount - 1 })}
                  disabled={!canRemoveAI}
                  aria-label={t('online.lobby.removeAI')}
                  className="rounded-lg border border-emerald-500 bg-emerald-700 p-1.5 text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-6 text-center font-mono text-lg font-bold text-amber-300">{aiCount}</span>
                <button
                  type="button"
                  onClick={() => send({ type: 'setAICount', count: aiCount + 1 })}
                  disabled={!canAddAI}
                  aria-label={t('online.lobby.addAI')}
                  className="rounded-lg border border-emerald-500 bg-emerald-700 p-1.5 text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <p className="text-center text-xs text-emerald-400">{t('online.lobby.minSeats', { count: room.minSeats })}</p>
        </section>

        <section className="space-y-3 rounded-xl border border-emerald-600 bg-emerald-800 p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-emerald-300">
            <Zap className="w-4 h-4 text-amber-400" />
            {t('online.lobby.rules')}
          </h2>

          {RULE_KEYS.map((rule) => (
            <div key={rule.key} className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="text-sm font-medium text-white">{t(rule.label)}</div>
                <div className="text-xs text-emerald-400">{t(rule.description)}</div>
              </div>
              {isHost ? (
                <Toggle enabled={room.rules[rule.key]} onToggle={() => toggleRule(rule.key)} />
              ) : room.rules[rule.key] ? (
                <Check className="mt-1 w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <X className="mt-1 w-4 h-4 shrink-0 text-red-400" />
              )}
            </div>
          ))}

          <p className="text-xs text-emerald-400">
            {isHost ? t('online.lobby.rulesHostHint') : t('online.lobby.rulesGuestHint')}
          </p>
        </section>

        {isHost ? (
          <button
            type="button"
            onClick={() => send({ type: 'startGame' })}
            disabled={!canStart || !connected}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-4 text-lg font-bold text-emerald-900 transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play className="w-5 h-5" />
            {canStart ? t('online.lobby.start') : t('online.lobby.needPlayers', { count: room.minSeats })}
          </button>
        ) : (
          <p className="rounded-lg border border-emerald-600 bg-emerald-800 p-3 text-center text-sm text-emerald-300">
            {t('online.lobby.waitingHost')}
          </p>
        )}

        <button
          type="button"
          onClick={onLeave}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-600 bg-emerald-800 py-3 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-700"
        >
          <LogOut className="w-4 h-4" />
          {t('online.lobby.leave')}
        </button>

        <p className="text-center text-xs text-emerald-500">
          {t('online.lobby.humans', { count: humans })}
        </p>
      </div>
    </div>
  );
}

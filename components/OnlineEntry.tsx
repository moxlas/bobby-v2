import { useState } from 'react';
import { ArrowLeft, Globe, LogIn, Plus, Users } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../utils/roomCode';
import { ONLINE_CONFIGURED } from '../lib/onlineConfig';
import { saveOnlineName } from '../lib/onlineIdentity';
import type { OnlineSession } from '../types/online';

interface OnlineEntryProps {
  initialCode?: string | null;
  defaultName: string;
  onEnter: (session: OnlineSession) => void;
  onCancel: () => void;
}

export function OnlineEntry({ initialCode, defaultName, onEnter, onCancel }: OnlineEntryProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState(() => normalizeRoomCode(initialCode ?? ''));
  const [error, setError] = useState<string | null>(null);

  const readName = () => {
    const trimmed = name.trim().slice(0, 12);
    if (!trimmed) {
      setError(t('online.entry.nameRequired'));
      return null;
    }
    saveOnlineName(trimmed);
    return trimmed;
  };

  const handleCreate = () => {
    const readyName = readName();
    if (!readyName) return;
    onEnter({ code: generateRoomCode(), create: true, name: readyName });
  };

  const handleJoin = () => {
    const readyName = readName();
    if (!readyName) return;
    const normalized = normalizeRoomCode(code);
    if (!isValidRoomCode(normalized)) {
      setError(t('online.entry.codeInvalid'));
      return;
    }
    onEnter({ code: normalized, create: false, name: readyName });
  };

  return (
    <div className="min-h-screen bg-emerald-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-emerald-800 rounded-xl shadow-2xl border border-emerald-600 overflow-hidden">
        <div className="relative bg-amber-500 px-4 py-5 text-center">
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('online.entry.back')}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-lg bg-emerald-900/20 p-2 text-emerald-900 transition-colors hover:bg-emerald-900/30"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="flex items-center justify-center gap-2 text-2xl font-bold text-emerald-900">
            <Globe className="w-6 h-6" />
            {t('online.entry.title')}
          </h1>
          <p className="mt-1 text-sm text-amber-800">{t('online.entry.subtitle')}</p>
        </div>

        <div className="space-y-5 p-5">
          {!ONLINE_CONFIGURED && (
            <p className="rounded-lg border border-red-500 bg-red-500/20 p-3 text-sm text-red-200">
              {t('online.entry.unavailable')}
            </p>
          )}

          {error && (
            <p className="rounded-lg border border-red-500 bg-red-500/20 p-3 text-sm text-red-200">{error}</p>
          )}

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-emerald-300">{t('online.entry.nameLabel')}</span>
            <input
              type="text"
              value={name}
              maxLength={12}
              onChange={(event) => {
                setName(event.target.value.slice(0, 12));
                setError(null);
              }}
              placeholder={t('online.entry.namePlaceholder')}
              className="w-full rounded-lg border border-emerald-500 bg-emerald-700 px-4 py-2.5 text-white placeholder-emerald-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </label>

          <button
            type="button"
            onClick={handleCreate}
            disabled={!ONLINE_CONFIGURED}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-3 text-lg font-bold text-emerald-900 transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="w-5 h-5" />
            {t('online.entry.create')}
          </button>

          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-emerald-400">
            <span className="h-px flex-1 bg-emerald-600" />
            {t('online.entry.or')}
            <span className="h-px flex-1 bg-emerald-600" />
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-emerald-300">{t('online.entry.codeLabel')}</span>
            <input
              type="text"
              value={code}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(event) => {
                setCode(normalizeRoomCode(event.target.value));
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleJoin();
              }}
              placeholder={t('online.entry.codePlaceholder')}
              className="w-full rounded-lg border border-emerald-500 bg-emerald-700 px-4 py-3 text-center font-mono text-2xl font-bold tracking-[0.3em] text-white placeholder-emerald-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </label>

          <button
            type="button"
            onClick={handleJoin}
            disabled={!ONLINE_CONFIGURED}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400 bg-emerald-700 py-3 text-base font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogIn className="w-5 h-5" />
            {t('online.entry.join')}
          </button>

          <p className="flex items-center justify-center gap-1.5 text-xs text-emerald-400">
            <Users className="w-3.5 h-3.5" />
            {t('online.entry.hint')}
          </p>
        </div>
      </div>
    </div>
  );
}

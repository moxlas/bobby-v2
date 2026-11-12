import { Bot, Eye, Globe, RefreshCw, Users } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { usePublicRooms } from '../lib/usePublicRooms';
import { getRoomAction, type RoomBrowserAction } from '../utils/roomBrowser';
import type { PublicRoomSummary, RoomPhase } from '../types/online';

interface RoomBrowserProps {
  /** Called for join/watch/next-round; full rooms never trigger it. */
  onSelect: (room: PublicRoomSummary) => void;
}

const PHASE_STYLES: Record<RoomPhase, string> = {
  lobby: 'border-amber-400/60 bg-amber-500/20 text-amber-200',
  playing: 'border-sky-400/60 bg-sky-500/20 text-sky-200',
  finished: 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200',
};

const ACTION_KEYS: Record<RoomBrowserAction, string> = {
  join: 'online.browser.join',
  watch: 'online.browser.watch',
  nextRound: 'online.browser.nextRound',
  full: 'online.browser.full',
};

export function RoomBrowser({ onSelect }: RoomBrowserProps) {
  const { t } = useTranslation();
  const { rooms, loading, error, refresh } = usePublicRooms();

  return (
    <section className="flex min-h-[20rem] flex-col overflow-hidden rounded-xl border border-emerald-600 bg-emerald-800 shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-emerald-700 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-bold text-amber-300">
            <Globe className="h-5 w-5 shrink-0" />
            {t('online.browser.title')}
          </h2>
          <p className="mt-0.5 truncate text-xs text-emerald-300">
            {t('online.browser.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label={t('online.browser.refresh')}
          title={t('online.browser.refresh')}
          className="shrink-0 rounded-lg border border-emerald-500 bg-emerald-700 p-2 text-emerald-100 transition-colors hover:bg-emerald-600"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="max-h-[32rem] flex-1 overflow-y-auto p-3">
        {error && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-400/60 bg-red-500/20 px-3 py-2 text-xs text-red-100">
            <span>{t('online.browser.error')}</span>
            <button
              type="button"
              onClick={refresh}
              className="shrink-0 rounded border border-red-300/60 px-2 py-1 font-semibold transition-colors hover:bg-red-500/30"
            >
              {t('online.browser.retry')}
            </button>
          </div>
        )}

        {loading && rooms.length === 0 ? (
          <div className="flex h-52 flex-col items-center justify-center gap-2 text-sm text-emerald-300">
            <RefreshCw className="h-5 w-5 animate-spin" />
            {t('online.browser.loading')}
          </div>
        ) : rooms.length === 0 ? (
          error ? null : (
            <div className="flex h-52 flex-col items-center justify-center px-6 text-center">
              <Globe className="mb-2 h-8 w-8 text-emerald-500" />
              <p className="text-sm text-emerald-300">{t('online.browser.empty')}</p>
            </div>
          )
        ) : (
          <ul className="space-y-2">
            {rooms.map((room) => {
              const action = getRoomAction(room);
              const disabled = action === 'full';

              return (
                <li
                  key={room.code}
                  className="rounded-lg border border-emerald-600/70 bg-emerald-900/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold tracking-[0.2em] text-white">
                          {room.code}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PHASE_STYLES[room.phase]}`}>
                          {t(`online.browser.phase.${room.phase}`)}
                        </span>
                      </div>

                      <p className="mt-1 truncate text-xs text-emerald-300">
                        {t('online.browser.host', { name: room.hostName })}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-emerald-300">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {t('online.browser.humans', { count: room.humans })}
                        </span>
                        {room.ai > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Bot className="h-3 w-3" />
                            {t('online.browser.ai', { count: room.ai })}
                          </span>
                        )}
                        {room.spectators > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            {t('online.browser.spectators', { count: room.spectators })}
                          </span>
                        )}
                        <span className="text-emerald-400">
                          {t('online.browser.seats', {
                            count: room.humans + room.ai,
                            max: room.maxSeats,
                          })}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onSelect(room)}
                      className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-emerald-900 transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-emerald-700 disabled:text-emerald-400"
                    >
                      {t(ACTION_KEYS[action])}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

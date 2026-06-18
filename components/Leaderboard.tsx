import { useState, useEffect } from 'react';
import { Trophy, Trash2, X, Crown, Skull, TrendingUp } from 'lucide-react';
import { loadLeaderboard, clearLeaderboard, getWinRate, getAvgPosition, PlayerRecord } from '../utils/leaderboard';
import { useTranslation } from '../lib/i18n';

interface LeaderboardProps {
  onClose: () => void;
}

export function Leaderboard({ onClose }: LeaderboardProps) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<PlayerRecord[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const load = () => {
    const data = loadLeaderboard();
    const sorted = [...data.records].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return getWinRate(b) - getWinRate(a);
    });
    setRecords(sorted);
    setLastUpdated(data.lastUpdated);
  };

  useEffect(() => {
    load();
  }, []);

  const handleClear = () => {
    clearLeaderboard();
    setRecords([]);
    setShowClearConfirm(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-emerald-800 rounded-2xl w-full max-w-lg border border-emerald-600 shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-5 border-b border-emerald-600 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            <h2 className="text-xl font-bold text-amber-300">{t('leaderboard.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-emerald-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-emerald-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {records.length === 0 ? (
            <div className="text-center py-12">
              <Trophy className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
              <p className="text-emerald-400 text-base">{t('leaderboard.noGames')}</p>
              <p className="text-emerald-500 text-sm mt-1">{t('leaderboard.finishGame')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-2 px-3 pb-1 text-xs font-medium text-emerald-400 uppercase tracking-wide">
                <span className="col-span-2">{t('leaderboard.player')}</span>
                <span className="text-center">{t('leaderboard.wins')}</span>
                <span className="text-center">{t('leaderboard.losses')}</span>
                <span className="text-center">{t('leaderboard.winPercent')}</span>
              </div>

              {records.map((record, index) => {
                const winRate = getWinRate(record);
                const avgPos = getAvgPosition(record);
                const isBest = index === 0;

                return (
                  <div
                    key={record.name}
                    className={`rounded-xl p-3 border transition-all ${
                      isBest
                        ? 'bg-amber-500/15 border-amber-500/40'
                        : 'bg-emerald-700/40 border-emerald-600/60'
                    }`}
                  >
                    <div className="grid grid-cols-5 gap-2 items-center">
                      <div className="col-span-2 flex items-center gap-2 min-w-0">
                        <span className={`text-sm font-bold flex-shrink-0 ${
                          isBest ? 'text-amber-400' : 'text-emerald-400'
                        }`}>
                          #{index + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            {isBest && <Crown className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                            <span className={`font-semibold truncate text-sm ${
                              isBest ? 'text-amber-200' : 'text-white'
                            }`}>
                              {record.name}
                            </span>
                          </div>
                          <span className="text-emerald-400 text-xs">
                            {t('leaderboard.gameCount', { count: record.totalGames, s: record.totalGames !== 1 ? 's' : '' })} · {t('leaderboard.avgPosition', { pos: avgPos })}
                          </span>
                        </div>
                      </div>

                      <div className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Crown className="w-3 h-3 text-amber-400" />
                          <span className="font-bold text-amber-300">{record.wins}</span>
                        </div>
                      </div>

                      <div className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Skull className="w-3 h-3 text-red-400" />
                          <span className="font-bold text-red-300">{record.losses}</span>
                        </div>
                      </div>

                      <div className="text-center">
                        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                          winRate >= 50
                            ? 'bg-emerald-500/30 text-emerald-300'
                            : 'bg-red-500/20 text-red-300'
                        }`}>
                          <TrendingUp className="w-3 h-3" />
                          {winRate}%
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-emerald-600 flex-shrink-0">
          {lastUpdated && records.length > 0 && (
            <p className="text-emerald-500 text-xs mb-3 text-center">
              {t('leaderboard.lastUpdated', { date: new Date(lastUpdated).toLocaleDateString() })}
            </p>
          )}

          {showClearConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-emerald-300 text-sm flex-1">{t('leaderboard.clearConfirm')}</span>
              <button
                onClick={handleClear}
                className="bg-red-500 hover:bg-red-600 text-white font-bold text-sm px-4 py-2 rounded-lg transition-colors"
              >
                {t('leaderboard.clearYes')}
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-4 py-2 rounded-lg transition-colors"
              >
                {t('leaderboard.clearCancel')}
              </button>
            </div>
          ) : (
            records.length > 0 && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="w-full flex items-center justify-center gap-2 text-emerald-400 hover:text-red-300 text-sm py-2 rounded-lg hover:bg-emerald-700/50 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                {t('leaderboard.clearRecords')}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

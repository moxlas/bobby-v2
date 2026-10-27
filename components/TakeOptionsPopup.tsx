import { useTranslation } from '../lib/i18n';

interface TakeOptionsPopupProps {
  takeAllCount: number;
  onTake3: () => void;
  onTakeAll: () => void;
  onCancel: () => void;
}

export function TakeOptionsPopup({ takeAllCount, onTake3, onTakeAll, onCancel }: TakeOptionsPopupProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-900/70 p-4 lg:hidden">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="take-options-title"
        className="w-full max-w-sm rounded-lg border border-emerald-600 bg-emerald-800 p-6 shadow-2xl"
      >
        <h3 id="take-options-title" className="mb-4 text-lg font-bold text-amber-300">
          {t('game.takeOptions.title')}
        </h3>
        <div className="flex flex-col gap-3">
          <button
            onClick={onTake3}
            className="w-full rounded-lg bg-amber-500 px-4 py-3 font-bold text-emerald-900 transition-colors hover:bg-amber-600"
          >
            {t('game.takeOptions.take3')}
          </button>
          <button
            onClick={onTakeAll}
            className="w-full rounded-lg bg-amber-500 px-4 py-3 font-bold text-emerald-900 transition-colors hover:bg-amber-600"
          >
            {t('game.takeOptions.takeAll', { count: takeAllCount })}
          </button>
          <button
            onClick={onCancel}
            className="w-full rounded-lg border border-emerald-400 bg-emerald-600 px-4 py-3 text-white transition-colors hover:bg-emerald-500"
          >
            {t('game.takeOptions.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

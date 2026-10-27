import { useTranslation } from '../lib/i18n';
import { usePopIn } from '../lib/animations';
import { useDialogTapGuard } from '../lib/useDialogTapGuard';

interface TakeOptionsPopupProps {
  takeAllCount: number;
  onTake3: () => void;
  onTakeAll: () => void;
  onCancel: () => void;
}

export function TakeOptionsPopup({ takeAllCount, onTake3, onTakeAll, onCancel }: TakeOptionsPopupProps) {
  const { t } = useTranslation();
  const panelRef = usePopIn<HTMLDivElement>();
  const tapGuard = useDialogTapGuard();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-900/70 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="take-options-title"
        {...tapGuard}
        className="w-full max-w-sm rounded-lg border border-emerald-600 bg-emerald-800 p-6 shadow-2xl touch-manipulation"
      >
        <h3 id="take-options-title" className="mb-4 text-lg font-bold text-amber-300">
          {t('game.takeOptions.title')}
        </h3>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onTake3}
            className="w-full rounded-lg bg-amber-500 px-4 py-3.5 text-lg font-bold text-emerald-900 transition-colors hover:bg-amber-600 active:bg-amber-600 lg:py-3 lg:text-base touch-manipulation"
          >
            {t('game.takeOptions.take3')}
          </button>
          <button
            type="button"
            onClick={onTakeAll}
            className="w-full rounded-lg bg-amber-500 px-4 py-3.5 text-lg font-bold text-emerald-900 transition-colors hover:bg-amber-600 active:bg-amber-600 lg:py-3 lg:text-base touch-manipulation"
          >
            {t('game.takeOptions.takeAll', { count: takeAllCount })}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-lg border border-emerald-400 bg-emerald-600 px-4 py-3.5 text-lg text-white transition-colors hover:bg-emerald-500 active:bg-emerald-500 lg:py-3 lg:text-base touch-manipulation"
          >
            {t('game.takeOptions.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

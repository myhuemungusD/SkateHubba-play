import { ChevronLeftIcon } from "../../../components/icons";

/**
 * `backLabel` names where Back actually goes. A signed-out visitor on a
 * shared `/player/:uid` link has no lobby, so labelling the control "Lobby"
 * there would promise a destination they can't reach.
 */
export function ProfileHeader({ onBack, backLabel = "Lobby" }: { onBack: () => void; backLabel?: string }) {
  return (
    <div className="px-5 pt-safe pb-4 flex justify-between items-center border-b border-white/[0.04] glass">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 touch-target text-muted hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange rounded-lg"
        aria-label={`Back to ${backLabel.toLowerCase()}`}
      >
        <ChevronLeftIcon size={16} />
        <span className="font-body text-xs">{backLabel}</span>
      </button>
      <img
        src="/logonew.webp"
        alt=""
        draggable={false}
        className="h-5 w-auto select-none opacity-40"
        aria-hidden="true"
      />
      <div className="w-16" aria-hidden="true" />
    </div>
  );
}

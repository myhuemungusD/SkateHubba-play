import type { ReactNode } from "react";
import { BackChevron } from "../../../components/ScreenHeader";

/**
 * `backLabel` names where Back actually goes. A signed-out visitor on a
 * shared `/player/:uid` link has no lobby, so labelling the control "Lobby"
 * there would promise a destination they can't reach.
 *
 * `actions` is the top-right slot: the ••• menu on someone else's profile.
 */
export function ProfileHeader({
  onBack,
  backLabel = "Lobby",
  actions,
}: {
  onBack: () => void;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="px-5 pt-safe pb-2 flex justify-between items-center border-b border-white/[0.04] glass">
      <BackChevron onClick={onBack} label={`Back to ${backLabel.toLowerCase()}`} />
      <img
        src="/logonew.webp"
        alt=""
        draggable={false}
        className="h-5 w-auto select-none opacity-40"
        aria-hidden="true"
      />
      <div className="-mr-2 flex h-11 w-11 items-center justify-center">{actions}</div>
    </div>
  );
}

import { FisheyeIcon, FlipCameraIcon } from "./icons";

/** Shared classes for the viewfinder chrome toggles — 44px touch target. */
const CHROME_BTN =
  "w-11 h-11 inline-flex items-center justify-center rounded-full transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";

/** Pre-record web camera toggles: front/rear flip and fisheye. */
export function CameraChromeToggles({
  facingMode,
  fisheyeOn,
  onFlip,
  onToggleFisheye,
}: {
  facingMode: "user" | "environment";
  fisheyeOn: boolean;
  onFlip: () => void;
  onToggleFisheye: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onFlip}
        aria-label={facingMode === "environment" ? "Switch to front camera" : "Switch to rear camera"}
        aria-pressed={facingMode === "user"}
        className={`${CHROME_BTN} ${
          facingMode === "user"
            ? "bg-brand-orange/90 shadow-[0_0_12px_rgba(255,107,0,0.4)]"
            : "bg-black/60 hover:bg-black/80 backdrop-blur-sm"
        }`}
      >
        <FlipCameraIcon size={18} className="text-white" />
      </button>
      <button
        type="button"
        onClick={onToggleFisheye}
        aria-label={fisheyeOn ? "Disable fisheye" : "Enable fisheye"}
        aria-pressed={fisheyeOn}
        className={`${CHROME_BTN} ${
          fisheyeOn
            ? "bg-purple-500/90 shadow-[0_0_12px_rgba(147,51,234,0.4)]"
            : "bg-black/60 hover:bg-black/80 backdrop-blur-sm"
        }`}
      >
        <FisheyeIcon size={18} className="text-white" />
      </button>
    </>
  );
}

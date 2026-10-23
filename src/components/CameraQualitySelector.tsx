import { useEffect, useState } from "react";
import { getNativeQualityModes, setNativeQuality, type CaptureQuality } from "../services/nativeVideo";

const QUALITY_LABELS: Record<CaptureQuality, string> = {
  standard1080p60: "1080p60",
  pro4k60: "4K60",
  slomo120: "120fps",
  slomo240: "240fps",
};

const QUALITY_DESC: Record<CaptureQuality, string> = {
  standard1080p60: "Best balance",
  pro4k60: "Max quality",
  slomo120: "Slow motion",
  slomo240: "Ultra slow-mo",
};

/**
 * Native-only quality mode selector. Shows available capture modes
 * (1080p60, 4K60, 120fps, 240fps) and lets the user switch between them.
 * Renders nothing when the native camera reports no quality modes (Android / unpatched builds).
 */
export function CameraQualitySelector({ active }: { active: boolean }) {
  const [modes, setModes] = useState<CaptureQuality[]>([]);
  const [current, setCurrent] = useState<CaptureQuality>("standard1080p60");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      const result = await getNativeQualityModes();
      if (cancelled) return;
      setModes(result.modes);
      setCurrent(result.current);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!active || modes.length <= 1) return null;

  const select = async (quality: CaptureQuality) => {
    setCurrent(quality);
    setOpen(false);
    await setNativeQuality(quality);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Current quality: ${QUALITY_LABELS[current]}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="h-11 px-3 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm transition-colors"
      >
        <span className="font-display text-sm text-white tracking-wider">{QUALITY_LABELS[current]}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 min-w-36 rounded-lg bg-black/90 backdrop-blur-md border border-white/10 overflow-hidden z-20"
          >
            {modes.map((mode) => (
              <button
                key={mode}
                type="button"
                role="menuitem"
                onClick={() => void select(mode)}
                className={`w-full px-4 py-3 text-left transition-colors ${
                  mode === current ? "bg-brand-orange/20 text-brand-orange" : "text-white hover:bg-white/10"
                }`}
              >
                <div className="font-display text-sm tracking-wider">{QUALITY_LABELS[mode]}</div>
                <div className="font-body text-xs text-white/60 mt-0.5">{QUALITY_DESC[mode]}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

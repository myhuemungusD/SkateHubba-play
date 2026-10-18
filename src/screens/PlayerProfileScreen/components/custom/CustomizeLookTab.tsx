import { ColorRow, label, Slider, type TabProps } from "./customizeParts";

/** Look tab: accent, gradient and banner crop. */
export function CustomizeLookTab({ draft, set }: TabProps) {
  return (
    <div>
      <ColorRow name="Accent" value={draft.accent} onChange={(v) => set("accent", v)} />
      <ColorRow name="Gradient top" value={draft.gradientFrom} onChange={(v) => set("gradientFrom", v)} />
      <ColorRow name="Gradient bottom" value={draft.gradientTo} onChange={(v) => set("gradientTo", v)} />
      <Slider
        name="Gradient angle"
        min={0}
        max={359}
        value={draft.gradientAngle}
        onChange={(v) => set("gradientAngle", v)}
      />
      <p className={`${label} mt-6`}>BANNER CROP</p>
      <Slider name="Left / right" min={0} max={100} value={draft.bannerPosX} onChange={(v) => set("bannerPosX", v)} />
      <Slider name="Up / down" min={0} max={100} value={draft.bannerPosY} onChange={(v) => set("bannerPosY", v)} />
      <Slider name="Zoom" min={100} max={200} value={draft.bannerZoom} onChange={(v) => set("bannerZoom", v)} />
    </div>
  );
}

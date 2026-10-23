import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router";
import { useTipsContext } from "../../context/TipsContext";
import { useOnboardingContext } from "../../context/OnboardingContext";
import { useActiveTipZone, useCameraLive } from "../../lib/tipSignals";
import { SpotlightOverlay } from "../onboarding/SpotlightOverlay";
import { MascotBubble } from "../onboarding/MascotBubble";
import { TIP_SETS, anchorSelector, tipSetForPath, visibleTips, type Tip, type TipSet } from "./tipSets";

/** Let the screen paint (and its anchors mount) before Hesher pops up. */
export const TIP_SETTLE_MS = 700;

/**
 * Hosts Hesher's first-visit tips. Picks the open sheet's zone first, then
 * the route's set; shows nothing while the welcome tour is armed, while the
 * camera is live, when tips are off, or once that set has been seen.
 * Non-blocking like the tour: no focus trap, no inert. Esc, the close button,
 * or a tap anywhere outside the bubble puts the set away.
 */
export function TipsHost() {
  const tips = useTipsContext();
  const { tourArmed, reducedMotion } = useOnboardingContext();
  const { pathname } = useLocation();
  const zone = useActiveTipZone();
  const cameraLive = useCameraLive();

  const set = zone ? (TIP_SETS[zone] ?? null) : tipSetForPath(pathname);
  const blocked = !tips.available || !tips.ready || tips.disabled || tourArmed || cameraLive;
  if (blocked || !set || tips.seen.includes(set.id)) return null;
  return <TipSequence key={set.id} set={set} reducedMotion={reducedMotion} onDone={tips.markSeen} />;
}

function TipSequence({
  set,
  reducedMotion,
  onDone,
}: {
  set: TipSet;
  reducedMotion: boolean;
  onDone: (id: string) => void;
}) {
  const [list, setList] = useState<Tip[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setList(visibleTips(set)), TIP_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [set]);

  const done = useCallback(() => onDone(set.id), [onDone, set.id]);

  useEffect(() => {
    if (!list || list.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done();
    };
    // Tap anywhere outside the bubble puts the tips away. Listens for `click`
    // (not pointerdown) so a scroll or swipe never dismisses, and never stops
    // the event: the tap still reaches the page, which stays fully live.
    const onTapOutside = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest("[data-coach-bubble]")) return;
      done();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onTapOutside, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onTapOutside, true);
    };
  }, [list, done]);

  if (!list || list.length === 0) return null;
  const tip = list[Math.min(index, list.length - 1)];
  const last = index >= list.length - 1;
  const label = `tip ${index + 1} of ${list.length}`;

  return (
    <div role="dialog" aria-labelledby="hesher-tip-title" data-testid="tips-host">
      <SpotlightOverlay
        targetSelector={tip.anchor ? anchorSelector(tip.anchor) : undefined}
        reducedMotion={reducedMotion}
        placement={set.placement}
      >
        <MascotBubble
          title={tip.title}
          message={tip.body}
          stepLabel={label}
          stepIndex={index}
          totalSteps={list.length}
          mascotState={last ? "cheer" : "talking"}
          primaryCta={{ label: last ? "got it" : "next", onClick: last ? done : () => setIndex(index + 1) }}
          onClose={done}
          closeLabel="close tips"
          titleId="hesher-tip-title"
          reducedMotion={reducedMotion}
        />
      </SpotlightOverlay>
    </div>
  );
}

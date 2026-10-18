import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  MAX_FEATURED_PER_PRO,
  featureClip,
  listFeaturedClips,
  unfeatureClip,
  type FeaturedClip,
} from "../../services/proCommunity";
import { BTN, CARD, H3, INPUT, msg, type Pro } from "./proToolStyles";
import { Status } from "./ProToolStatus";

export function FeaturedClipsTool({ pro }: { pro: Pro }) {
  const [clipId, setClipId] = useState("");
  const [mine, setMine] = useState<FeaturedClip[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    () => listFeaturedClips().then((all) => setMine(all.filter((f) => f.proUid === pro.uid))),
    [pro.uid],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (fn: () => Promise<void>, fallback: string) => {
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(msg(e, fallback));
    }
  };
  return (
    <section aria-label="Featured clips" className={CARD}>
      <h3 className={H3}>
        <Sparkles size={14} aria-hidden="true" /> FEATURED CLIPS
      </h3>
      <p className="mb-3 font-body text-xs text-white/70">
        Pin up to {MAX_FEATURED_PER_PRO} clips to the top of the feed under Pro picks. Your profile reel uses your
        pinned clips.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await featureClip(pro, clipId);
            setClipId("");
          }, "Couldn't feature that clip.");
        }}
      >
        <input
          aria-label="Clip id"
          className={INPUT}
          value={clipId}
          onChange={(e) => setClipId(e.target.value)}
          placeholder="Clip id"
        />
        <button type="submit" className={BTN}>
          FEATURE
        </button>
      </form>
      <Status error={error} ok="" />
      {mine && mine.length > 0 && (
        <ul className="mt-3 space-y-1">
          {mine.map((f) => (
            <li key={f.clipId} className="flex items-center justify-between font-body text-xs">
              <span>{f.trickName || f.clipId}</span>
              <button
                type="button"
                className={BTN}
                onClick={() => void run(() => unfeatureClip(f.clipId), "Couldn't unpin that clip.")}
              >
                Unpin
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

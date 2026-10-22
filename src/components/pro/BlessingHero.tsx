import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { fetchMyBlessings, type Blessing } from "../../services/proBlessing";

const STATUS_LABEL: Record<Blessing["status"], string> = {
  pending: "Waiting on them",
  accepted: "Turned pro",
  declined: "Declined",
  expired: "Lapsed",
  revoked: "Revoked",
};

/**
 * The headline pro power: blessing another skater pro. Only rendered with
 * VITE_FEATURE_PRO_BLESSING on; `live` is false in admin review mode, where
 * it previews the card only.
 */
export function BlessingHero({ uid, live }: { uid: string | null; live: boolean }) {
  const [mine, setMine] = useState<Blessing[]>([]);
  useEffect(() => {
    if (!live || !uid) return;
    let on = true;
    fetchMyBlessings(uid)
      .then((rows) => on && setMine(rows))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [uid, live]);

  return (
    <section
      aria-labelledby="bless-hero-title"
      data-testid="blessing-hero"
      className="mb-5 rounded-2xl border border-amber-300/40 bg-gradient-to-b from-amber-300/15 to-transparent p-5"
    >
      <div className="mb-2 flex items-center gap-2 text-amber-200">
        <Sparkles size={18} aria-hidden="true" />
        <span className="font-display text-[10px] tracking-[0.3em]">YOUR MAIN PRO POWER</span>
      </div>
      <h2 id="bless-hero-title" className="font-display text-2xl tracking-wide text-white">
        Bless a pro
      </h2>
      <p className="mt-2 font-body text-sm text-white/75">
        Nobody earns or wins pro on SkateHubba. The only way in is a pro vouching for you. Open a skater&apos;s profile
        and tap <span className="font-display text-amber-100">BLESS AS PRO</span>. They accept, they turn pro, and
        &ldquo;Blessed by&rdquo; you shows on their profile for good.
      </p>
      <ul className="mt-3 space-y-1 font-body text-xs text-white/60">
        <li>• A couple of blessings a month, so pro stays rare.</li>
        <li>• Say why. Your words show on their profile.</li>
        <li>• Accounts must be at least 30 days old. No self-blessing.</li>
      </ul>
      {!live && (
        <p className="mt-3 font-body text-xs text-amber-100/80">Preview: blessing turns on for testers first.</p>
      )}
      {mine.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="mb-2 font-display text-[11px] tracking-wider text-white/60">YOUR BLESSINGS</p>
          <ul className="space-y-1">
            {mine.map((b) => (
              <li key={b.id} className="flex justify-between font-body text-sm text-white/85">
                <span>@{b.targetUsername}</span>
                <span className="text-white/50">{STATUS_LABEL[b.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

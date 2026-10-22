import { useEffect, useState } from "react";
import { fetchMyBlessings, type Blessing } from "../../services/proBlessing";

const STATUS_LABEL: Record<Blessing["status"], string> = {
  pending: "Waiting on them",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Lapsed",
  revoked: "Revoked",
};

/**
 * Pro tools card for putting another pro on (the blessing mechanic). `live` is false in
 * admin review mode or with the flag off, where it previews the card only.
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
      <h2 id="bless-hero-title" className="font-display text-2xl tracking-wide text-white">
        Put someone on
      </h2>
      <p className="mt-2 font-body text-sm text-white/75">
        Only for skaters who are pro for real: a board or shoe with a real company. Open their profile and tap{" "}
        <span className="font-display text-amber-100">PUT ON</span>. They accept, and &ldquo;put on by&rdquo; you shows
        on their profile.
      </p>
      <ul className="mt-3 space-y-1 font-body text-xs text-white/60">
        <li>• A couple a month, so it stays real.</li>
        <li>• Say why. It shows on their profile.</li>
        <li>• Accounts must be at least 30 days old. You can&apos;t put yourself on.</li>
      </ul>
      {!live && <p className="mt-3 font-body text-xs text-amber-100/80">Preview: put-ons turn on for testers first.</p>}
      {mine.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="mb-2 font-display text-[11px] tracking-wider text-white/60">YOUR PUT-ONS</p>
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

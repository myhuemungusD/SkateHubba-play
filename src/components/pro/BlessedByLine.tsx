import { useEffect, useState } from "react";
import { fetchLineage, type Blessing } from "../../services/proBlessing";

interface Props {
  uid: string;
  onViewPlayer?: (uid: string) => void;
}

function monthYear(ms: number): string {
  return ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "";
}

/**
 * Public "Blessed by @X" with the lineage above them. Renders nothing for a
 * founder-seeded pro (no accepted blessing on record).
 */
export function BlessedByLine({ uid, onViewPlayer }: Props) {
  const [chain, setChain] = useState<Blessing[] | null>(null);

  useEffect(() => {
    let live = true;
    fetchLineage(uid)
      .then((c) => live && setChain(c))
      .catch(() => live && setChain([]));
    return () => {
      live = false;
    };
  }, [uid]);

  const first = chain?.[0];
  if (!first) return null;
  const name = (b: Blessing) =>
    onViewPlayer ? (
      <button
        type="button"
        onClick={() => onViewPlayer(b.blesserUid)}
        className="pro-username underline-offset-2 hover:underline"
      >
        @{b.blesserUsername}
      </button>
    ) : (
      <span className="pro-username">@{b.blesserUsername}</span>
    );

  return (
    <section
      aria-label="Blessed by"
      data-testid="blessed-by"
      className="mb-4 rounded-2xl border border-amber-300/25 bg-amber-300/[0.06] p-4"
    >
      <p className="font-display text-xs tracking-wider text-white/80">
        ✦ BLESSED BY {name(first)} <span className="text-white/50">· {monthYear(first.createdAtMs)}</span>
      </p>
      {first.reason && <p className="mt-2 font-body text-sm italic text-white/80">&ldquo;{first.reason}&rdquo;</p>}
      {chain.length > 1 && (
        <p className="mt-2 font-body text-[11px] text-white/50" data-testid="blessing-lineage">
          Lineage: {chain.map((b) => `@${b.blesserUsername}`).join(" ← ")}
        </p>
      )}
    </section>
  );
}

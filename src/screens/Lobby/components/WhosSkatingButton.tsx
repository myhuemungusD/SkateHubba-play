import { lazy, Suspense, useState } from "react";
import { Users } from "lucide-react";

const WhosSkatingSheet = lazy(() =>
  import("../../../components/presence/WhosSkatingSheet").then((m) => ({ default: m.WhosSkatingSheet })),
);

/**
 * Home entry for "Who's skating". One slim row, so Home stays about your
 * games. The list only loads while the sheet is open (no reads on Home).
 * Rendered only while the spot presence flag is on.
 */
export function WhosSkatingButton({ uid }: { uid: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="whos-skating-button"
        data-tutorial="whos-skating"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="mb-5 flex w-full items-center gap-3 rounded-2xl border border-white/[0.06] bg-surface px-4 py-3 text-left shadow-card hover:border-brand-orange/40"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/10 text-green-400">
          <Users size={16} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block font-display tracking-wider text-white">Who&apos;s skating</span>
          <span className="block font-body text-xs text-muted">See who&apos;s out at a spot</span>
        </span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <WhosSkatingSheet uid={uid} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

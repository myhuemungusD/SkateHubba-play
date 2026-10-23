import { useEffect, useState } from "react";
import { ScreenHeader } from "../components/ScreenHeader";
import { ClosetGrid } from "../components/ClosetGrid";
import { fetchLockerItems, type LockerItem } from "../services/locker";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";

interface Props {
  /** Whose closet to show. */
  uid: string;
  /** Where Back lands when the screen was opened cold: the profile it came from. */
  backFallback: string;
}

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; items: LockerItem[] };

/**
 * Full Closet: every item a skater has, as the card grid that used to sit on
 * the profile. Reached from the profile's Closet row ("See all"). Only routed
 * while the Closet flag is on.
 */
export function PlayerClosetScreen({ uid, backFallback }: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  // `attempt` bumps on Retry; the screen starts in "loading", so the effect
  // only ever resolves it (Retry resets it first).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stale = false;
    fetchLockerItems(uid)
      .then((items) => {
        if (!stale) setLoad({ state: "ready", items });
      })
      .catch((err: unknown) => {
        logger.warn("closet_screen_load_failed", { error: parseFirebaseError(err) });
        if (!stale) setLoad({ state: "error" });
      });
    return () => {
      stale = true;
    };
  }, [uid, attempt]);

  const count = load.state === "ready" ? load.items.length : null;

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] bg-background px-4 pb-tabbar pt-[max(env(safe-area-inset-top),1.25rem)]">
      <ScreenHeader fallback={backFallback} label="Back to profile" title="Closet" />
      {count !== null && (
        <p className="mb-4 mt-1 font-body text-xs text-muted tabular-nums" data-testid="closet-screen-count">
          {count === 1 ? "1 item" : `${count} items`}
        </p>
      )}
      <div className="mt-4">
        {load.state === "loading" && (
          <p role="status" className="font-body text-xs text-subtle">
            Loading closet…
          </p>
        )}
        {load.state === "error" && (
          <div role="alert" className="rounded-2xl border border-border px-4 py-6 text-center">
            <p className="font-body text-xs text-subtle">Couldn&apos;t load the closet.</p>
            <button
              type="button"
              onClick={() => {
                setLoad({ state: "loading" });
                setAttempt((n) => n + 1);
              }}
              className="mt-2 min-h-11 rounded-lg px-3 font-display text-sm tracking-wider text-brand-orange hover:text-white focus-visible:outline-2 focus-visible:outline-brand-orange"
            >
              Try again
            </button>
          </div>
        )}
        {load.state === "ready" &&
          (load.items.length === 0 ? (
            <p
              data-testid="closet-screen-empty"
              className="rounded-2xl border border-dashed border-border px-4 py-6 text-center font-body text-xs text-subtle"
            >
              Nothing in this closet yet
            </p>
          ) : (
            <ClosetGrid items={load.items} />
          ))}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Shuffle } from "lucide-react";
import { getPlayerDirectory } from "../../../services/users";
import { getBlockedUserIds } from "../../../services/blocking";

interface Props {
  viewerUid: string;
  /** Skaters to skip: people you already have a game going with. */
  excludeUids: ReadonlySet<string>;
  disabled?: boolean;
  /** Opens the challenge form with the picked skater filled in. */
  onChallengeUser: (username: string) => void;
  /** Nobody to pick (or the read failed): open the plain challenge form. */
  onFallback: () => void;
}

/**
 * "Find me a challenger". Picks a random skater from the player directory on
 * the client and opens the challenge form for them, so the skater still
 * confirms before anything is sent. No server matchmaking or push. Rendered
 * only while VITE_FEATURE_RANDOM_CHALLENGER is on.
 */
export function FindChallengerButton({ viewerUid, excludeUids, disabled = false, onChallengeUser, onFallback }: Props) {
  const [busy, setBusy] = useState(false);

  const find = async () => {
    setBusy(true);
    try {
      const [all, blocked] = await Promise.all([getPlayerDirectory(), getBlockedUserIds(viewerUid)]);
      const pool = all.filter((p) => p.uid !== viewerUid && !blocked.has(p.uid) && !excludeUids.has(p.uid));
      if (pool.length === 0) {
        onFallback();
        return;
      }
      onChallengeUser(pool[Math.floor(Math.random() * pool.length)].username);
    } catch {
      onFallback();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      data-testid="find-challenger"
      onClick={() => void find()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className="mb-6 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-brand-orange bg-brand-orange font-display text-sm tracking-wider text-white transition-all duration-300 hover:bg-brand-orange/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
    >
      <Shuffle size={16} aria-hidden="true" />
      {busy ? "Finding a challenger…" : "Find me a challenger"}
    </button>
  );
}

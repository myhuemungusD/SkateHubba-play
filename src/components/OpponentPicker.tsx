import { useState } from "react";
import { Users } from "lucide-react";
import { usePlayerDirectory } from "../hooks/usePlayerDirectory";
import { PlayerDirectory } from "./PlayerDirectory";

interface Props {
  /** Viewer's uid — the directory hook excludes them and anyone they blocked. */
  viewerUid: string;
  /** True once an opponent is chosen: the roster folds into a single toggle. */
  collapsed: boolean;
  /** Fills the opponent field with the tapped skater's username. */
  onSelect: (username: string) => void;
  onViewPlayer?: (uid: string) => void;
  /** Seconds left on a challenge cooldown; the Challenge buttons wait it out. */
  waitSeconds?: number | null;
}

/**
 * Step 1 of the challenge flow: browse the roster and pick who you're calling
 * out. Expanded by default while the opponent field is empty, then folded to a
 * "Browse skaters" toggle so the rest of the form owns the screen.
 */
export function OpponentPicker({
  viewerUid,
  collapsed,
  onSelect,
  onViewPlayer,
  waitSeconds = null,
}: Props): React.ReactElement {
  const [reopened, setReopened] = useState(false);
  const { players, loading } = usePlayerDirectory(viewerUid);

  if (collapsed && !reopened) {
    return (
      <button
        type="button"
        onClick={() => setReopened(true)}
        className="btn-secondary mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 font-body text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        data-testid="browse-skaters-toggle"
      >
        <Users size={16} aria-hidden="true" />
        Browse skaters
      </button>
    );
  }

  return (
    <PlayerDirectory
      players={players}
      loading={loading}
      // The /challenge route only mounts for a verified user, so the row
      // buttons are always enabled here — the gate lives upstream in App.tsx.
      canChallenge
      onViewPlayer={onViewPlayer}
      waitSeconds={waitSeconds}
      onChallengeUser={(username) => {
        onSelect(username);
        setReopened(false);
      }}
    />
  );
}

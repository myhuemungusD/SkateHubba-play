import { useState } from "react";
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
}

/**
 * Step 1 of the challenge flow: browse the roster and pick who you're calling
 * out. Expanded by default while the opponent field is empty, then folded to a
 * "Browse skaters" toggle so the rest of the form owns the screen.
 */
export function OpponentPicker({ viewerUid, collapsed, onSelect, onViewPlayer }: Props): React.ReactElement {
  const [reopened, setReopened] = useState(false);
  const { players, loading } = usePlayerDirectory(viewerUid);

  if (collapsed && !reopened) {
    return (
      <button
        type="button"
        onClick={() => setReopened(true)}
        className="touch-target mb-6 inline-flex items-center gap-1 font-body text-sm text-brand-orange hover:text-white transition-colors rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        data-testid="browse-skaters-toggle"
      >
        Browse skaters
      </button>
    );
  }

  return (
    <PlayerDirectory
      players={players}
      loading={loading}
      // The /challenge route only mounts for a verified user, so the row
      // buttons are always enabled here. UserProfile carries no emailVerified
      // signal, and the gate already lives upstream in App.tsx.
      user={{ emailVerified: true }}
      onViewPlayer={onViewPlayer}
      onChallengeUser={(username) => {
        onSelect(username);
        setReopened(false);
      }}
    />
  );
}

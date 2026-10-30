import { useEffect, useState } from "react";
import {
  DEFAULT_PROFILE_CUSTOM,
  getProfileCustom,
  resolvePinnedClips,
  type PinnableClip,
  type ProfileCustom,
} from "../../../../services/profileCustom";

/**
 * Resolve a customization's pins. Orphaned pins (game clips pinned before
 * Fix A, deleted clips) drop out of `custom.pinnedClipIds` too, so the editor
 * counts only real pins and the next save writes the cleaned list.
 */
async function withPins(uid: string, c: ProfileCustom): Promise<{ custom: ProfileCustom; pinned: PinnableClip[] }> {
  if (c.pinnedClipIds.length === 0) return { custom: c, pinned: [] };
  const { clips, keepIds } = await resolvePinnedClips(uid, c.pinnedClipIds);
  const pruned = keepIds.length === c.pinnedClipIds.length ? c : { ...c, pinnedClipIds: keepIds };
  return { custom: pruned, pinned: clips };
}

/** Loads a player's customization + pinned clips. `enabled` false skips all reads. */
export function useProfileCustom(uid: string, enabled: boolean) {
  const [custom, setCustom] = useState<ProfileCustom>(DEFAULT_PROFILE_CUSTOM);
  const [pinned, setPinned] = useState<PinnableClip[]>([]);

  useEffect(() => {
    if (!enabled || !uid) return;
    let alive = true;
    void (async () => {
      const c = (await getProfileCustom(uid)) ?? DEFAULT_PROFILE_CUSTOM;
      if (!alive) return;
      setCustom(c);
      const next = await withPins(uid, c);
      if (!alive) return;
      setCustom(next.custom);
      setPinned(next.pinned);
    })();
    return () => {
      alive = false;
    };
  }, [uid, enabled]);

  const applySaved = async (saved: ProfileCustom) => {
    setCustom(saved);
    const next = await withPins(uid, saved);
    setCustom(next.custom);
    setPinned(next.pinned);
  };

  return { custom, pinned, applySaved };
}

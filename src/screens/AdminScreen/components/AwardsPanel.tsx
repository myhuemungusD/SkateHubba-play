import { useAdminUserLookup } from "../useAdminUserLookup";
import { UserLookupForm } from "./UserLookupForm";
import { BadgeAwardPanel } from "./BadgeAwardPanel";
import { LockerAwardPanel } from "./LockerAwardPanel";

/**
 * Awards tab: one player lookup feeding both grant surfaces.
 *
 * The two sub-panels are keyed on the target uid so switching players
 * remounts them — otherwise a half-typed locker form or a stale badge list
 * would carry over onto the next player, which is exactly the kind of
 * mis-target a grant console must not make possible.
 */
export function AwardsPanel() {
  const lookup = useAdminUserLookup();
  const target = lookup.target;

  return (
    <section aria-label="Awards">
      <UserLookupForm lookup={lookup} label="Player username" />

      {target && (
        <>
          <p className="mb-4 font-display text-base text-white">@{target.username}</p>
          <BadgeAwardPanel key={`badges-${target.uid}`} uid={target.uid} username={target.username} />
          <LockerAwardPanel key={`locker-${target.uid}`} uid={target.uid} username={target.username} />
        </>
      )}
    </section>
  );
}

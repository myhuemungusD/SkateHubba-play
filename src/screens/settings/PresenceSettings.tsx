import { useState } from "react";
import { isSpotPresenceEnabled } from "../../lib/featureFlags";
import { getHideOnline, setHideOnline } from "../../services/onlineStatus";
import { getAutoRejoin, setAutoRejoin } from "../../services/spotPresence";
import { PrefRow, SectionHeader } from "./SettingsPrimitives";

/** Privacy switches for the online dot and the spot day pass. */
export function PresenceSettings({ uid }: { uid: string }) {
  const [hidden, setHidden] = useState(getHideOnline);
  const [auto, setAuto] = useState(getAutoRejoin);
  if (!isSpotPresenceEnabled()) return null;
  return (
    <>
      <SectionHeader title="PRESENCE" />
      <div className="space-y-2">
        <PrefRow
          title="Hide my online status"
          description="Others won't see when you're online. Nobody ever sees your exact location, only the spot you're checked in at."
          checked={hidden}
          onChange={(v) => {
            setHidden(v);
            void setHideOnline(uid, v).catch(() => undefined);
          }}
        />
        <PrefRow
          title="Auto check back in"
          description="After your first check-in at a spot today, walking back within about 500 ft checks you in again on its own."
          checked={auto}
          onChange={(v) => {
            setAuto(v);
            setAutoRejoin(v);
          }}
        />
      </div>
    </>
  );
}

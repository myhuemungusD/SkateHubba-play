import { useState } from "react";
import { isSpotPresenceEnabled } from "../../lib/featureFlags";
import { getHideOnline, setHideOnline } from "../../services/onlineStatus";
import { getAutoRejoin, hideFromSpot, setAutoRejoin } from "../../services/spotPresence";
import { PrefRow, SectionHeader, SettingsGroup } from "./SettingsPrimitives";

/** Privacy switches for the online dot and the spot day pass. */
export function PresenceSettings({ uid }: { uid: string }) {
  const [hidden, setHidden] = useState(getHideOnline);
  const [auto, setAuto] = useState(getAutoRejoin);
  if (!isSpotPresenceEnabled()) return null;
  return (
    <>
      <SectionHeader title="Presence" />
      <SettingsGroup>
        <PrefRow
          title="Hide my online status"
          description="Others won't see when you're online or which spot you're at, and you can't take spot challenges while hidden. Nobody ever sees your exact location."
          checked={hidden}
          onChange={(v) => {
            setHidden(v);
            void setHideOnline(uid, v).catch(() => undefined);
            if (v) void hideFromSpot().catch(() => undefined);
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
      </SettingsGroup>
    </>
  );
}

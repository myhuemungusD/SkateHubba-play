import { useEffect, useState } from "react";
import { isSpotPresenceEnabled } from "../../lib/featureFlags";
import { subscribeOnline, type OnlineState } from "../../services/onlineStatus";

const LABEL: Record<Exclude<OnlineState, "offline">, string> = {
  online: "Online",
  recent: "Active recently",
};

/**
 * Small dot on an avatar or name: green = online, amber = active in the last
 * half hour, nothing = offline or hidden. Renders nothing while the spot
 * presence switch is off.
 */
export function PresenceDot({ uid, className = "" }: { uid: string; className?: string }) {
  const on = isSpotPresenceEnabled();
  const [state, setState] = useState<OnlineState>("offline");
  useEffect(() => {
    if (!on) return;
    return subscribeOnline(uid, setState);
  }, [uid, on]);
  if (!on || state === "offline") return null;
  return (
    <span
      role="img"
      aria-label={LABEL[state]}
      title={LABEL[state]}
      data-testid={`presence-dot-${state}`}
      className={`inline-block w-2.5 h-2.5 rounded-full ring-2 ring-background ${
        state === "online" ? "bg-green-500" : "bg-amber-400"
      } ${className}`}
    />
  );
}

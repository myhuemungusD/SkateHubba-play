import { useState } from "react";
import { useNavigate } from "react-router";
import { MapPinCheck } from "lucide-react";
import { useAuthContext } from "../../context/AuthContext";
import { checkInAtSpot, describeCheckin, LocationError } from "../../services/mapCheckins";
import type { Spot } from "../../types/spot";
import { isSpotPresenceEnabled } from "../../lib/featureFlags";
import { rememberIfPassed } from "../../services/spotPresence";

/**
 * Check in at a spot. Location is asked for only on this tap, never when the
 * map opens. Signed-out visitors get a sign-in prompt instead.
 */
export function CheckInButton({
  spot,
}: {
  spot: Pick<Spot, "id" | "scope"> & Partial<Pick<Spot, "name" | "latitude" | "longitude">>;
}) {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => navigate("/auth")}
        className="mt-4 w-full py-2.5 rounded-xl border border-[#F97316] text-[#F97316] font-semibold text-sm"
      >
        Sign in to check in
      </button>
    );
  }

  const handleClick = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await checkInAtSpot(spot);
      if (isSpotPresenceEnabled()) rememberIfPassed(spot, outcome);
      setMessage(describeCheckin(outcome));
    } catch (err) {
      setMessage(err instanceof LocationError ? err.message : "Check-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        data-tutorial="spot-checkin"
        className="w-full py-2.5 rounded-xl border border-[#F97316] text-[#F97316] font-semibold text-sm
                   flex items-center justify-center gap-1.5 disabled:opacity-60"
      >
        <MapPinCheck size={16} aria-hidden="true" />
        {busy ? "Checking in…" : "Check in"}
      </button>
      {message && (
        <p role="status" className="mt-2 text-xs text-[#CCC] text-center">
          {message}
        </p>
      )}
    </div>
  );
}

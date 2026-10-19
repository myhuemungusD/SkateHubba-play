import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Users } from "lucide-react";
import { useAuthContext } from "../../context/AuthContext";
import {
  getAutoRejoin,
  leaveSpot,
  setAutoRejoin,
  subscribeSpotSkaters,
  type SpotSkater,
} from "../../services/spotPresence";
import { PresenceDot } from "./PresenceDot";

/**
 * "Who's skating": the only people you can challenge from a spot, like a
 * trainer battle. You must be checked in here yourself to challenge, and
 * nobody here means nobody to challenge.
 */
export function WhosSkatingHere({ spot }: { spot: { id: string; name: string } }) {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const [skaters, setSkaters] = useState<SpotSkater[] | null>(null);
  const [auto, setAuto] = useState(getAutoRejoin);
  const uid = user?.uid ?? null;

  useEffect(() => {
    if (!uid) return;
    return subscribeSpotSkaters(spot.id, setSkaters);
  }, [spot.id, uid]);

  if (!uid) return null;
  const meHere = skaters?.some((s) => s.uid === uid) ?? false;
  const others = (skaters ?? []).filter((s) => s.uid !== uid && s.username);

  return (
    <section className="mt-4" aria-label={`Who's skating at ${spot.name}`} data-testid="whos-skating-here">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-semibold text-sm text-white">
          <Users size={14} aria-hidden="true" />
          Who&apos;s skating
        </h3>
        <span className="text-xs text-muted">{meHere ? "You're here" : "You're not checked in here"}</span>
      </div>

      {skaters === null ? (
        <p className="mt-2 text-xs text-muted">Looking around…</p>
      ) : others.length === 0 ? (
        <p className="mt-2 text-sm text-[#CCC]" data-testid="whos-skating-here-empty">
          Nobody&apos;s here right now, so there&apos;s no one to challenge. Anyone who checks in shows up here.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {others.map((s) => (
            <li key={s.uid} className="flex items-center justify-between gap-2 rounded-xl bg-surface-alt px-3 py-2">
              <span className="flex items-center gap-2 min-w-0 text-sm text-white truncate">
                <PresenceDot uid={s.uid} />@{s.username}
              </span>
              <button
                type="button"
                disabled={!meHere}
                onClick={() => navigate(`/challenge?spot=${spot.id}&here=1&to=${encodeURIComponent(s.username)}`)}
                className="shrink-0 min-h-9 px-3 rounded-lg bg-[#F97316] text-white text-xs font-semibold disabled:opacity-50"
                aria-label={`Challenge @${s.username}`}
              >
                Challenge
              </button>
            </li>
          ))}
        </ul>
      )}
      {!meHere && others.length > 0 && <p className="mt-1.5 text-xs text-muted">Check in here to challenge them.</p>}

      <div className="mt-2 flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-[#CCC]">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAutoRejoin(e.target.checked);
              setAuto(e.target.checked);
            }}
          />
          Auto check back in today
        </label>
        {meHere && (
          <button
            type="button"
            onClick={() => {
              void leaveSpot(spot.id).catch(() => undefined);
            }}
            className="text-xs text-muted underline"
          >
            Leave spot
          </button>
        )}
      </div>
    </section>
  );
}

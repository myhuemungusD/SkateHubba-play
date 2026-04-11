import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getUidByUsername, type UserProfile } from "../services/users";
import { fetchSpotName } from "../services/spots";
import { analytics } from "../services/analytics";
import { Btn } from "../components/ui/Btn";
import { Field } from "../components/ui/Field";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { InviteButton } from "../components/InviteButton";
import { Leaderboard } from "../components/Leaderboard";
import {
  TargetIcon,
  FilmIcon,
  ClockIcon,
  XCircleIcon,
  SkullIcon,
  FlameIcon,
  MapPinIcon,
  type IconProps,
} from "../components/icons";

/**
 * Loose UUID shape check — rejects obvious garbage without being strict about
 * version bits. Matches the server's `UUID_REGEX` in apps/api/src/routes/spots.ts.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RULES: { Icon: (props: IconProps) => React.ReactNode; text: string; color: string }[] = [
  { Icon: TargetIcon, text: "You set the first trick", color: "text-brand-orange" },
  { Icon: FilmIcon, text: "One-take video only — no retries", color: "text-brand-orange" },
  { Icon: ClockIcon, text: "24 hours per turn or forfeit", color: "text-brand-orange" },
  { Icon: XCircleIcon, text: "Miss a match = earn a letter", color: "text-brand-red" },
  { Icon: SkullIcon, text: "Spell S.K.A.T.E. = you lose", color: "text-brand-red" },
];

export function ChallengeScreen({
  profile,
  onSend,
  onBack,
  initialOpponent = "",
  onViewPlayer,
  blockedUids,
}: {
  profile: UserProfile;
  onSend: (opponentUid: string, opponentUsername: string, spotId?: string | null) => Promise<void>;
  onBack: () => void;
  initialOpponent?: string;
  onViewPlayer?: (uid: string) => void;
  /** Set of UIDs the current user has blocked (prevents challenging blocked users). */
  blockedUids?: Set<string>;
}) {
  const [opponent, setOpponent] = useState(initialOpponent);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Optional spot passed in via ?spot=<uuid> (e.g. when the user taps
  // "Challenge from here" on a spot preview card in the map). Forwarded
  // to onSend so the created game carries location context. Only accepted
  // if it matches the canonical UUID shape — this is client-side
  // defense-in-depth; the API enforces the same invariant server-side.
  const [searchParams] = useSearchParams();
  const rawSpotId = searchParams.get("spot");
  const spotId = rawSpotId && UUID_SHAPE.test(rawSpotId) ? rawSpotId : null;

  // Spot name resolution is a tri-state: "loading" (initial, fetch in flight),
  // a string (resolved), or null (fetch settled with no name — either 404 or
  // error). We defer rendering the chip until we leave "loading" so the user
  // never sees a flash of the generic fallback label.
  type SpotNameState = "loading" | string | null;
  const [spotName, setSpotName] = useState<SpotNameState>("loading");
  useEffect(() => {
    if (!spotId) return;
    // Funnel event — fires once per ChallengeScreen mount with a spot,
    // including direct URL visits (e.g. a shared link).
    analytics.challengeFromSpot(spotId);

    const controller = new AbortController();
    fetchSpotName(spotId, controller.signal).then((name) => {
      if (!controller.signal.aborted) setSpotName(name);
    });
    return () => controller.abort();
  }, [spotId]);

  const submit = async () => {
    setError("");
    const normalized = opponent.toLowerCase().trim();
    if (normalized.length < 3) {
      setError("Enter a valid username");
      return;
    }
    if (normalized === profile.username) {
      setError("You can't challenge yourself");
      return;
    }

    setLoading(true);
    try {
      const uid = await getUidByUsername(normalized);
      if (!uid) {
        setError(`@${normalized} doesn't exist yet. They need to sign up first.`);
        return;
      }
      if (blockedUids?.has(uid)) {
        setError("You cannot challenge a blocked player. Unblock them first.");
        return;
      }
      await onSend(uid, normalized, spotId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start game");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#0A0A0A]/80">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.04] glass flex justify-between items-center mb-6">
        <button
          type="button"
          onClick={onBack}
          className="font-body text-sm text-muted hover:text-white flex items-center gap-1.5 transition-colors duration-300 rounded-lg py-1 -ml-1 px-1"
        >
          ← Back
        </button>
        <img
          src="/logonew.webp"
          alt=""
          draggable={false}
          className="h-5 w-auto select-none opacity-40"
          aria-hidden="true"
        />
        {/* Spacer to center logo */}
        <div className="w-14" aria-hidden="true" />
      </div>

      <div className="max-w-md mx-auto px-6">
        {spotId && spotName !== "loading" && (
          <div
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-orange/40 bg-brand-orange/10 px-3 py-1.5 text-xs text-brand-orange"
            data-testid="challenge-spot-chip"
            aria-label={spotName ? `Challenging at ${spotName}` : "Challenging at a saved spot"}
          >
            <MapPinIcon size={12} className="shrink-0" />
            <span className="truncate max-w-[16rem]">
              Challenging at <span className="font-semibold">{spotName ?? "a saved spot"}</span>
            </span>
          </div>
        )}
        <h1 className="font-display text-fluid-4xl text-white mb-2">Challenge</h1>
        <p className="font-body text-sm text-[#888] mb-8">Call someone out. First to S.K.A.T.E. loses.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          <Field
            label="Opponent Username"
            value={opponent}
            onChange={(v) => {
              if (!loading) setOpponent(v.replace(/[^a-zA-Z0-9_]/g, ""));
            }}
            placeholder="their_handle"
            icon="@"
            maxLength={20}
            autoFocus
          />

          <ErrorBanner message={error} onDismiss={() => setError("")} />

          <Btn onClick={submit} disabled={loading || opponent.length < 3}>
            {loading ? (
              "Finding..."
            ) : (
              <>
                <FlameIcon size={16} className="inline -mt-0.5" /> Send Challenge
              </>
            )}
          </Btn>

          <div className="p-5 rounded-2xl glass-card mb-4 mt-8">
            <h4 className="font-display text-xs tracking-[0.15em] text-subtle mb-3">RULES</h4>
            <div className="font-body text-sm text-muted space-y-2.5">
              {RULES.map(({ Icon, text, color }) => (
                <div key={text} className="flex items-center gap-2.5">
                  <Icon size={15} className={`${color} shrink-0`} /> {text}
                </div>
              ))}
            </div>
          </div>

          <InviteButton username={profile.username} className="mb-6" />
        </form>

        <Leaderboard
          currentUserUid={profile.uid}
          onChallengeUser={(username) => setOpponent(username)}
          onViewPlayer={onViewPlayer}
        />
      </div>
    </div>
  );
}

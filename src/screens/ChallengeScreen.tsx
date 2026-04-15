import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getUidByUsername, type UserProfile } from "../services/users";
import { fetchSpotName } from "../services/spots";
import { analytics } from "../services/analytics";
import { captureException } from "../lib/sentry";
import { getUserMessage } from "../utils/helpers";
import type { StartChallengeOptions } from "../context/GameContext";
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
  onSend: (opponentUid: string, opponentUsername: string, options?: StartChallengeOptions) => Promise<void>;
  onBack: () => void;
  initialOpponent?: string;
  onViewPlayer?: (uid: string) => void;
  /** Set of UIDs the current user has blocked (prevents challenging blocked users). */
  blockedUids?: Set<string>;
}) {
  const [opponent, setOpponent] = useState(initialOpponent);
  const [judge, setJudge] = useState("");
  const [judgePickerOpen, setJudgePickerOpen] = useState(false);
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

    // Referee picker is optional — only validate when the user filled it in.
    const judgeNormalized = judge.toLowerCase().trim();
    if (judgeNormalized && judgeNormalized.length < 3) {
      setError("Referee username is too short");
      return;
    }
    if (judgeNormalized && judgeNormalized === profile.username) {
      setError("You can't be your own referee");
      return;
    }
    if (judgeNormalized && judgeNormalized === normalized) {
      setError("Referee must be a third player");
      return;
    }

    setLoading(true);
    try {
      // Resolve both usernames in parallel via allSettled so the optional
      // referee lookup never holds up — or blows up — the required opponent
      // path. A transient network blip on the referee field surfaces as a
      // specific actionable error instead of a generic "Could not start
      // game", and the user can retry or remove the referee to proceed.
      const [opponentResult, judgeResult] = await Promise.allSettled([
        getUidByUsername(normalized),
        judgeNormalized ? getUidByUsername(judgeNormalized) : Promise.resolve(null),
      ]);

      if (opponentResult.status === "rejected") {
        captureException(opponentResult.reason, {
          extra: { context: "challenge.opponent_lookup", username: normalized },
        });
        setError(getUserMessage(opponentResult.reason, "Couldn't reach the player directory. Try again."));
        return;
      }

      const uid = opponentResult.value;
      if (!uid) {
        setError(`@${normalized} doesn't exist yet. They need to sign up first.`);
        return;
      }
      if (blockedUids?.has(uid)) {
        setError("You cannot challenge a blocked player. Unblock them first.");
        return;
      }

      let judgeUid: string | null = null;
      let judgeUsername: string | null = null;
      if (judgeNormalized) {
        if (judgeResult.status === "rejected") {
          captureException(judgeResult.reason, {
            extra: { context: "challenge.judge_lookup", username: judgeNormalized },
          });
          setError(`Couldn't look up referee @${judgeNormalized}. Try again or remove the referee to start now.`);
          return;
        }
        const resolvedJudgeUid = judgeResult.value;
        if (!resolvedJudgeUid) {
          setError(`Referee @${judgeNormalized} doesn't exist yet. They need to sign up first.`);
          return;
        }
        if (resolvedJudgeUid === uid) {
          setError("Referee must be a third player");
          return;
        }
        if (blockedUids?.has(resolvedJudgeUid)) {
          setError("You cannot nominate a blocked player as referee.");
          return;
        }
        judgeUid = resolvedJudgeUid;
        judgeUsername = judgeNormalized;
      }

      await onSend(uid, normalized, { spotId, judgeUid, judgeUsername });
    } catch (err: unknown) {
      // Reaches here only on onSend rejection — the lookups above settle to
      // explicit setError + return paths.
      setError(getUserMessage(err, "Could not start game"));
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
          aria-busy={loading}
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

          {/* Optional referee picker — collapsed by default. Games without a
              referee run on the honor system with no disputes or "Call BS"
              flows. */}
          <div className="mb-4">
            {!judgePickerOpen ? (
              <button
                type="button"
                onClick={() => setJudgePickerOpen(true)}
                disabled={loading}
                className="font-body text-sm text-brand-orange hover:text-white transition-colors disabled:opacity-40"
                data-testid="add-judge-toggle"
              >
                + Add a referee? <span className="text-xs text-subtle">(optional — unlocks disputes)</span>
              </button>
            ) : (
              <div>
                <Field
                  label="Referee Username (optional)"
                  value={judge}
                  onChange={(v) => {
                    if (!loading) setJudge(v.replace(/[^a-zA-Z0-9_]/g, ""));
                  }}
                  placeholder="their_handle"
                  icon="@"
                  maxLength={20}
                />
                <div className="flex items-center justify-between -mt-2 mb-2">
                  <p className="font-body text-xs text-subtle">
                    A third player who rules on disputes and &quot;Call BS&quot; claims.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setJudge("");
                      setJudgePickerOpen(false);
                    }}
                    disabled={loading}
                    className="font-body text-xs text-subtle hover:text-brand-red transition-colors disabled:opacity-40 ml-2 shrink-0"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>

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

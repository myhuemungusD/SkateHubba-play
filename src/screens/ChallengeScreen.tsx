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
import { RulesSheet } from "../components/RulesSheet";
import { FlameIcon, MapPinIcon } from "../components/icons";

/**
 * Loose UUID shape check — rejects obvious garbage without being strict about
 * version bits. Matches the server's `UUID_REGEX` in apps/api/src/routes/spots.ts.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches the server-side minimum and the submit-path guard below. */
const MIN_USERNAME_LENGTH = 3;

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
  const [rulesOpen, setRulesOpen] = useState(false);
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

  // Progressive disclosure gate — referee/spot/invite/rules stay hidden
  // until the opponent field has a plausibly valid username. Drops upfront
  // visual load so the user commits to a name before weighing the extras.
  // Intentionally a local-only check: no directory lookup until Send.
  const normalizedOpponent = opponent.toLowerCase().trim();
  const usernameLooksValid =
    normalizedOpponent.length >= MIN_USERNAME_LENGTH && normalizedOpponent !== profile.username;

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
    if (normalized.length < MIN_USERNAME_LENGTH) {
      setError("Enter a valid username");
      return;
    }
    if (normalized === profile.username) {
      setError("You can't challenge yourself");
      return;
    }

    // Referee picker is optional — only validate when the user filled it in.
    const judgeNormalized = judge.toLowerCase().trim();
    if (judgeNormalized && judgeNormalized.length < MIN_USERNAME_LENGTH) {
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
      <div className="px-5 pt-safe pb-4 border-b border-white/[0.04] glass flex justify-between items-center mb-6">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to lobby"
          className="touch-target -ml-2 inline-flex items-center gap-1.5 rounded-lg font-body text-sm text-muted hover:text-white transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
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
            name="opponent-username"
            value={opponent}
            onChange={(v) => {
              if (!loading) setOpponent(v.replace(/[^a-zA-Z0-9_]/g, ""));
            }}
            placeholder="their_handle"
            icon="@"
            maxLength={20}
            autoFocus
            disabled={loading}
            autoComplete="off"
            inputMode="text"
            enterKeyHint="send"
          />

          <ErrorBanner message={error} onDismiss={() => setError("")} />

          <Btn onClick={submit} disabled={loading || opponent.length < MIN_USERNAME_LENGTH}>
            {loading ? (
              "Finding..."
            ) : (
              <>
                <FlameIcon size={16} className="inline -mt-0.5" /> Send Challenge
              </>
            )}
          </Btn>

          {/* Progressive-disclosure block: referee/spot context/rules/invite
              only appear once the opponent field is plausibly a real username.
              State for judge + rulesOpen is preserved across re-opens so a
              user who briefly clears the opponent field doesn't lose work. */}
          {usernameLooksValid && (
            <div data-testid="challenge-extras">
              {spotId && spotName !== "loading" && (
                <div
                  className="mt-6 inline-flex items-center gap-2 rounded-full border border-brand-orange/40 bg-brand-orange/10 px-3 py-1.5 text-xs text-brand-orange"
                  data-testid="challenge-spot-chip"
                  aria-label={spotName ? `Challenging at ${spotName}` : "Challenging at a saved spot"}
                >
                  <MapPinIcon size={12} className="shrink-0" />
                  <span className="truncate max-w-[16rem]">
                    Challenging at <span className="font-semibold">{spotName ?? "a saved spot"}</span>
                  </span>
                </div>
              )}

              <div className="mt-6 mb-4">
                {!judgePickerOpen ? (
                  <button
                    type="button"
                    onClick={() => setJudgePickerOpen(true)}
                    disabled={loading}
                    className="touch-target inline-flex items-center gap-1 font-body text-sm text-brand-orange hover:text-white transition-colors disabled:opacity-40 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                    data-testid="add-judge-toggle"
                  >
                    + Add a referee? <span className="text-xs text-subtle">(optional — unlocks disputes)</span>
                  </button>
                ) : (
                  <div>
                    <Field
                      label="Referee Username (optional)"
                      name="referee-username"
                      value={judge}
                      onChange={(v) => {
                        if (!loading) setJudge(v.replace(/[^a-zA-Z0-9_]/g, ""));
                      }}
                      placeholder="their_handle"
                      icon="@"
                      maxLength={20}
                      disabled={loading}
                      autoComplete="off"
                      inputMode="text"
                      enterKeyHint="send"
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
                        className="touch-target inline-flex items-center justify-center font-body text-xs text-subtle hover:text-brand-red transition-colors disabled:opacity-40 ml-2 shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setRulesOpen(true)}
                className="font-body text-xs text-subtle hover:text-brand-orange underline underline-offset-4 decoration-subtle/40 hover:decoration-brand-orange transition-colors min-h-[44px] inline-flex items-center"
                data-testid="open-rules-sheet"
              >
                See the rules
              </button>

              <InviteButton username={profile.username} className="mt-6 mb-6" />
            </div>
          )}
        </form>

        <Leaderboard
          currentUserUid={profile.uid}
          onChallengeUser={(username) => setOpponent(username)}
          onViewPlayer={onViewPlayer}
        />
      </div>

      {rulesOpen && <RulesSheet onClose={() => setRulesOpen(false)} />}
    </div>
  );
}

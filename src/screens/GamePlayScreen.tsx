import { useState, useRef, useCallback, useEffect } from "react";
import type { GameDoc } from "../services/games";
import {
  setTrick,
  failSetTrick,
  submitMatchAttempt,
  resolveDispute,
  forfeitExpiredTurn,
  callBSOnSetTrick,
  judgeRuleSetTrick,
  acceptJudgeInvite,
  declineJudgeInvite,
  isJudgeActive,
} from "../services/games";
import { uploadVideo, type UploadProgress as UploadProgressData } from "../services/storage";
import type { UserProfile } from "../services/users";
import { isFirebaseStorageUrl, parseFirebaseError } from "../utils/helpers";
import { captureException } from "../lib/sentry";
import { logger } from "../services/logger";
import { playHaptic } from "../services/haptics";
import { Btn } from "../components/ui/Btn";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { LetterDisplay } from "../components/LetterDisplay";
import { Timer } from "../components/Timer";
import { VideoRecorder } from "../components/VideoRecorder";
import { UploadProgress } from "../components/UploadProgress";
import { TurnHistoryViewer } from "../components/TurnHistoryViewer";
import { WaitingScreen } from "../components/WaitingScreen";
import { ReportModal } from "../components/ReportModal";
import { ProUsername } from "../components/ProUsername";

export function GamePlayScreen({ game, profile, onBack }: { game: GameDoc; profile: UserProfile; onBack: () => void }) {
  const [trickName, setTrickName] = useState("");
  const trickNameRef = useRef(trickName);
  trickNameRef.current = trickName;
  const recorderRevealedRef = useRef(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoRecorded, setVideoRecorded] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [setterAction, setSetterAction] = useState<"landed" | "missed" | null>(null);
  const [matcherLanded, setMatcherLanded] = useState<boolean | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressData | null>(null);
  const [forfeitChecked, setForfeitChecked] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    if (forfeitChecked || game.status !== "active") return;
    const deadline = game.turnDeadline?.toMillis?.() ?? 0;
    if (deadline > 0 && Date.now() >= deadline) {
      forfeitExpiredTurn(game.id).catch((err) => {
        logger.warn("forfeit_check_failed", {
          error: parseFirebaseError(err),
          gameId: game.id,
        });
        captureException(err, { extra: { context: "forfeitExpiredTurn", gameId: game.id } });
      });
    }
    setForfeitChecked(true);
  }, [game.id, game.status, forfeitChecked, game.turnDeadline]);

  const isPlayer = game.player1Uid === profile.uid || game.player2Uid === profile.uid;
  const isJudge = !!game.judgeId && game.judgeId === profile.uid;
  const judgeActive = isJudgeActive(game);

  const isSetter = isPlayer && game.phase === "setting" && game.currentSetter === profile.uid;
  const isMatcher = isPlayer && game.phase === "matching" && game.currentTurn === profile.uid;
  // Dispute (matcher claimed landed) and setReview (matcher called BS) are
  // judge-only. The setter never self-judges in the judge-enabled flow.
  const isDisputeReviewer = isJudge && game.phase === "disputable" && game.currentTurn === profile.uid;
  const isSetTrickReviewer = isJudge && game.phase === "setReview" && game.currentTurn === profile.uid;

  // Resolve dispute: judge accepts or disputes the matcher's "landed" claim
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [lastDisputeAction, setLastDisputeAction] = useState<boolean | null>(null);
  const disputeSubmittedRef = useRef(false);
  const handleResolveDispute = useCallback(
    async (accept: boolean) => {
      if (disputeSubmittedRef.current) return;
      disputeSubmittedRef.current = true;
      setLastDisputeAction(accept);
      setDisputeSubmitting(true);
      setError("");
      try {
        await resolveDispute(game.id, accept);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to resolve dispute");
        captureException(err, { extra: { context: "resolveDispute", gameId: game.id, accept } });
        disputeSubmittedRef.current = false;
      } finally {
        setDisputeSubmitting(false);
      }
    },
    [game.id],
  );

  // Judge rules on a "Call BS" of the setter's trick
  const [setReviewSubmitting, setSetReviewSubmitting] = useState(false);
  const [lastSetReviewAction, setLastSetReviewAction] = useState<boolean | null>(null);
  const setReviewSubmittedRef = useRef(false);
  const handleRuleSetTrick = useCallback(
    async (clean: boolean) => {
      if (setReviewSubmittedRef.current) return;
      setReviewSubmittedRef.current = true;
      setLastSetReviewAction(clean);
      setSetReviewSubmitting(true);
      setError("");
      try {
        await judgeRuleSetTrick(game.id, clean);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to rule");
        captureException(err, { extra: { context: "judgeRuleSetTrick", gameId: game.id, clean } });
        setReviewSubmittedRef.current = false;
      } finally {
        setSetReviewSubmitting(false);
      }
    },
    [game.id],
  );

  // Matcher calls BS on the setter's trick
  const [callBSSubmitting, setCallBSSubmitting] = useState(false);
  const callBSSubmittedRef = useRef(false);
  const handleCallBS = useCallback(async () => {
    if (callBSSubmittedRef.current) return;
    callBSSubmittedRef.current = true;
    setCallBSSubmitting(true);
    setError("");
    try {
      await callBSOnSetTrick(game.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to call BS");
      captureException(err, { extra: { context: "callBSOnSetTrick", gameId: game.id } });
      callBSSubmittedRef.current = false;
    } finally {
      setCallBSSubmitting(false);
    }
  }, [game.id]);

  // Judge can accept or decline a pending invite
  const [judgeActionSubmitting, setJudgeActionSubmitting] = useState(false);
  const handleJudgeAccept = useCallback(async () => {
    setJudgeActionSubmitting(true);
    setError("");
    try {
      await acceptJudgeInvite(game.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept referee invite");
      captureException(err, { extra: { context: "acceptJudgeInvite", gameId: game.id } });
    } finally {
      setJudgeActionSubmitting(false);
    }
  }, [game.id]);
  const handleJudgeDecline = useCallback(async () => {
    setJudgeActionSubmitting(true);
    setError("");
    try {
      await declineJudgeInvite(game.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to decline referee invite");
      captureException(err, { extra: { context: "declineJudgeInvite", gameId: game.id } });
    } finally {
      setJudgeActionSubmitting(false);
    }
  }, [game.id]);

  const opponentName = game.player1Uid === profile.uid ? game.player2Username : game.player1Username;
  const opponentIsPro = game.player1Uid === profile.uid ? game.player2IsVerifiedPro : game.player1IsVerifiedPro;
  const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
  const setterIsPro = game.player1Uid === game.currentSetter ? game.player1IsVerifiedPro : game.player2IsVerifiedPro;
  const matcherUsername = game.currentSetter === game.player1Uid ? game.player2Username : game.player1Username;

  const trimmedTrickName = trickName.trim();
  if (isSetter && trimmedTrickName) recorderRevealedRef.current = true;
  const showRecorder = !isSetter || recorderRevealedRef.current;

  const submittedRef = useRef(false);
  const submitSetterTrick = useCallback(
    async (blob: Blob | null) => {
      /* v8 ignore start -- double-submit guard; ref always false on first call in tests */
      if (submittedRef.current) return;
      /* v8 ignore stop */
      submittedRef.current = true;
      setSetterAction("landed");
      playHaptic("trick_landed");
      setSubmitting(true);
      setError("");
      try {
        let videoUrl: string | null = null;
        if (blob) {
          setUploadProgress({ bytesTransferred: 0, totalBytes: blob.size, percent: 0 });
          videoUrl = await uploadVideo(game.id, game.turnNumber, "set", blob, setUploadProgress);
        }
        setUploadProgress(null);
        await setTrick(game.id, trickNameRef.current.trim(), videoUrl);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to send trick");
        captureException(err, { extra: { context: "submitSetterTrick", gameId: game.id } });
        setUploadProgress(null);
        submittedRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [game.id, game.turnNumber],
  );

  const submitSetterMissed = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSetterAction("missed");
    playHaptic("trick_missed");
    setSubmitting(true);
    setError("");
    try {
      await failSetTrick(game.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit result");
      submittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [game.id]);

  const handleRecorded = useCallback((blob: Blob | null) => {
    setVideoBlob(blob);
    setVideoRecorded(true);
  }, []);

  // Submit match attempt with self-judged result (landed/missed)
  const matchSubmittedRef = useRef(false);
  const submitMatchWithCall = useCallback(
    async (landed: boolean) => {
      /* v8 ignore start -- double-submit guard; ref always false on first call in tests */
      if (matchSubmittedRef.current) return;
      /* v8 ignore stop */
      matchSubmittedRef.current = true;
      setMatcherLanded(landed);
      playHaptic(landed ? "trick_landed" : "trick_missed");
      setSubmitting(true);
      setError("");
      try {
        let videoUrl: string | null = null;
        if (videoBlob) {
          setUploadProgress({ bytesTransferred: 0, totalBytes: videoBlob.size, percent: 0 });
          videoUrl = await uploadVideo(game.id, game.turnNumber, "match", videoBlob, setUploadProgress);
        }
        setUploadProgress(null);
        await submitMatchAttempt(game.id, videoUrl, landed);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to submit attempt");
        captureException(err, { extra: { context: "submitMatchAttempt", gameId: game.id } });
        setUploadProgress(null);
        matchSubmittedRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [game.id, game.turnNumber, videoBlob],
  );

  const myLetters = game.player1Uid === profile.uid ? game.p1Letters : game.p2Letters;
  const theirLetters = game.player1Uid === profile.uid ? game.p2Letters : game.p1Letters;
  const deadline = game.turnDeadline?.toMillis?.() || Date.now() + 86400000;

  // Judge with a pending invite — show accept/decline card before anything else.
  const isJudgeInvitePending = isJudge && game.judgeStatus === "pending" && game.status === "active";

  // ── Waiting screen (not your turn) ──
  if (!isSetter && !isMatcher && !isDisputeReviewer && !isSetTrickReviewer && !isJudgeInvitePending) {
    return <WaitingScreen game={game} profile={profile} onBack={onBack} />;
  }

  return (
    <div className="min-h-dvh bg-[#0A0A0A]/80 pb-10">
      <div className="px-5 py-4 border-b border-white/[0.04] glass flex justify-between items-center">
        <button
          type="button"
          onClick={onBack}
          className="font-body text-sm text-muted hover:text-white transition-colors duration-300 rounded-lg py-1 px-1 -ml-1"
        >
          ← Games
        </button>
        <img
          src="/logonew.webp"
          alt=""
          draggable={false}
          className="h-5 w-auto select-none opacity-40"
          aria-hidden="true"
        />
        <div className="flex items-center gap-3">
          <Timer deadline={deadline} />
          {/* Only players can flag opponents — judges are observers. */}
          {isPlayer && (
            <button
              type="button"
              onClick={() => setShowReport(true)}
              disabled={reported}
              aria-label="Report opponent"
              title={reported ? "Already reported" : "Report opponent"}
              className="font-body text-xs text-subtle hover:text-brand-red transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {reported ? "Reported" : "Flag"}
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pt-5 max-w-md mx-auto">
        {/* Judge state badge — visible to players so they know whether
            disputes/BS are available. Judges themselves always know. */}
        {!isJudge && game.judgeUsername && game.judgeStatus === "pending" && game.status === "active" && (
          <div
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-subtle/40 bg-white/[0.03] px-3 py-1 text-[11px] text-subtle"
            data-testid="judge-pending-badge"
          >
            <span className="font-display tracking-wider">REFEREE PENDING</span>
            <span className="font-body">@{game.judgeUsername} — honor system applies</span>
          </div>
        )}
        {!isJudge && game.judgeUsername && game.judgeStatus === "accepted" && game.status === "active" && (
          <div
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-orange/30 bg-brand-orange/[0.06] px-3 py-1 text-[11px] text-brand-orange"
            data-testid="judge-active-badge"
          >
            <span className="font-display tracking-wider">REFEREE</span>
            <span className="font-body">@{game.judgeUsername} rules disputes</span>
          </div>
        )}
        {!isJudge && game.judgeUsername && game.judgeStatus === "declined" && game.status === "active" && (
          <div
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-subtle/40 bg-white/[0.03] px-3 py-1 text-[11px] text-subtle"
            data-testid="judge-declined-badge"
          >
            <span className="font-display tracking-wider">NO REFEREE</span>
            <span className="font-body">Honor system</span>
          </div>
        )}
        {isJudge ? (
          <div className="flex justify-center gap-5 mb-6">
            <LetterDisplay
              count={game.p1Letters}
              name={`@${game.player1Username}`}
              active={game.currentSetter === game.player1Uid && game.phase === "setting"}
              isVerifiedPro={game.player1IsVerifiedPro}
            />
            <div className="flex items-center font-display text-2xl text-subtle">VS</div>
            <LetterDisplay
              count={game.p2Letters}
              name={`@${game.player2Username}`}
              active={game.currentSetter === game.player2Uid && game.phase === "setting"}
              isVerifiedPro={game.player2IsVerifiedPro}
            />
          </div>
        ) : (
          <div className="flex justify-center gap-5 mb-6">
            <LetterDisplay
              count={myLetters}
              name={`@${profile.username}`}
              testId={`letter-display-${profile.username}`}
              active={isSetter}
              isVerifiedPro={profile.isVerifiedPro}
            />
            <div className="flex items-center font-display text-2xl text-subtle">VS</div>
            <LetterDisplay
              count={theirLetters}
              name={`@${opponentName}`}
              testId={`letter-display-${opponentName}`}
              active={isMatcher}
              isVerifiedPro={opponentIsPro}
            />
          </div>
        )}

        {/* Judges never see the setter/matcher banner — they only ever review. */}
        {!isJudge &&
          (isSetter ? (
            <div className="text-center mb-5 rounded-2xl border bg-brand-orange/[0.06] backdrop-blur-sm border-brand-orange/30 shadow-[0_0_20px_rgba(255,107,0,0.06)]">
              <label
                htmlFor="trickNameInput"
                className="font-display text-[11px] tracking-[0.2em] text-brand-orange block pt-3"
              >
                TRICK NAME
              </label>
              <input
                id="trickNameInput"
                type="text"
                value={trickName}
                onChange={(e) => setTrickName(e.target.value)}
                placeholder="Name your trick"
                maxLength={60}
                disabled={videoRecorded}
                autoCapitalize="words"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="w-full bg-transparent text-center font-display text-base tracking-wider text-brand-orange py-1 px-4 outline-none placeholder:text-brand-orange/60 disabled:opacity-40 disabled:cursor-not-allowed"
              />
              {trimmedTrickName && (
                <p className="font-body text-xs text-brand-orange/80 pb-1">Set your {trimmedTrickName}</p>
              )}
              {!showRecorder && !trimmedTrickName && (
                <span className="text-xs text-faint pb-2 block">Name your trick to start recording</span>
              )}
            </div>
          ) : (
            <div className="text-center py-3 px-5 mb-5 rounded-2xl border bg-brand-green/[0.06] backdrop-blur-sm border-brand-green/30 shadow-[0_0_20px_rgba(0,230,118,0.06)]">
              <span className="font-display text-xl tracking-wider text-brand-green">
                Match <ProUsername username={setterUsername} isVerifiedPro={setterIsPro} />
                &apos;s {game.currentTrickName || "trick"}
              </span>
            </div>
          ))}

        {isMatcher && (
          <div className="mb-5">
            <p className="font-display text-sm tracking-wider text-brand-orange mb-2">
              <ProUsername username={setterUsername} isVerifiedPro={setterIsPro} />
              &apos;s TRICK
            </p>
            {game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) ? (
              <video
                src={game.currentTrickVideoUrl}
                controls
                playsInline
                preload="metadata"
                aria-label={`Video of ${game.currentTrickName || "trick"} set by ${setterUsername}`}
                className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
              />
            ) : (
              <p className="font-body text-sm text-subtle text-center py-4">
                No video recorded — just match the trick!
              </p>
            )}

            {/* "Call BS" is only available when a judge is actively seated AND
                the matcher hasn't started recording yet. Clicking it hands the
                set video to the judge instead of attempting the trick. */}
            {judgeActive && !videoRecorded && !callBSSubmitting && !error && (
              <div className="mt-3" role="group" aria-label="Attempt or call BS">
                <Btn
                  onClick={handleCallBS}
                  variant="secondary"
                  disabled={callBSSubmitting}
                  data-testid="call-bs-button"
                >
                  Call BS on this trick
                </Btn>
                <p className="font-body text-xs text-subtle mt-2 text-center">
                  Referee @{game.judgeUsername} will rule clean or sketchy.
                </p>
              </div>
            )}
            {callBSSubmitting && (
              <p className="font-display text-sm text-amber-400 mt-3 text-center animate-pulse">
                Sending to referee...
              </p>
            )}
          </div>
        )}

        {/* Judges never record — they only review. */}
        {!isJudge && (isSetter || isMatcher) && showRecorder && (
          <VideoRecorder
            onRecorded={handleRecorded}
            label={isSetter ? "Land Your Trick" : `Match the ${game.currentTrickName || "Trick"}`}
            autoOpen={isSetter}
            doneLabel="Recorded"
          />
        )}

        <ErrorBanner message={error} onDismiss={() => setError("")} />

        {isSetter && videoRecorded && !submitting && !error && (
          <div className="mt-5" role="group" aria-label="Did you land the trick?">
            <p className="font-display text-xl text-white text-center mb-4">Did you land it?</p>
            <div className="flex gap-3">
              <Btn onClick={() => submitSetterTrick(videoBlob)} variant="success" disabled={submitting}>
                ✓ Landed
              </Btn>
              <Btn onClick={submitSetterMissed} variant="danger" disabled={submitting}>
                ✗ Missed
              </Btn>
            </div>
          </div>
        )}
        {isSetter && submitting && (
          <div className="mt-5 text-center">
            {uploadProgress ? (
              <UploadProgress progress={uploadProgress} />
            ) : (
              <span className="font-display text-lg text-brand-orange tracking-wider animate-pulse">
                {setterAction === "missed" ? "Passing turn..." : `Sending to @${opponentName}...`}
              </span>
            )}
          </div>
        )}
        {isSetter && !submitting && error && videoRecorded && (
          <div className="mt-5">
            <Btn
              onClick={setterAction === "missed" ? submitSetterMissed : () => submitSetterTrick(videoBlob)}
              variant="secondary"
            >
              Retry
            </Btn>
          </div>
        )}

        {isMatcher && videoRecorded && !submitting && !error && (
          <div className="mt-5" role="group" aria-label="Did you land the trick?">
            {uploadProgress ? (
              <UploadProgress progress={uploadProgress} />
            ) : (
              <>
                <p className="font-display text-xl text-white text-center mb-4">Did you land it?</p>
                <div className="flex gap-3">
                  <Btn onClick={() => submitMatchWithCall(true)} variant="success" disabled={submitting}>
                    ✓ Landed
                  </Btn>
                  <Btn onClick={() => submitMatchWithCall(false)} variant="danger" disabled={submitting}>
                    ✗ Missed
                  </Btn>
                </div>
              </>
            )}
          </div>
        )}
        {isMatcher && submitting && !uploadProgress && (
          <div className="mt-5 text-center">
            <span className="font-display text-lg text-brand-green tracking-wider animate-pulse">Submitting...</span>
          </div>
        )}
        {isMatcher && !submitting && error && videoRecorded && matcherLanded !== null && (
          <div className="mt-5">
            <Btn onClick={() => submitMatchWithCall(matcherLanded)} variant="secondary">
              Retry
            </Btn>
          </div>
        )}

        {isDisputeReviewer && (
          <div className="mt-5">
            <div className="text-center py-3 px-5 mb-5 rounded-2xl border bg-amber-500/[0.06] backdrop-blur-sm border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.06)]">
              <span className="font-display text-sm tracking-wider text-amber-400">REFEREE&apos;S CALL</span>
              <p className="font-body text-sm text-muted mt-1">
                @{matcherUsername} claims they landed @{setterUsername}&apos;s {game.currentTrickName || "trick"}. Watch
                both videos and rule.
              </p>
            </div>

            {game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) && (
              <div className="mb-4">
                <p className="font-display text-sm tracking-wider text-brand-orange mb-2">
                  @{setterUsername.toUpperCase()}&apos;S SET
                </p>
                <video
                  src={game.currentTrickVideoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={`${setterUsername}'s ${game.currentTrickName || "trick"} video`}
                  className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
                />
              </div>
            )}

            {game.matchVideoUrl && isFirebaseStorageUrl(game.matchVideoUrl) && (
              <div className="mb-4">
                <p className="font-display text-sm tracking-wider text-brand-green mb-2">
                  @{matcherUsername.toUpperCase()}&apos;S ATTEMPT
                </p>
                <video
                  src={game.matchVideoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={`${matcherUsername}'s match attempt video`}
                  className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
                />
              </div>
            )}

            {!game.currentTrickVideoUrl && !game.matchVideoUrl && (
              <p className="font-body text-sm text-subtle text-center py-4 mb-4">
                No videos recorded — rule based on the claim.
              </p>
            )}

            {!disputeSubmitting && !error && (
              <div role="group" aria-label="Rule landed or missed">
                <p className="font-display text-xl text-white text-center mb-4">Did they land it?</p>
                <div className="flex gap-3">
                  <Btn onClick={() => handleResolveDispute(true)} variant="success" disabled={disputeSubmitting}>
                    Landed
                  </Btn>
                  <Btn onClick={() => handleResolveDispute(false)} variant="danger" disabled={disputeSubmitting}>
                    Missed
                  </Btn>
                </div>
              </div>
            )}
            {disputeSubmitting && (
              <div className="text-center">
                <span className="font-display text-lg text-amber-400 tracking-wider animate-pulse">Resolving...</span>
              </div>
            )}
            {!disputeSubmitting && error && lastDisputeAction !== null && (
              <div className="mt-3">
                <Btn onClick={() => handleResolveDispute(lastDisputeAction)} variant="secondary">
                  Retry
                </Btn>
              </div>
            )}
          </div>
        )}

        {isSetTrickReviewer && (
          <div className="mt-5">
            <div className="text-center py-3 px-5 mb-5 rounded-2xl border bg-amber-500/[0.06] backdrop-blur-sm border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.06)]">
              <span className="font-display text-sm tracking-wider text-amber-400">CALL BS REVIEW</span>
              <p className="font-body text-sm text-muted mt-1">
                @{matcherUsername} called BS on @{setterUsername}&apos;s {game.currentTrickName || "trick"}. Rule clean
                or sketchy.
              </p>
            </div>

            {game.currentTrickVideoUrl && isFirebaseStorageUrl(game.currentTrickVideoUrl) ? (
              <div className="mb-4">
                <p className="font-display text-sm tracking-wider text-brand-orange mb-2">
                  @{setterUsername.toUpperCase()}&apos;S SET
                </p>
                <video
                  src={game.currentTrickVideoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={`${setterUsername}'s ${game.currentTrickName || "trick"} video`}
                  className="w-full max-w-[360px] mx-auto aspect-[9/16] rounded-2xl bg-black object-cover border border-border"
                />
              </div>
            ) : (
              <p className="font-body text-sm text-subtle text-center py-4 mb-4">
                No set video recorded — rule based on the claim.
              </p>
            )}

            {!setReviewSubmitting && !error && (
              <div role="group" aria-label="Rule clean or sketchy">
                <p className="font-display text-xl text-white text-center mb-4">Is the set clean?</p>
                <div className="flex gap-3">
                  <Btn onClick={() => handleRuleSetTrick(true)} variant="success" disabled={setReviewSubmitting}>
                    Clean
                  </Btn>
                  <Btn onClick={() => handleRuleSetTrick(false)} variant="danger" disabled={setReviewSubmitting}>
                    Sketchy
                  </Btn>
                </div>
              </div>
            )}
            {setReviewSubmitting && (
              <div className="text-center">
                <span className="font-display text-lg text-amber-400 tracking-wider animate-pulse">Ruling...</span>
              </div>
            )}
            {!setReviewSubmitting && error && lastSetReviewAction !== null && (
              <div className="mt-3">
                <Btn onClick={() => handleRuleSetTrick(lastSetReviewAction)} variant="secondary">
                  Retry
                </Btn>
              </div>
            )}
          </div>
        )}

        {isJudgeInvitePending && (
          <div className="mt-5" data-testid="judge-invite-card">
            <div className="text-center py-4 px-5 mb-5 rounded-2xl border bg-brand-orange/[0.06] backdrop-blur-sm border-brand-orange/30 shadow-[0_0_20px_rgba(255,107,0,0.06)]">
              <span className="font-display text-sm tracking-wider text-brand-orange">REFEREE INVITE</span>
              <p className="font-body text-sm text-muted mt-1">
                @{game.player1Username} asked you to referee their game vs @{game.player2Username}. Accept to rule on
                disputes and &quot;Call BS&quot; claims. Declining (or no response in 24h) lets the game continue on the
                honor system.
              </p>
            </div>

            {!judgeActionSubmitting && (
              <div className="flex gap-3" role="group" aria-label="Accept or decline referee invite">
                <Btn onClick={handleJudgeAccept} variant="success" disabled={judgeActionSubmitting}>
                  Accept
                </Btn>
                <Btn onClick={handleJudgeDecline} variant="secondary" disabled={judgeActionSubmitting}>
                  Decline
                </Btn>
              </div>
            )}
            {judgeActionSubmitting && (
              <p className="font-display text-sm text-brand-orange text-center animate-pulse">Submitting...</p>
            )}
          </div>
        )}

        {(game.turnHistory?.length ?? 0) > 0 && (
          <TurnHistoryViewer turns={game.turnHistory!} currentUserUid={profile.uid} />
        )}
      </div>

      {showReport && (
        <ReportModal
          reporterUid={profile.uid}
          reportedUid={game.player1Uid === profile.uid ? game.player2Uid : game.player1Uid}
          reportedUsername={opponentName}
          gameId={game.id}
          onClose={() => setShowReport(false)}
          onSubmitted={() => {
            setShowReport(false);
            setReported(true);
          }}
        />
      )}
    </div>
  );
}

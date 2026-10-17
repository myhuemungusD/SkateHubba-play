import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GameDoc } from "../../services/games";
import { failSetTrick, forfeitExpiredTurn, isJudgeActive, setTrick, submitMatchAttempt } from "../../services/games";
import { canRaiseDispute } from "../../services/disputes";
import { uploadVideo, type UploadProgress as UploadProgressData } from "../../services/storage";
import type { UserProfile } from "../../services/users";
import { captureException } from "../../lib/sentry";
import { logger } from "../../services/logger";
import { playHaptic } from "../../services/haptics";
import { parseFirebaseError } from "../../utils/helpers";
import { isTrickPickerEnabled } from "../../lib/featureFlags";
import { formatTrickDisplayName, rememberRecentTrick, type TrickSelection } from "../../constants/tricks";
import { useCommunityDispute } from "./useCommunityDispute";
import { useGameReviewActions } from "./useGameReviewActions";
import type { GamePlayController } from "./gamePlayController.types";

export type { GamePlayController } from "./gamePlayController.types";

export function useGamePlayController(game: GameDoc, profile: UserProfile): GamePlayController {
  const [trickName, setTrickName] = useState("");
  const [trickSelection, setTrickSelectionState] = useState<TrickSelection | null>(null);
  // Mirrors the committed trick name for submitSetterTrick, which reads it
  // after the upload await. Synced in a layout effect, not during render.
  const trickNameRef = useRef(trickName);
  const trickSelectionRef = useRef(trickSelection);
  useLayoutEffect(() => {
    trickNameRef.current = trickName;
    trickSelectionRef.current = trickSelection;
  }, [trickName, trickSelection]);
  const setTrickSelection = useCallback((selection: TrickSelection | null) => {
    setTrickSelectionState(selection);
    setTrickName(selection ? formatTrickDisplayName(selection) : "");
  }, []);
  // Sticky: once the setter has typed a trick name the recorder stays
  // revealed even if the field is cleared again.
  const [recorderRevealed, setRecorderRevealed] = useState(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoRecorded, setVideoRecorded] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [setterAction, setSetterAction] = useState<"landed" | "missed" | null>(null);
  const [matcherLanded, setMatcherLanded] = useState<boolean | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressData | null>(null);
  // One forfeit check per mounted game screen. A ref, not state: nothing
  // renders from it, it only guards the effect below.
  const forfeitCheckedRef = useRef(false);
  const [showReport, setShowReport] = useState(false);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    if (forfeitCheckedRef.current || game.status !== "active") return;
    // A frozen review phase pins the (possibly-expired) turnDeadline; firing a
    // forfeit here would be a wasted, rules-rejected write against a game the
    // dispute referee — not the turn sweep — is responsible for advancing.
    if (game.phase === "pendingReview" || game.phase === "communityReview") {
      forfeitCheckedRef.current = true;
      return;
    }
    const deadline = game.turnDeadline?.toMillis?.() ?? 0;
    if (deadline > 0 && Date.now() >= deadline) {
      // Pass the acting user's uid so forfeitExpiredTurn can skip the
      // self-notify the /notifications rule forbids (see that fn's doc).
      forfeitExpiredTurn(game.id, profile.uid).catch((err) => {
        logger.warn("forfeit_check_failed", {
          error: parseFirebaseError(err),
          gameId: game.id,
        });
        captureException(err, { extra: { context: "forfeitExpiredTurn", gameId: game.id } });
      });
    }
    forfeitCheckedRef.current = true;
  }, [game.id, game.status, game.phase, game.turnDeadline, profile.uid]);

  const isPlayer = game.player1Uid === profile.uid || game.player2Uid === profile.uid;
  const isJudge = !!game.judgeId && game.judgeId === profile.uid;
  const judgeActive = isJudgeActive(game);

  const isSetter = isPlayer && game.phase === "setting" && game.currentSetter === profile.uid;
  const isMatcher = isPlayer && game.phase === "matching" && game.currentTurn === profile.uid;
  const isDisputeReviewer = isJudge && game.phase === "disputable" && game.currentTurn === profile.uid;
  const isSetTrickReviewer = isJudge && game.phase === "setReview" && game.currentTurn === profile.uid;
  const isJudgeInvitePending = isJudge && game.judgeStatus === "pending" && game.status === "active";

  // Binding community dispute (honor-system games): a landed claim freezes the
  // game in pendingReview until the setter accepts or escalates, then in
  // communityReview until the crowd (or the referee, on expiry) resolves it.
  const isPendingReviewSetter = isPlayer && game.phase === "pendingReview" && game.currentSetter === profile.uid;
  const isPendingReviewMatcher = isPlayer && game.phase === "pendingReview" && game.reviewFor === profile.uid;
  const isCommunityReview = isPlayer && game.phase === "communityReview";
  const isInReview = isPendingReviewSetter || isPendingReviewMatcher || isCommunityReview;
  const canDispute = canRaiseDispute(game, profile.uid);
  const { dispute: communityDispute, state: communityDisputeState } = useCommunityDispute(
    isCommunityReview,
    game.id,
    game.turnNumber,
  );

  const {
    disputeSubmitting,
    lastDisputeAction,
    handleResolveDispute,
    setReviewSubmitting,
    lastSetReviewAction,
    handleRuleSetTrick,
    callBSSubmitting,
    handleCallBS,
    reviewActionSubmitting,
    lastReviewAction,
    handleAcceptLanded,
    handleRaiseDispute,
    judgeActionSubmitting,
    handleJudgeAccept,
    handleJudgeDecline,
  } = useGameReviewActions(game.id, setError);

  const opponentName = game.player1Uid === profile.uid ? game.player2Username : game.player1Username;
  const opponentUid = game.player1Uid === profile.uid ? game.player2Uid : game.player1Uid;
  const opponentIsPro = game.player1Uid === profile.uid ? game.player2IsVerifiedPro : game.player1IsVerifiedPro;
  const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
  const setterIsPro = game.player1Uid === game.currentSetter ? game.player1IsVerifiedPro : game.player2IsVerifiedPro;
  const matcherUsername = game.currentSetter === game.player1Uid ? game.player2Username : game.player1Username;

  const trimmedTrickName = trickName.trim();
  const revealRecorderNow = isSetter && trimmedTrickName !== "";
  if (revealRecorderNow && !recorderRevealed) setRecorderRevealed(true);
  const showRecorder = !isSetter || recorderRevealed || revealRecorderNow;

  const submittedRef = useRef(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  // Abort any in-flight upload on unmount — back-navigating mid-upload would
  // otherwise leak the transfer and risk setState-after-unmount in the upload
  // progress / error callbacks.
  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
    };
  }, []);
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
          uploadAbortRef.current = new AbortController();
          videoUrl = await uploadVideo(
            game.id,
            game.turnNumber,
            "set",
            blob,
            setUploadProgress,
            undefined,
            uploadAbortRef.current.signal,
          );
        }
        setUploadProgress(null);
        const selection = isTrickPickerEnabled() ? trickSelectionRef.current : null;
        if (selection) {
          await setTrick(game.id, trickNameRef.current.trim(), videoUrl, selection);
          if (selection.trickId !== "other") rememberRecentTrick(selection.trickId);
        } else {
          await setTrick(game.id, trickNameRef.current.trim(), videoUrl);
        }
      } catch (err: unknown) {
        // Unmount-triggered abort: the component is gone, so skip state +
        // Sentry to avoid setState-after-unmount noise.
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to send trick");
        captureException(err, { extra: { context: "submitSetterTrick", gameId: game.id } });
        setUploadProgress(null);
        submittedRef.current = false;
      } finally {
        uploadAbortRef.current = null;
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

  const handleRecorded = useCallback(
    (blob: Blob | null) => {
      if (!blob && isSetter) {
        // The recorder reports null when the take produced no usable bytes —
        // the zero-byte encoder output useMediaRecorder documents as the iOS
        // Safari failure mode. Marking the take RECORDED anyway revealed the
        // "✓ Landed" button over a null blob, and the setter's submit then
        // called setTrick with videoUrl === null, which firestore.rules
        // rejects outright: the setting→matching branch requires a
        // bucket-pinned currentTrickVideoUrl, so the transaction came back
        // permission-denied and the turn could not advance at all. Surface
        // the failed take where "try again" still means something. Mirrors
        // UserClipUpload#handleRecorded.
        //
        // Scoped to the setter deliberately: matchVideoUrl is explicitly
        // nullable in the rules (`matchVideoUrlOk`), so a matcher's empty
        // take still submits. Whether it SHOULD is a separate question.
        setError("That take didn't record. Try again.");
        return;
      }
      setVideoBlob(blob);
      setVideoRecorded(true);
    },
    [isSetter],
  );

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
          uploadAbortRef.current = new AbortController();
          videoUrl = await uploadVideo(
            game.id,
            game.turnNumber,
            "match",
            videoBlob,
            setUploadProgress,
            undefined,
            uploadAbortRef.current.signal,
          );
        }
        setUploadProgress(null);
        await submitMatchAttempt(game.id, videoUrl, landed);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to submit attempt");
        captureException(err, { extra: { context: "submitMatchAttempt", gameId: game.id } });
        setUploadProgress(null);
        matchSubmittedRef.current = false;
      } finally {
        uploadAbortRef.current = null;
        setSubmitting(false);
      }
    },
    [game.id, game.turnNumber, videoBlob],
  );

  const myLetters = game.player1Uid === profile.uid ? game.p1Letters : game.p2Letters;
  const theirLetters = game.player1Uid === profile.uid ? game.p2Letters : game.p1Letters;
  // In a frozen review phase the turnDeadline is pinned (often already past);
  // the live countdown is the review window, so surface that instead.
  const inReviewPhase = game.phase === "pendingReview" || game.phase === "communityReview";
  // Fallback for a game with no deadline stamped yet: 24h out, captured once
  // per mount (same approach as useWaitingScreen) so render stays pure.
  const [fallbackDeadline] = useState(() => Date.now() + 86400000);
  const deadline =
    (inReviewPhase ? game.reviewDeadline?.toMillis?.() : game.turnDeadline?.toMillis?.()) || fallbackDeadline;

  const dismissError = useCallback(() => setError(""), []);
  const openReport = useCallback(() => setShowReport(true), []);
  const closeReport = useCallback(() => setShowReport(false), []);
  const markReported = useCallback(() => {
    setShowReport(false);
    setReported(true);
  }, []);

  return {
    game,
    profile,
    trickName,
    setTrickName,
    trickPickerEnabled: isTrickPickerEnabled(),
    trickSelection,
    setTrickSelection,
    trimmedTrickName,
    showRecorder,
    videoBlob,
    videoRecorded,
    handleRecorded,
    submitting,
    error,
    dismissError,
    uploadProgress,
    setterAction,
    matcherLanded,
    isPlayer,
    isJudge,
    judgeActive,
    isSetter,
    isMatcher,
    isDisputeReviewer,
    isSetTrickReviewer,
    isJudgeInvitePending,
    isPendingReviewSetter,
    isPendingReviewMatcher,
    isCommunityReview,
    isInReview,
    communityDispute,
    communityDisputeState,
    canDispute,
    opponentName,
    opponentUid,
    opponentIsPro,
    setterUsername,
    setterIsPro,
    matcherUsername,
    myLetters,
    theirLetters,
    deadline,
    submitSetterTrick,
    submitSetterMissed,
    submitMatchWithCall,
    disputeSubmitting,
    lastDisputeAction,
    handleResolveDispute,
    setReviewSubmitting,
    lastSetReviewAction,
    handleRuleSetTrick,
    callBSSubmitting,
    handleCallBS,
    reviewSubmitting: reviewActionSubmitting,
    lastReviewAction,
    handleAcceptLanded,
    handleRaiseDispute,
    judgeActionSubmitting,
    handleJudgeAccept,
    handleJudgeDecline,
    showReport,
    openReport,
    closeReport,
    reported,
    markReported,
  };
}

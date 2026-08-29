import { useCallback, useEffect, useRef, useState } from "react";
import type { GameDoc } from "../../services/games";
import {
  acceptJudgeInvite,
  acceptLanded,
  callBSOnSetTrick,
  declineJudgeInvite,
  failSetTrick,
  forfeitExpiredTurn,
  isJudgeActive,
  judgeRuleSetTrick,
  resolveDispute,
  setTrick,
  submitMatchAttempt,
} from "../../services/games";
import { canRaiseDispute, raiseDispute, type Dispute } from "../../services/disputes";
import { uploadVideo, type UploadProgress as UploadProgressData } from "../../services/storage";
import type { UserProfile } from "../../services/users";
import { captureException } from "../../lib/sentry";
import { logger } from "../../services/logger";
import { playHaptic } from "../../services/haptics";
import { parseFirebaseError } from "../../utils/helpers";
import { useCommunityDispute, type CommunityDisputeState } from "./useCommunityDispute";

export interface GamePlayController {
  game: GameDoc;
  profile: UserProfile;

  trickName: string;
  setTrickName: (value: string) => void;
  trimmedTrickName: string;
  showRecorder: boolean;

  videoBlob: Blob | null;
  videoRecorded: boolean;
  handleRecorded: (blob: Blob | null) => void;

  submitting: boolean;
  error: string;
  dismissError: () => void;
  uploadProgress: UploadProgressData | null;

  setterAction: "landed" | "missed" | null;
  matcherLanded: boolean | null;

  isPlayer: boolean;
  isJudge: boolean;
  judgeActive: boolean;
  isSetter: boolean;
  isMatcher: boolean;
  isDisputeReviewer: boolean;
  isSetTrickReviewer: boolean;
  isJudgeInvitePending: boolean;
  /** Setter of a frozen landed claim — sees Accept / Dispute (pendingReview). */
  isPendingReviewSetter: boolean;
  /** Claimer waiting on the setter's accept/dispute decision (pendingReview). */
  isPendingReviewMatcher: boolean;
  /** Either player while the dispute is out to the community (communityReview). */
  isCommunityReview: boolean;
  /** True in any frozen review phase — routes off the plain waiting screen. */
  isInReview: boolean;
  communityDispute: Dispute | null;
  communityDisputeState: CommunityDisputeState;
  /** Gate for the Dispute affordance — false once the claim can't be disputed. */
  canDispute: boolean;

  opponentName: string;
  opponentUid: string;
  opponentIsPro: boolean | undefined;
  setterUsername: string;
  setterIsPro: boolean | undefined;
  matcherUsername: string;

  myLetters: number;
  theirLetters: number;
  deadline: number;

  submitSetterTrick: (blob: Blob | null) => Promise<void>;
  submitSetterMissed: () => Promise<void>;
  submitMatchWithCall: (landed: boolean) => Promise<void>;

  disputeSubmitting: boolean;
  lastDisputeAction: boolean | null;
  handleResolveDispute: (accept: boolean) => Promise<void>;

  setReviewSubmitting: boolean;
  lastSetReviewAction: boolean | null;
  handleRuleSetTrick: (clean: boolean) => Promise<void>;

  callBSSubmitting: boolean;
  handleCallBS: () => Promise<void>;

  reviewSubmitting: boolean;
  lastReviewAction: "accept" | "dispute" | null;
  handleAcceptLanded: () => Promise<void>;
  handleRaiseDispute: () => Promise<void>;

  judgeActionSubmitting: boolean;
  handleJudgeAccept: () => Promise<void>;
  handleJudgeDecline: () => Promise<void>;

  showReport: boolean;
  openReport: () => void;
  closeReport: () => void;
  reported: boolean;
  markReported: () => void;
}

export function useGamePlayController(game: GameDoc, profile: UserProfile): GamePlayController {
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
    // A frozen review phase pins the (possibly-expired) turnDeadline; firing a
    // forfeit here would be a wasted, rules-rejected write against a game the
    // dispute referee — not the turn sweep — is responsible for advancing.
    if (game.phase === "pendingReview" || game.phase === "communityReview") {
      setForfeitChecked(true);
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
    setForfeitChecked(true);
  }, [game.id, game.status, game.phase, forfeitChecked, game.turnDeadline, profile.uid]);

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

  // Accept / Dispute on a frozen landed claim (pendingReview). One ref guards
  // BOTH actions: once the setter commits to accepting or disputing, neither
  // button can fire again until a failure re-arms it (mirrors the dispute /
  // judge-action retry semantics elsewhere in this controller).
  const [reviewActionSubmitting, setReviewActionSubmitting] = useState(false);
  const [lastReviewAction, setLastReviewAction] = useState<"accept" | "dispute" | null>(null);
  const reviewSubmittedRef = useRef(false);
  const handleAcceptLanded = useCallback(async () => {
    if (reviewSubmittedRef.current) return;
    reviewSubmittedRef.current = true;
    setLastReviewAction("accept");
    setReviewActionSubmitting(true);
    setError("");
    try {
      await acceptLanded(game.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept the landed claim");
      captureException(err, { extra: { context: "acceptLanded", gameId: game.id } });
      reviewSubmittedRef.current = false;
    } finally {
      setReviewActionSubmitting(false);
    }
  }, [game.id]);
  const handleRaiseDispute = useCallback(async () => {
    if (reviewSubmittedRef.current) return;
    reviewSubmittedRef.current = true;
    setLastReviewAction("dispute");
    setReviewActionSubmitting(true);
    setError("");
    try {
      await raiseDispute(game.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send the call to the community");
      captureException(err, { extra: { context: "raiseDispute", gameId: game.id } });
      reviewSubmittedRef.current = false;
    } finally {
      setReviewActionSubmitting(false);
    }
  }, [game.id]);

  const [judgeActionSubmitting, setJudgeActionSubmitting] = useState(false);
  const judgeActionSubmittedRef = useRef(false);
  const handleJudgeAccept = useCallback(async () => {
    if (judgeActionSubmittedRef.current) return;
    judgeActionSubmittedRef.current = true;
    setJudgeActionSubmitting(true);
    setError("");
    try {
      await acceptJudgeInvite(game.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept referee invite");
      captureException(err, { extra: { context: "acceptJudgeInvite", gameId: game.id } });
      judgeActionSubmittedRef.current = false;
    } finally {
      setJudgeActionSubmitting(false);
    }
  }, [game.id]);
  const handleJudgeDecline = useCallback(async () => {
    if (judgeActionSubmittedRef.current) return;
    judgeActionSubmittedRef.current = true;
    setJudgeActionSubmitting(true);
    setError("");
    try {
      await declineJudgeInvite(game.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to decline referee invite");
      captureException(err, { extra: { context: "declineJudgeInvite", gameId: game.id } });
      judgeActionSubmittedRef.current = false;
    } finally {
      setJudgeActionSubmitting(false);
    }
  }, [game.id]);

  const opponentName = game.player1Uid === profile.uid ? game.player2Username : game.player1Username;
  const opponentUid = game.player1Uid === profile.uid ? game.player2Uid : game.player1Uid;
  const opponentIsPro = game.player1Uid === profile.uid ? game.player2IsVerifiedPro : game.player1IsVerifiedPro;
  const setterUsername = game.player1Uid === game.currentSetter ? game.player1Username : game.player2Username;
  const setterIsPro = game.player1Uid === game.currentSetter ? game.player1IsVerifiedPro : game.player2IsVerifiedPro;
  const matcherUsername = game.currentSetter === game.player1Uid ? game.player2Username : game.player1Username;

  const trimmedTrickName = trickName.trim();
  if (isSetter && trimmedTrickName) recorderRevealedRef.current = true;
  const showRecorder = !isSetter || recorderRevealedRef.current;

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
        await setTrick(game.id, trickNameRef.current.trim(), videoUrl);
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
  const deadline =
    (inReviewPhase ? game.reviewDeadline?.toMillis?.() : game.turnDeadline?.toMillis?.()) || Date.now() + 86400000;

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

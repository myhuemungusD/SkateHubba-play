import { useCallback, useRef, useState } from "react";
import {
  acceptJudgeInvite,
  acceptLanded,
  callBSOnSetTrick,
  declineJudgeInvite,
  judgeRuleSetTrick,
  resolveDispute,
} from "../../services/games";
import { raiseDispute } from "../../services/disputes";
import { captureException } from "../../lib/sentry";

/**
 * Referee and review-phase actions for a game turn: judge dispute rulings,
 * set-trick rulings, Call BS, accept/dispute on a frozen landed claim, and the
 * referee invite. Each action has its own double-submit ref that a failure
 * re-arms. Errors are written through the controller's shared `setError`.
 */
export function useGameReviewActions(gameId: string, setError: (msg: string) => void) {
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
        await resolveDispute(gameId, accept);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to resolve dispute");
        captureException(err, { extra: { context: "resolveDispute", gameId: gameId, accept } });
        disputeSubmittedRef.current = false;
      } finally {
        setDisputeSubmitting(false);
      }
    },
    [gameId, setError],
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
        await judgeRuleSetTrick(gameId, clean);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to rule");
        captureException(err, { extra: { context: "judgeRuleSetTrick", gameId: gameId, clean } });
        setReviewSubmittedRef.current = false;
      } finally {
        setSetReviewSubmitting(false);
      }
    },
    [gameId, setError],
  );

  const [callBSSubmitting, setCallBSSubmitting] = useState(false);
  const callBSSubmittedRef = useRef(false);
  const handleCallBS = useCallback(async () => {
    if (callBSSubmittedRef.current) return;
    callBSSubmittedRef.current = true;
    setCallBSSubmitting(true);
    setError("");
    try {
      await callBSOnSetTrick(gameId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to call BS");
      captureException(err, { extra: { context: "callBSOnSetTrick", gameId: gameId } });
      callBSSubmittedRef.current = false;
    } finally {
      setCallBSSubmitting(false);
    }
  }, [gameId, setError]);

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
      await acceptLanded(gameId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept the landed claim");
      captureException(err, { extra: { context: "acceptLanded", gameId: gameId } });
      reviewSubmittedRef.current = false;
    } finally {
      setReviewActionSubmitting(false);
    }
  }, [gameId, setError]);
  const handleRaiseDispute = useCallback(async () => {
    if (reviewSubmittedRef.current) return;
    reviewSubmittedRef.current = true;
    setLastReviewAction("dispute");
    setReviewActionSubmitting(true);
    setError("");
    try {
      await raiseDispute(gameId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send the call to the community");
      captureException(err, { extra: { context: "raiseDispute", gameId: gameId } });
      reviewSubmittedRef.current = false;
    } finally {
      setReviewActionSubmitting(false);
    }
  }, [gameId, setError]);

  const [judgeActionSubmitting, setJudgeActionSubmitting] = useState(false);
  const judgeActionSubmittedRef = useRef(false);
  const handleJudgeAccept = useCallback(async () => {
    if (judgeActionSubmittedRef.current) return;
    judgeActionSubmittedRef.current = true;
    setJudgeActionSubmitting(true);
    setError("");
    try {
      await acceptJudgeInvite(gameId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to accept referee invite");
      captureException(err, { extra: { context: "acceptJudgeInvite", gameId: gameId } });
      judgeActionSubmittedRef.current = false;
    } finally {
      setJudgeActionSubmitting(false);
    }
  }, [gameId, setError]);
  const handleJudgeDecline = useCallback(async () => {
    if (judgeActionSubmittedRef.current) return;
    judgeActionSubmittedRef.current = true;
    setJudgeActionSubmitting(true);
    setError("");
    try {
      await declineJudgeInvite(gameId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to decline referee invite");
      captureException(err, { extra: { context: "declineJudgeInvite", gameId: gameId } });
      judgeActionSubmittedRef.current = false;
    } finally {
      setJudgeActionSubmitting(false);
    }
  }, [gameId, setError]);

  return {
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
  };
}

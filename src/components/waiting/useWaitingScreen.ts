import { useCallback, useEffect, useState } from "react";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { canNudge, sendNudge } from "../../services/nudge";

export type NudgeStatus = "idle" | "pending" | "sent" | "error";

export interface WaitingScreenState {
  // Derived role / phase booleans
  isJudge: boolean;
  isJudgeTurn: boolean;
  // Derived player-centric values
  myLetters: number;
  theirLetters: number;
  opponentName: string;
  opponentUid: string;
  opponentIsPro: boolean | undefined;
  activePlayerUsername: string;
  waitingOnLabel: string;
  deadline: number;
  // Nudge
  nudgeStatus: NudgeStatus;
  nudgeError: string;
  nudgeAvailable: boolean;
  handleNudge: () => Promise<void>;
  // Report modal
  showReport: boolean;
  reported: boolean;
  openReport: () => void;
  closeReport: () => void;
  markReported: () => void;
}

export function useWaitingScreen(game: GameDoc, profile: UserProfile): WaitingScreenState {
  const [nudgeStatus, setNudgeStatus] = useState<NudgeStatus>(() =>
    canNudge(game.id, profile.uid) ? "idle" : "sent",
  );
  const [nudgeError, setNudgeError] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [reported, setReported] = useState(false);

  // Re-check nudge cooldown periodically so the button re-enables after cooldown
  useEffect(() => {
    const id = window.setInterval(() => {
      if (canNudge(game.id, profile.uid)) {
        setNudgeStatus((prev) => (prev === "sent" ? "idle" : prev));
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [game.id, profile.uid]);

  const myLetters = game.player1Uid === profile.uid ? game.p1Letters : game.p2Letters;
  const theirLetters = game.player1Uid === profile.uid ? game.p2Letters : game.p1Letters;
  const opponentName = game.player1Uid === profile.uid ? game.player2Username : game.player1Username;
  const opponentUid = game.player1Uid === profile.uid ? game.player2Uid : game.player1Uid;
  const opponentIsPro = game.player1Uid === profile.uid ? game.player2IsVerifiedPro : game.player1IsVerifiedPro;
  // A judge observing (not acting) lands here between review phases. The
  // player-centric `myLetters` / `opponentName` derivations above fall back
  // to player2 / player1 for a non-player viewer, which would otherwise
  // display the wrong scores and mislabel the Nudge / Report actions. We
  // branch on this flag to render a neutral p1-vs-p2 header and suppress
  // player-only controls.
  const isJudge = !!game.judgeId && game.judgeId === profile.uid;
  // When the viewer is the judge, the "active player" is whoever currentTurn
  // points at (setter in setting phase, matcher in matching phase). Judge
  // review phases would route to GamePlayScreen's review UI, not here.
  const activePlayerUsername = game.player1Uid === game.currentTurn ? game.player1Username : game.player2Username;
  const [fallbackDeadline] = useState(() => Date.now() + 86400000);
  const deadline = game.turnDeadline?.toMillis?.() || fallbackDeadline;
  const nudgeAvailable = nudgeStatus === "idle";
  // Judge-driven phases surface a different "who are we waiting on" copy.
  const isJudgeTurn = game.phase === "disputable" || game.phase === "setReview";
  const waitingOnLabel = isJudge
    ? `@${activePlayerUsername}`
    : isJudgeTurn && game.judgeUsername
      ? `@${game.judgeUsername}`
      : `@${opponentName}`;

  const handleNudge = useCallback(async () => {
    setNudgeStatus("pending");
    setNudgeError("");
    try {
      await sendNudge({
        gameId: game.id,
        senderUid: profile.uid,
        senderUsername: profile.username,
        recipientUid: opponentUid,
      });
      setNudgeStatus("sent");
    } catch (err: unknown) {
      setNudgeError(err instanceof Error ? err.message : "Failed to nudge");
      setNudgeStatus("error");
    }
  }, [game.id, profile.uid, profile.username, opponentUid]);

  const openReport = useCallback(() => setShowReport(true), []);
  const closeReport = useCallback(() => setShowReport(false), []);
  const markReported = useCallback(() => {
    setShowReport(false);
    setReported(true);
  }, []);

  return {
    isJudge,
    isJudgeTurn,
    myLetters,
    theirLetters,
    opponentName,
    opponentUid,
    opponentIsPro,
    activePlayerUsername,
    waitingOnLabel,
    deadline,
    nudgeStatus,
    nudgeError,
    nudgeAvailable,
    handleNudge,
    showReport,
    reported,
    openReport,
    closeReport,
    markReported,
  };
}

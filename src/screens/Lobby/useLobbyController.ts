import { useCallback, useState, type FocusEvent, type KeyboardEvent } from "react";
import type { GameDoc } from "../../services/games";
import type { UserProfile } from "../../services/users";
import { usePlayerDirectory } from "../../hooks/usePlayerDirectory";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";

function isGameExpired(g: GameDoc): boolean {
  const deadline = g.turnDeadline?.toMillis?.() ?? 0;
  return deadline > 0 && deadline <= Date.now();
}

export interface CardButtonProps {
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onKeyUp: (e: KeyboardEvent<HTMLElement>) => void;
  onBlur: (e: FocusEvent<HTMLElement>) => void;
}

interface Args {
  profile: UserProfile;
  games: GameDoc[];
  onDownloadData?: () => Promise<void>;
}

export interface LobbyController {
  players: ReturnType<typeof usePlayerDirectory>["players"];
  playersLoading: boolean;
  ptr: ReturnType<typeof usePullToRefresh>;

  active: GameDoc[];
  done: GameDoc[];
  liveActive: GameDoc[];

  isJudge: (g: GameDoc) => boolean;
  isPlayer: (g: GameDoc) => boolean;
  opponent: (g: GameDoc) => string;
  opponentUid: (g: GameDoc) => string;
  opponentIsVerifiedPro: (g: GameDoc) => boolean | undefined;
  isMyTurn: (g: GameDoc) => boolean;
  myLetters: (g: GameDoc) => number;
  theirLetters: (g: GameDoc) => number;
  turnLabel: (g: GameDoc) => string;

  cardButtonProps: (handler: () => void) => CardButtonProps;

  showDeleteModal: boolean;
  openDeleteModal: () => void;
  closeDeleteModal: () => void;

  downloadingData: boolean;
  downloadError: string;
  handleDownload: () => Promise<void>;
}

export function useLobbyController({ profile, games, onDownloadData }: Args): LobbyController {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [downloadingData, setDownloadingData] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const { players, loading: playersLoading, refresh: refreshPlayers } = usePlayerDirectory(profile.uid);
  const ptr = usePullToRefresh(refreshPlayers);

  const active = games.filter((g) => g.status === "active");
  const done = games.filter((g) => g.status !== "active");
  const liveActive = active.filter((g) => !isGameExpired(g));

  const isJudge = useCallback((g: GameDoc) => !!g.judgeId && g.judgeId === profile.uid, [profile.uid]);
  const isPlayer = useCallback(
    (g: GameDoc) => g.player1Uid === profile.uid || g.player2Uid === profile.uid,
    [profile.uid],
  );
  const opponent = useCallback(
    (g: GameDoc) => (g.player1Uid === profile.uid ? g.player2Username : g.player1Username),
    [profile.uid],
  );
  const opponentUid = useCallback(
    (g: GameDoc) => (g.player1Uid === profile.uid ? g.player2Uid : g.player1Uid),
    [profile.uid],
  );
  const opponentIsVerifiedPro = useCallback(
    (g: GameDoc) => (g.player1Uid === profile.uid ? g.player2IsVerifiedPro : g.player1IsVerifiedPro),
    [profile.uid],
  );
  const isMyTurn = useCallback((g: GameDoc) => g.currentTurn === profile.uid, [profile.uid]);
  const myLetters = useCallback(
    (g: GameDoc) => (g.player1Uid === profile.uid ? g.p1Letters : g.p2Letters),
    [profile.uid],
  );
  const theirLetters = useCallback(
    (g: GameDoc) => (g.player1Uid === profile.uid ? g.p2Letters : g.p1Letters),
    [profile.uid],
  );

  const turnLabel = useCallback(
    (g: GameDoc) => {
      const trick = g.currentTrickName || "Trick";
      if (isJudge(g) && !isPlayer(g)) {
        if (isMyTurn(g)) {
          if (g.phase === "disputable") return "Rule: landed or missed?";
          if (g.phase === "setReview") return "Rule: clean or sketchy?";
        }
        if (g.phase === "disputable" || g.phase === "setReview") return "Awaiting your ruling";
        if (g.phase === "matching") return `Matching: ${trick}`;
        return "Setting a trick";
      }
      if (g.phase === "disputable" || g.phase === "setReview") {
        return g.judgeUsername ? `Referee @${g.judgeUsername} reviewing` : "Under review";
      }
      if (isMyTurn(g)) {
        if (g.phase === "matching") return `Match: ${trick}`;
        return "Your turn to set";
      }
      if (g.phase === "matching") return `Matching: ${trick}`;
      return "They're setting a trick";
    },
    [isJudge, isPlayer, isMyTurn],
  );

  const cardButtonProps = useCallback(
    (handler: () => void) => ({
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (e.repeat) return;
        if (e.key === "Enter") {
          e.preventDefault();
          handler();
        } else if (e.key === " ") {
          e.preventDefault();
          e.currentTarget.dataset.spacePrimed = "true";
        }
      },
      onKeyUp: (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === " " && e.currentTarget.dataset.spacePrimed === "true") {
          delete e.currentTarget.dataset.spacePrimed;
          e.preventDefault();
          handler();
        }
      },
      onBlur: (e: FocusEvent<HTMLElement>) => {
        delete e.currentTarget.dataset.spacePrimed;
      },
    }),
    [],
  );

  const openDeleteModal = useCallback(() => setShowDeleteModal(true), []);
  const closeDeleteModal = useCallback(() => setShowDeleteModal(false), []);

  const handleDownload = useCallback(async () => {
    if (!onDownloadData || downloadingData) return;
    setDownloadError("");
    setDownloadingData(true);
    try {
      await onDownloadData();
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Export failed — try again");
    } finally {
      setDownloadingData(false);
    }
  }, [onDownloadData, downloadingData]);

  return {
    players,
    playersLoading,
    ptr,
    active,
    done,
    liveActive,
    isJudge,
    isPlayer,
    opponent,
    opponentUid,
    opponentIsVerifiedPro,
    isMyTurn,
    myLetters,
    theirLetters,
    turnLabel,
    cardButtonProps,
    showDeleteModal,
    openDeleteModal,
    closeDeleteModal,
    downloadingData,
    downloadError,
    handleDownload,
  };
}

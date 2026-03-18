import { useEffect, useRef } from "react";
import { collection, query, where, onSnapshot, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";
import { useGameContext } from "../context/GameContext";
import { useNotifications } from "../context/NotificationContext";
import type { GameDoc } from "../services/games";

/**
 * Watches game state changes and triggers notifications.
 * Must be rendered inside both GameProvider and NotificationProvider.
 */
export function GameNotificationWatcher() {
  const { user, games, activeGame } = useGameContext();
  const { notify } = useNotifications();

  const uid = user?.uid ?? null;

  // ── Track games list to detect new challenges ──
  const prevGameIdsRef = useRef<Set<string> | null>(null);
  const gamesReadyRef = useRef(false);

  useEffect(() => {
    if (!uid || games.length === 0) {
      // Reset when user logs out
      if (!uid) {
        prevGameIdsRef.current = null;
        gamesReadyRef.current = false;
      }
      return;
    }

    const currentIds = new Set(games.map((g) => g.id));

    if (prevGameIdsRef.current === null) {
      // First load — seed the set, don't notify
      prevGameIdsRef.current = currentIds;
      // Wait one tick then mark ready (prevents notifications on initial load)
      setTimeout(() => {
        gamesReadyRef.current = true;
      }, 0);
      return;
    }

    if (!gamesReadyRef.current) {
      prevGameIdsRef.current = currentIds;
      return;
    }

    // Detect new games
    for (const g of games) {
      if (!prevGameIdsRef.current.has(g.id) && g.status === "active") {
        // Only notify if we're the one being challenged (player2)
        if (g.player2Uid === uid) {
          notify({
            type: "game_event",
            title: "New Challenge!",
            message: `@${g.player1Username} challenged you to S.K.A.T.E.`,
            chime: "new_challenge",
            gameId: g.id,
          });
        }
      }
    }

    prevGameIdsRef.current = currentIds;
  }, [uid, games, notify]);

  // ── Track active game for turn/phase/completion changes ──
  const prevGameRef = useRef<GameDoc | null>(null);
  const gameReadyRef = useRef(false);

  useEffect(() => {
    if (!uid || !activeGame) {
      if (!activeGame) {
        prevGameRef.current = null;
        gameReadyRef.current = false;
      }
      return;
    }

    const prev = prevGameRef.current;

    if (!prev || prev.id !== activeGame.id) {
      // First time seeing this game — seed, don't notify
      prevGameRef.current = activeGame;
      setTimeout(() => {
        gameReadyRef.current = true;
      }, 0);
      return;
    }

    if (!gameReadyRef.current) {
      prevGameRef.current = activeGame;
      return;
    }

    const opponentName = activeGame.player1Uid === uid ? activeGame.player2Username : activeGame.player1Username;

    // Game completed
    if (activeGame.status !== "active" && prev.status === "active") {
      const won = activeGame.winner === uid;
      const isForfeit = activeGame.status === "forfeit";
      notify({
        type: won ? "success" : "game_event",
        title: won ? (isForfeit ? "Opponent Forfeited!" : "You Won!") : isForfeit ? "Time Expired" : "Game Over",
        message: `vs @${opponentName}`,
        chime: won ? "game_won" : "game_lost",
        gameId: activeGame.id,
      });
      prevGameRef.current = activeGame;
      return;
    }

    // Turn changed to me
    if (activeGame.currentTurn === uid && prev.currentTurn !== uid) {
      if (activeGame.phase === "matching") {
        notify({
          type: "game_event",
          title: "Your Turn!",
          message: `Match @${opponentName}'s ${activeGame.currentTrickName || "trick"}`,
          chime: "your_turn",
          gameId: activeGame.id,
        });
      } else if (activeGame.phase === "setting") {
        notify({
          type: "game_event",
          title: "Your Turn to Set!",
          message: `Set a trick for @${opponentName}`,
          chime: "your_turn",
          gameId: activeGame.id,
        });
      }
    }

    // Phase changed to confirming (match attempt submitted)
    if (activeGame.phase === "confirming" && prev.phase === "matching") {
      notify({
        type: "info",
        title: "Review Time",
        message: "Both players vote on the attempt",
        chime: "general",
        gameId: activeGame.id,
      });
    }

    // Opponent voted in confirming phase
    if (activeGame.phase === "confirming" && prev.phase === "confirming") {
      const isSetter = activeGame.currentSetter === uid;
      const theirVoteBefore = isSetter ? prev.matcherConfirm : prev.setterConfirm;
      const theirVoteAfter = isSetter ? activeGame.matcherConfirm : activeGame.setterConfirm;
      if (theirVoteBefore === null && theirVoteAfter !== null) {
        notify({
          type: "info",
          title: "Vote Received",
          message: `@${opponentName} has voted`,
          chime: "general",
          gameId: activeGame.id,
        });
      }
    }

    prevGameRef.current = activeGame;
  }, [uid, activeGame, notify]);

  // Also watch games list for turn changes on games we're not actively viewing
  const prevGamesMapRef = useRef<Map<string, GameDoc>>(new Map());

  useEffect(() => {
    if (!uid || games.length === 0 || !gamesReadyRef.current) {
      if (!uid) prevGamesMapRef.current.clear();
      return;
    }

    const prevMap = prevGamesMapRef.current;

    for (const g of games) {
      const prev = prevMap.get(g.id);
      if (!prev) continue;

      // Skip the active game — handled by the single-game watcher above
      if (activeGame && g.id === activeGame.id) continue;

      const opponentName = g.player1Uid === uid ? g.player2Username : g.player1Username;

      // Turn changed to me (not actively viewing)
      if (g.currentTurn === uid && prev.currentTurn !== uid && g.status === "active") {
        notify({
          type: "game_event",
          title: "Your Turn!",
          message: `vs @${opponentName} — ${g.currentTrickName || "set a trick"}`,
          chime: "your_turn",
          gameId: g.id,
        });
      }

      // Game ended (not actively viewing)
      if (g.status !== "active" && prev.status === "active") {
        const won = g.winner === uid;
        notify({
          type: won ? "success" : "game_event",
          title: won ? "You Won!" : "Game Over",
          message: `vs @${opponentName}`,
          chime: won ? "game_won" : "game_lost",
          gameId: g.id,
        });
      }
    }

    prevGamesMapRef.current = new Map(games.map((g) => [g.id, g]));
  }, [uid, games, activeGame, notify]);

  // ── Listen for incoming nudges ──
  const nudgeReadyRef = useRef(false);
  const initialNudgeIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!uid || !db) {
      nudgeReadyRef.current = false;
      initialNudgeIdsRef.current = null;
      return;
    }

    let unsub: (() => void) | undefined;
    try {
      const q = query(
        collection(db, "nudges"),
        where("recipientUid", "==", uid),
        orderBy("createdAt", "desc"),
        limit(5),
      );

      unsub = onSnapshot(q, (snap) => {
        // Seed on first snapshot to avoid notifying for old nudges
        if (initialNudgeIdsRef.current === null) {
          initialNudgeIdsRef.current = new Set(snap.docs.map((d) => d.id));
          setTimeout(() => {
            nudgeReadyRef.current = true;
          }, 0);
          return;
        }

        if (!nudgeReadyRef.current) return;

        for (const change of snap.docChanges()) {
          if (change.type === "added" && !initialNudgeIdsRef.current.has(change.doc.id)) {
            const data = change.doc.data();
            notify({
              type: "game_event",
              title: "You got nudged!",
              message: `@${data.senderUsername} is waiting for your move`,
              chime: "general",
              gameId: data.gameId,
            });
            initialNudgeIdsRef.current.add(change.doc.id);
            // Cap tracked IDs to prevent unbounded growth in long sessions
            if (initialNudgeIdsRef.current.size > 50) {
              const ids = Array.from(initialNudgeIdsRef.current);
              initialNudgeIdsRef.current = new Set(ids.slice(-25));
            }
          }
        }
      });
    } catch {
      // Firestore not initialized (e.g. in tests) — skip nudge listener
    }

    return () => unsub?.();
  }, [uid, notify]);

  return null;
}

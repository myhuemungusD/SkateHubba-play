import { useEffect, useRef } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  limit,
  updateDoc,
  doc as firestoreDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuthContext } from "../context/AuthContext";
import { useGameContext } from "../context/GameContext";
import { useNotifications } from "../context/NotificationContext";
import { onForegroundMessage } from "../services/fcm";
import type { GameDoc } from "../services/games";
import type { ChimeType } from "../services/sounds";

/**
 * Maps FCM data.type values to chime types for foreground push messages.
 */
const fcmChimeMap: Record<string, ChimeType> = {
  nudge: "nudge",
  your_turn: "your_turn",
  new_challenge: "new_challenge",
  game_won: "game_won",
  game_lost: "game_lost",
};

/**
 * Types that the Firestore real-time watchers already handle in-app.
 * When the app is in the foreground, the FCM push for these types would
 * duplicate the Firestore-driven toast. We suppress them here.
 */
const FIRESTORE_HANDLED_TYPES = new Set(["your_turn", "new_challenge", "game_won", "game_lost"]);

/**
 * Watches game state changes and triggers notifications.
 * Must be rendered inside both GameProvider and NotificationProvider.
 */
export function GameNotificationWatcher() {
  const { user } = useAuthContext();
  const { games, activeGame } = useGameContext();
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
              chime: "nudge",
              gameId: data.gameId,
            });
            initialNudgeIdsRef.current.add(change.doc.id);
            // Cap tracked IDs to prevent unbounded growth in long sessions
            if (initialNudgeIdsRef.current.size > 50) {
              const ids: string[] = Array.from(initialNudgeIdsRef.current);
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

  // ── Watch notifications collection for cross-client alerts ──
  // When the opponent writes a notification doc, this listener picks it up
  // and surfaces it as an in-app toast. Each doc is marked read after being
  // shown so it only fires once.
  const notifReadyRef = useRef(false);
  const initialNotifIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!uid || !db) {
      notifReadyRef.current = false;
      initialNotifIdsRef.current = null;
      return;
    }

    let unsub: (() => void) | undefined;
    try {
      const q = query(
        collection(db, "notifications"),
        where("recipientUid", "==", uid),
        where("read", "==", false),
        orderBy("createdAt", "desc"),
        limit(10),
      );

      unsub = onSnapshot(q, (snap) => {
        // Seed on first snapshot to avoid toasting stale notifications
        if (initialNotifIdsRef.current === null) {
          initialNotifIdsRef.current = new Set(snap.docs.map((d) => d.id));
          setTimeout(() => {
            notifReadyRef.current = true;
          }, 0);
          return;
        }

        if (!notifReadyRef.current) return;

        for (const change of snap.docChanges()) {
          if (change.type === "added" && !initialNotifIdsRef.current.has(change.doc.id)) {
            const data = change.doc.data();
            const chime = fcmChimeMap[data.type] ?? "general";
            notify({
              type: "game_event",
              title: data.title ?? "SkateHubba",
              message: data.body ?? "",
              chime,
              gameId: data.gameId,
            });
            initialNotifIdsRef.current.add(change.doc.id);

            // Mark as read so it doesn't re-fire (best-effort)
            if (db) {
              updateDoc(firestoreDoc(db, "notifications", change.doc.id), { read: true }).catch(() => {});
            }
          }
        }

        // Cap tracked IDs
        if (initialNotifIdsRef.current.size > 50) {
          const ids = Array.from(initialNotifIdsRef.current);
          initialNotifIdsRef.current = new Set(ids.slice(-25));
        }
      });
    } catch {
      // Firestore not initialized — skip
    }

    return () => unsub?.();
  }, [uid, notify]);

  // ── Handle deep-link from service worker notification tap ──
  useEffect(() => {
    if (!uid) return;

    const handler = (event: MessageEvent) => {
      if (event.data?.type === "OPEN_GAME" && event.data.gameId) {
        // Dispatch to App.tsx which holds the openGame navigation logic.
        window.dispatchEvent(new CustomEvent("skatehubba:open-game", { detail: { gameId: event.data.gameId } }));
      }
    };

    navigator.serviceWorker?.addEventListener("message", handler);
    return () => navigator.serviceWorker?.removeEventListener("message", handler);
  }, [uid]);

  // ── Bridge foreground FCM messages into in-app notifications ──
  // When the app is in the foreground, Firestore real-time watchers already
  // handle game events (turn changes, challenges, completions) and nudges.
  // The Cloud Functions also send FCM push for the same events (needed for
  // background/closed-tab delivery). To avoid double-toasting, we suppress
  // FCM types that Firestore watchers cover. Only unknown/future types pass
  // through as a fallback so no notification is ever silently lost.
  useEffect(() => {
    if (!uid) return;

    const unsub = onForegroundMessage((payload) => {
      const { notification, data } = payload;
      if (!notification) return;

      const fcmType = data?.type ?? "";

      // Nudges are already caught by the /nudges onSnapshot listener
      if (fcmType === "nudge") return;

      // Game events are already caught by the games onSnapshot watchers
      if (FIRESTORE_HANDLED_TYPES.has(fcmType)) return;

      // Unknown or future FCM types — show as fallback
      const chime = fcmChimeMap[fcmType] ?? "general";

      notify({
        type: "game_event",
        title: notification.title ?? "SkateHubba",
        message: notification.body ?? "",
        chime,
        gameId: data?.gameId,
      });
    });

    return unsub;
  }, [uid, notify]);

  return null;
}

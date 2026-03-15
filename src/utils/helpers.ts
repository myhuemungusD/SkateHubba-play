import { Timestamp } from "firebase/firestore";
import type { GameDoc } from "../services/games";

export const BG = "#0A0A0A";

/** Extract a Firebase error code from an unknown error value. */
export function getErrorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "string" ? code : "";
  }
  return "";
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const LETTERS = ["S", "K", "A", "T", "E"];

/** Guard against open-redirect or XSS via crafted video URLs stored in Firestore. */
export function isFirebaseStorageUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "https:" &&
      (hostname === "firebasestorage.googleapis.com" || hostname.endsWith(".firebasestorage.app"))
    );
  } catch {
    return false;
  }
}

/** Returns 1 (weak) | 2 (fair) | 3 (strong) — used for signup password indicator. */
export function pwStrength(pw: string): 1 | 2 | 3 {
  if (pw.length < 8) return 1;
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /[0-9]/.test(pw);
  const hasSymbol = /[^a-zA-Z0-9]/.test(pw);
  if (pw.length >= 12 && (hasUpper || hasDigit) && hasSymbol) return 3;
  if (pw.length >= 8 && (hasUpper || hasDigit || hasSymbol)) return 2;
  return 1;
}

/** Build a placeholder GameDoc for optimistic UI before the real-time listener syncs. */
export function newGameShell(
  gameId: string,
  myUid: string,
  myUsername: string,
  opponentUid: string,
  opponentUsername: string,
): GameDoc {
  return {
    id: gameId,
    player1Uid: myUid,
    player2Uid: opponentUid,
    player1Username: myUsername,
    player2Username: opponentUsername,
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: myUid,
    phase: "setting",
    currentSetter: myUid,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: Timestamp.fromMillis(Date.now() + 86400000),
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
  };
}

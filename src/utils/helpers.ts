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
/**
 * Extract a human-readable message from a Firebase Auth error (or any unknown error).
 * Firebase errors may be plain objects with `code` + `message` fields rather than
 * Error instances, which causes `String(err)` to produce `[object Object]`.
 */
export function parseFirebaseError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.code === "string" && obj.code) return obj.code;
    return JSON.stringify(err);
  }
  return String(err);
}

/**
 * Return a user-facing message from an unknown thrown value, falling back to
 * the provided `fallback` string when the value carries no human-readable text.
 *
 * Rules:
 *  - Error instances → err.message
 *  - Plain objects with a non-empty string `message` field → that message
 *  - Everything else (raw codes, primitives, null) → fallback
 */
export function getUserMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return fallback;
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

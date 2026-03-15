/**
 * Lightweight analytics wrapper.
 * Centralizes event tracking so swapping providers is a one-file change.
 */

type EventProperties = Record<string, string | number | boolean>;

/** Vercel Analytics injects `window.va` at runtime. */
interface WindowWithVa {
  va?: (command: string, payload: Record<string, unknown>) => void;
}

export function trackEvent(name: string, properties?: EventProperties): void {
  // Vercel Analytics custom events (window.va is injected by @vercel/analytics)
  try {
    const w = window as unknown as WindowWithVa;
    if (typeof w.va === "function") {
      w.va("event", { name, ...properties });
    }
  } catch {
    // Analytics should never break the app
  }
}

// Pre-defined event helpers for type safety
export const analytics = {
  gameCreated: (gameId: string) => trackEvent("game_created", { gameId }),
  trickSet: (gameId: string, trickName: string) => trackEvent("trick_set", { gameId, trickName }),
  matchSubmitted: (gameId: string, landed: boolean) => trackEvent("match_submitted", { gameId, landed }),
  gameCompleted: (gameId: string, won: boolean) => trackEvent("game_completed", { gameId, won }),
  videoUploaded: (durationMs: number, sizeBytes: number) => trackEvent("video_uploaded", { durationMs, sizeBytes }),
  signUp: (method: string) => trackEvent("sign_up", { method }),
  signIn: (method: string) => trackEvent("sign_in", { method }),
} as const;

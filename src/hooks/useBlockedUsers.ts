import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { subscribeToBlockedUsers } from "../services/blocking";

const EMPTY_SET: Set<string> = new Set();

interface BlockedUsersState {
  /** UIDs the viewer has blocked. Empty until the first snapshot lands. */
  blocked: Set<string>;
  /**
   * True once the block list is known: the first snapshot arrived, the
   * listener failed (fail open; the error is logged), or there's no viewer.
   * Surfaces that must never show a blocked player's content, even for a
   * frame, wait for this before rendering.
   */
  ready: boolean;
  /**
   * True when the listener failed before the first snapshot, so the list is
   * unknown (and `blocked` is empty). `ready` is still true then: surfaces
   * that accept failing open (SpotChat) keep working. Surfaces that must
   * not show a blocked player at all (the feed and the dispute lane) treat
   * this as an error and offer `retry`.
   */
  failed: boolean;
}

export interface BlockedUsersStateWithRetry extends BlockedUsersState {
  /** Drop the current listener and subscribe again (Try again after `failed`). */
  retry: () => void;
}

const SIGNED_OUT: BlockedUsersState = { blocked: EMPTY_SET, ready: true, failed: false };
const PENDING: BlockedUsersState = { blocked: EMPTY_SET, ready: false, failed: false };
const FAILED: BlockedUsersState = { blocked: EMPTY_SET, ready: true, failed: true };

/**
 * Subscribe to the current user's blocked users list, with a `ready` flag.
 * Pass an empty string to skip subscription (e.g. when user is not logged in).
 */
export function useBlockedUsersState(uid: string): BlockedUsersStateWithRetry {
  const storeRef = useRef<BlockedUsersState>(uid ? PENDING : SIGNED_OUT);
  const listenersRef = useRef(new Set<() => void>());
  // Bumped by `retry` to tear the listener down and subscribe again.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const publish = (next: BlockedUsersState) => {
      storeRef.current = next;
      /* v8 ignore next -- listeners may be empty during React commit phase */
      for (const l of listenersRef.current) l();
    };

    if (!uid) {
      publish(SIGNED_OUT);
      return;
    }

    // A different viewer's list (or a failed attempt) must not leak into
    // this one while it loads.
    if (storeRef.current !== PENDING) publish(PENDING);
    let gotSnapshot = false;
    return subscribeToBlockedUsers(
      uid,
      (uids) => {
        gotSnapshot = true;
        publish({ blocked: uids, ready: true, failed: false });
      },
      // After a snapshot, keep the last known list. Before one, the list is
      // unknown: say so, and let strict surfaces offer a retry.
      () => publish(gotSnapshot ? { blocked: storeRef.current.blocked, ready: true, failed: false } : FAILED),
    );
  }, [uid, attempt]);

  const state = useSyncExternalStore(
    (onStoreChange) => {
      listenersRef.current.add(onStoreChange);
      /* v8 ignore start -- React-managed cleanup */
      return () => {
        listenersRef.current.delete(onStoreChange);
      };
      /* v8 ignore stop */
    },
    () => storeRef.current,
  );
  return { ...state, retry };
}

/**
 * Subscribe to the current user's blocked users list.
 * Returns a Set of blocked UIDs that updates in real-time.
 *
 * Pass an empty string to skip subscription (e.g. when user is not logged in).
 */
export function useBlockedUsers(uid: string): Set<string> {
  return useBlockedUsersState(uid).blocked;
}

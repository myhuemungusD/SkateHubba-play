import { useEffect, useRef, useSyncExternalStore } from "react";
import { subscribeToBlockedUsers } from "../services/blocking";

const EMPTY_SET: Set<string> = new Set();

export interface BlockedUsersState {
  /** UIDs the viewer has blocked. Empty until the first snapshot lands. */
  blocked: Set<string>;
  /**
   * True once the block list is known: the first snapshot arrived, the
   * listener failed (fail open; the error is logged), or there's no viewer.
   * Surfaces that must never show a blocked player's content, even for a
   * frame, wait for this before rendering.
   */
  ready: boolean;
}

const SIGNED_OUT: BlockedUsersState = { blocked: EMPTY_SET, ready: true };
const PENDING: BlockedUsersState = { blocked: EMPTY_SET, ready: false };

/**
 * Subscribe to the current user's blocked users list, with a `ready` flag.
 * Pass an empty string to skip subscription (e.g. when user is not logged in).
 */
export function useBlockedUsersState(uid: string): BlockedUsersState {
  const storeRef = useRef<BlockedUsersState>(uid ? PENDING : SIGNED_OUT);
  const listenersRef = useRef(new Set<() => void>());

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

    // A different viewer's list must not leak into this one while it loads.
    if (storeRef.current !== PENDING) publish(PENDING);
    return subscribeToBlockedUsers(
      uid,
      (uids) => publish({ blocked: uids, ready: true }),
      () => publish({ blocked: storeRef.current.blocked, ready: true }),
    );
  }, [uid]);

  return useSyncExternalStore(
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

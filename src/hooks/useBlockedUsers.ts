import { useEffect, useRef, useSyncExternalStore } from "react";
import { subscribeToBlockedUsers } from "../services/blocking";

const EMPTY_SET: Set<string> = new Set();

/**
 * Subscribe to the current user's blocked users list.
 * Returns a Set of blocked UIDs that updates in real-time.
 *
 * Pass an empty string to skip subscription (e.g. when user is not logged in).
 */
export function useBlockedUsers(uid: string): Set<string> {
  const storeRef = useRef<Set<string>>(EMPTY_SET);
  const listenersRef = useRef(new Set<() => void>());

  useEffect(() => {
    if (!uid) {
      storeRef.current = EMPTY_SET;
      /* v8 ignore next -- listeners may be empty during React commit phase */
      for (const l of listenersRef.current) l();
      return;
    }

    return subscribeToBlockedUsers(uid, (uids) => {
      storeRef.current = uids;
      for (const l of listenersRef.current) l();
    });
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

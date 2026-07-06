import { useEffect, useRef } from "react";
import { useNotifications } from "../context/NotificationContext";

/**
 * Fire a one-shot success toast when `emailVerified` flips false → true.
 *
 * Called from `AppScreens` so the toast pairs with the reload flow in
 * `useAuth` (visibilitychange + manual "check now" both cause the auth
 * user object to transition to verified). Deliberately guarded so:
 *
 *  - Initial mount with an already-verified user is a no-op — returning
 *    users must never see the "just verified" toast.
 *  - `null` (signed out) → false or false → null transitions are no-ops —
 *    only the exact false → true transition triggers the toast.
 *
 * The `null` state is captured on the first render via a ref sentinel so
 * subsequent renders can distinguish "we've never observed a state" from
 * "we observed unverified".
 */
export function useEmailVerifiedToast(emailVerified: boolean | null | undefined): void {
  const { notify } = useNotifications();
  const wasVerifiedRef = useRef<"unset" | boolean | null>("unset");

  useEffect(() => {
    const current: boolean | null = emailVerified === undefined ? null : emailVerified;
    // First observation: capture baseline without firing so returning users
    // (already verified when the app mounts) never see a stale success toast.
    if (wasVerifiedRef.current === "unset") {
      wasVerifiedRef.current = current;
      return;
    }
    // Only the exact false → true transition qualifies.
    if (wasVerifiedRef.current === false && current === true) {
      notify({
        type: "success",
        title: "Email verified",
        message: "You can challenge players now.",
      });
    }
    wasVerifiedRef.current = current;
  }, [emailVerified, notify]);
}

import { useEffect, useState } from "react";
import { getAdminClaim } from "../services/auth";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";

interface AdminState {
  /** True only when the signed-in user's ID token carries the admin claim. */
  isAdmin: boolean;
  /** True while the claim for the current uid is still being resolved. */
  loading: boolean;
}

/**
 * Resolve whether the signed-in user holds the `admin` custom claim.
 *
 * Takes the uid rather than reading auth itself — the same convention
 * `useBlockedUsers(uid)` and `usePlayerProfile(uid)` use, so callers pass
 * `auth.user?.uid ?? ""` and an empty string means "no identity". A signed-out
 * caller therefore settles immediately as non-admin without touching the
 * service, and a uid change (someone else signs in on the same tab) re-runs
 * the check rather than inheriting the previous user's answer.
 *
 * The claim itself lives on the ID token, so a failure here is a token/network
 * problem, not a denial. It still resolves to `isAdmin: false`: the console
 * this gates is hidden, and failing closed is the only safe direction. The
 * warning is logged so a genuine outage is visible in Sentry breadcrumbs
 * rather than looking like a user who simply isn't an admin.
 */
export function useIsAdmin(uid: string): AdminState {
  const [result, setResult] = useState<{ checkedUid: string; isAdmin: boolean }>({ checkedUid: "", isAdmin: false });

  useEffect(() => {
    if (!uid) return;

    let stale = false;
    getAdminClaim()
      .then((isAdmin) => {
        if (stale) return;
        setResult({ checkedUid: uid, isAdmin });
      })
      .catch((err: unknown) => {
        if (stale) return;
        logger.warn("admin_claim_check_failed", { uid, error: parseFirebaseError(err) });
        setResult({ checkedUid: uid, isAdmin: false });
      });

    return () => {
      stale = true;
    };
  }, [uid]);

  // Settled only when the stored answer belongs to the uid being asked about —
  // otherwise a uid change would briefly report the previous user's claim.
  const settled = uid !== "" && result.checkedUid === uid;
  return { isAdmin: settled && result.isAdmin, loading: uid !== "" && !settled };
}

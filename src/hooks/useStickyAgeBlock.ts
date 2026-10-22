import { useEffect, useRef, useState } from "react";
import { blockUnderageSignIn } from "../services/auth.underage";
import { isAgeGateBlocked } from "../utils/coppaNotice";

/**
 * ProfileSetup's under-13 block state, seeded from the 24h sticky block
 * (utils/coppaNotice) so a blocked device opens straight to the card.
 *
 * COPPA "pending": an earlier block couldn't delete this sign-in (offline, API
 * down) and kept the session so it could try again. When the screen opens
 * blocked, it retries once, but only after `noProfileConfirmed` (the
 * existing-profile lookup came back empty), so an account whose profile only
 * timed out on sign-in is never touched.
 */
export function useStickyAgeBlock(collectsDob: boolean, noProfileConfirmed: boolean) {
  const state = useState(() => collectsDob && isAgeGateBlocked());
  const [blockedOnMount] = useState(state[0]);
  const retried = useRef(false);
  useEffect(() => {
    if (!blockedOnMount || !noProfileConfirmed || retried.current) return;
    retried.current = true;
    void blockUnderageSignIn();
  }, [blockedOnMount, noProfileConfirmed]);
  return state;
}

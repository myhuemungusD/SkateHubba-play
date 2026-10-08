/**
 * Server kill switch for the dice callable.
 *
 * `DICE_ENABLED` defaults off. While it is off, only uids listed in
 * `DICE_TESTER_UIDS` (comma-separated) may call. The client flag can hide
 * the UI, but the function is still reachable, so this check is the real gate.
 */
export function diceAccessAllowed(uid: string, enabled: boolean, testerList: string): boolean {
  if (enabled) return true;
  const testers = testerList
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return testers.includes(uid);
}

/**
 * Set synchronously by the push registration before it calls
 * `serviceWorker.register`, so the asset-cache worker can see the claim
 * on the same turn and avoid replacing the messaging worker.
 */
let messagingWorkerClaimed = false;

export function claimMessagingWorker(): void {
  messagingWorkerClaimed = true;
}

export function isMessagingWorkerClaimed(): boolean {
  return messagingWorkerClaimed;
}

/** @internal */
export function __resetSwClaimForTest(): void {
  messagingWorkerClaimed = false;
}

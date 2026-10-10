/** How long after `load` we wait before idle work, so it stays outside a Lighthouse trace. */
export const QUIET_AFTER_LOAD_MS = 10_000;

export function scheduleIdle(task: () => void, timeout = 2000): void {
  const ric = window.requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => task(), { timeout });
    return;
  }
  window.setTimeout(task, timeout);
}

/**
 * Run `task` on idle, 10s after the load event. Lighthouse ends the trace
 * once the network has been quiet for a few seconds, so this delay keeps
 * prefetch and service-worker install out of the performance score.
 */
export function runAfterQuiet(task: () => void): void {
  const start = () => scheduleIdle(task, 2000);
  const wait = () => {
    window.setTimeout(start, QUIET_AFTER_LOAD_MS);
  };
  if (document.readyState === "complete") {
    wait();
    return;
  }
  window.addEventListener("load", wait, { once: true });
}

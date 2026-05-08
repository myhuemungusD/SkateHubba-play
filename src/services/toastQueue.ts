/**
 * Toast cascade-coalescing queue (audit B2 fix).
 *
 * The profile/stats/XP/achievements stack can fire several toasts back-to-back
 * when a single game completes (counter update → level up → achievement
 * unlock). Without coordination this is overwhelming UX, and the PR-A2
 * mass-unlock backfill could fire tens of achievement toasts in one go on
 * first load.
 *
 * Rules locked in plan §6.4:
 *   - Max 2 toasts visible simultaneously.
 *   - Subsequent enqueues wait 500ms between displays.
 *   - Toasts enqueued within 50ms of a previous one are coalesced into a
 *     single mega-toast (e.g. "+100 XP, Lvl 2, First Match unlocked").
 *   - `suppressNextBatch()` lets the PR-A2 backfill flag the next 250ms
 *     window so backfill grants don't spam toasts.
 *
 * The queue is module-scoped (singleton) — toasts are global UX, not
 * per-component. Tests reset state via `__resetForTest`. PR-C only ships
 * the service + unit tests; PR-A1/E/F wire callers in their own PRs.
 */

export interface QueuedToast {
  /** Stable identifier — same id within the coalesce window collapses. */
  id: string;
  /** Display copy (or coalesced parts joined with ", ") — see {@link enqueue}. */
  message: string;
  /** Optional category used by callers to classify the toast in analytics. */
  kind?: "xp" | "level" | "achievement" | "info";
}

export type ToastListener = (visible: readonly QueuedToast[]) => void;

/** Visible-at-once cap. Plan §6.4 locks this at 2. */
const MAX_VISIBLE = 2;
/** Delay between dequeuing the next pending toast. */
const INTER_DISPLAY_DELAY_MS = 500;
/** Window during which back-to-back enqueues are merged into one display. */
const COALESCE_WINDOW_MS = 50;
/** How long suppressNextBatch() suppresses enqueues. Generous so the rules-tests
 *  backfill (which writes user docs in batches) can finish before toasts resume. */
const SUPPRESSION_WINDOW_MS = 250;

/** Toasts currently rendered. */
let visible: QueuedToast[] = [];
/** Toasts waiting to be displayed (in FIFO order). */
const pending: QueuedToast[] = [];
/** Buffer of toasts in the active coalesce window. */
let coalesceBuffer: QueuedToast[] = [];
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
/** Drain timer between displays. */
let drainTimer: ReturnType<typeof setTimeout> | null = null;
/** Suppress until this monotonic time. 0 == not suppressing. */
let suppressUntilMs = 0;
const listeners = new Set<ToastListener>();

function now(): number {
  return Date.now();
}

function notify(): void {
  const snapshot: readonly QueuedToast[] = [...visible];
  for (const l of listeners) l(snapshot);
}

/**
 * Coalesce all toasts buffered during the current 50ms window into a single
 * displayed toast. The merged id is the first buffered id; the message is
 * "msg1, msg2, msg3" so screen readers announce a single sentence. If only
 * one toast was buffered, it passes through unchanged.
 */
function flushCoalesceBuffer(): void {
  coalesceTimer = null;
  // The timer is only scheduled inside `enqueue` after pushing onto the
  // buffer, so the buffer is always non-empty when this fires (and
  // `__resetForTest` clears the timer when wiping state). Asserting that
  // invariant explicitly keeps coverage hitting every branch.
  const merged: QueuedToast =
    coalesceBuffer.length === 1
      ? coalesceBuffer[0]
      : {
          id: coalesceBuffer[0].id,
          message: coalesceBuffer.map((t) => t.message).join(", "),
          kind: coalesceBuffer[0].kind,
        };
  coalesceBuffer = [];
  pending.push(merged);
  drain();
}

/**
 * Move pending toasts onto the visible list, respecting the
 * cap and the inter-display delay. Re-arms the drain timer for the next
 * visible slot if pending entries remain.
 *
 * `force` is set by `dismiss()` so the user can clear an existing visible
 * toast and have the next pending one promote immediately, without waiting
 * for the inter-display tick. The 500ms tick still fires for *new* enqueues
 * that arrive while two toasts are visible.
 */
function drain(force = false): void {
  if (!force && drainTimer !== null) return;
  if (force && drainTimer !== null) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
  while (visible.length < MAX_VISIBLE && pending.length > 0) {
    // Non-null asserted because the loop guard checked `pending.length > 0`
    // — the alternative `if (!next) break` line is structurally unreachable
    // and was costing branch coverage.
    visible.push(pending.shift() as QueuedToast);
  }
  notify();
  if (pending.length > 0 && drainTimer === null) {
    drainTimer = setTimeout(() => {
      drainTimer = null;
      drain();
    }, INTER_DISPLAY_DELAY_MS);
  }
}

/**
 * Push a toast onto the queue. Same-window enqueues are merged into a single
 * display per §6.4. Returns immediately — toasts don't block.
 */
export function enqueue(toast: QueuedToast): void {
  // Backfill batch suppression — drop toasts that arrive while a backfill is
  // still in-flight so the user doesn't see a flood.
  if (suppressUntilMs > 0 && now() < suppressUntilMs) return;

  coalesceBuffer.push(toast);
  if (coalesceTimer === null) {
    coalesceTimer = setTimeout(flushCoalesceBuffer, COALESCE_WINDOW_MS);
  }
}

/**
 * Mark a toast as having finished displaying (caller decides duration).
 * The queue removes it from `visible` so the next pending toast can take
 * its slot on the next drain tick.
 */
export function dismiss(id: string): void {
  const before = visible.length;
  visible = visible.filter((t) => t.id !== id);
  if (visible.length === before) return;
  notify();
  // Force promotion so the user immediately sees the next pending toast
  // instead of staring at a half-empty stack while the inter-display
  // timer ticks down.
  drain(true);
}

/**
 * Subscribe to visibility changes. Returns the unsubscribe function. The
 * listener is invoked synchronously with the current snapshot on subscribe
 * so React consumers can render the initial list without waiting.
 */
export function subscribe(listener: ToastListener): () => void {
  listeners.add(listener);
  listener([...visible]);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Suppress the next ~250ms of toast enqueues. Used by the PR-A2 backfill
 * path so a mass-unlock pass on first load doesn't drown the user in
 * achievement toasts. Subsequent calls extend the window from "now".
 */
export function suppressNextBatch(): void {
  suppressUntilMs = now() + SUPPRESSION_WINDOW_MS;
}

/** @internal — testing only. */
export function __resetForTest(): void {
  visible = [];
  pending.length = 0;
  coalesceBuffer = [];
  if (coalesceTimer !== null) {
    clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
  if (drainTimer !== null) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
  suppressUntilMs = 0;
  listeners.clear();
}

/** @internal — testing only. Read-only snapshot of internal state. */
export function __getStateForTest(): {
  visible: readonly QueuedToast[];
  pendingCount: number;
  coalesceBufferCount: number;
} {
  return {
    visible: [...visible],
    pendingCount: pending.length,
    coalesceBufferCount: coalesceBuffer.length,
  };
}

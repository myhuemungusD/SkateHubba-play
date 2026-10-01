/**
 * Shared `@sentry/node` double for the api/ handler tests.
 *
 * Usage (the factory must import lazily — vi.mock is hoisted):
 *
 *   vi.mock("@sentry/node", async () => (await import("./sentry-node.test-helpers")).sentryNodeMock);
 *
 * The double lives on globalThis so a test that calls `vi.resetModules()` to
 * get a fresh handler (and therefore a fresh api/_sentry.ts) still sees the
 * same spies it imported statically.
 *
 * Not production code; excluded from coverage by the `*test-helpers*` pattern.
 */
import { vi, type Mock } from "vitest";

export interface SentryNodeMock {
  init: Mock;
  captureException: Mock;
  flush: Mock;
  linkedErrorsIntegration: () => { name: string };
}

const g = globalThis as { __sentryNodeMock?: SentryNodeMock };

export const sentryNodeMock: SentryNodeMock = (g.__sentryNodeMock ??= {
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(),
  linkedErrorsIntegration: () => ({ name: "LinkedErrors" }),
});

export const TEST_SENTRY_DSN = "https://publickey@o1.ingest.sentry.io/1";

/** Reset the spies to a working, flushing SDK. */
export function resetSentryNodeMock(): void {
  sentryNodeMock.init.mockReset();
  sentryNodeMock.captureException.mockReset();
  sentryNodeMock.flush.mockReset().mockResolvedValue(true);
}

/**
 * Record `<level>:<event>` per capture, `flush`, and `respond` (when the
 * handler writes its JSON body) into one ordered log, so a test can prove
 * events are flushed BEFORE the response ends.
 */
export function recordSentryOrder<R extends { json: (body: unknown) => void }>(res: R): string[] {
  const order: string[] = [];
  sentryNodeMock.captureException.mockImplementation((_e: unknown, ctx: { tags: { event: string }; level: string }) => {
    order.push(`${ctx.level}:${ctx.tags.event}`);
  });
  sentryNodeMock.flush.mockImplementation(async () => {
    order.push("flush");
    return true;
  });
  const json = res.json;
  res.json = (body: unknown) => {
    order.push("respond");
    json(body);
  };
  return order;
}

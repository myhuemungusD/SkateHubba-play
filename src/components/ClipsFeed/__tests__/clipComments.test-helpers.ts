import { vi } from "vitest";
import type { ClipComment } from "../../../services/clips.comments";

/**
 * Shared wiring for the two comment specs.
 *
 * `ClipComments.test.tsx` (the sheet) and `useClipComments.test.ts` (the hook
 * underneath it) mock the exact same service surface. Keeping one description
 * of that surface here means the mock cannot drift from the real module in
 * only one of the two suites — the failure mode where the hook spec keeps
 * passing against a signature the component spec has already moved past.
 *
 * The mock bodies live in a helper rather than in each spec because
 * `vi.mock` factories are hoisted above imports; a spec pulls them in with an
 * async factory + dynamic `import()`, which is evaluated after hoisting and
 * therefore may reference this module safely.
 *
 * Filename follows the project `*.test-helpers.ts` convention: outside
 * Vitest's `*.test.{ts,tsx}` include glob, excluded from coverage, and skipped
 * by the test-duplication gate.
 */

/**
 * The service spies, shared by reference. A spec imports this object
 * statically and stages outcomes on it; the `vi.mock` factory resolves to the
 * same module instance, so the two views agree.
 */
export const clipCommentsMocks = {
  fetch: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
};

/** Module replacement for `services/clips.comments`. */
export function clipCommentsModuleMock() {
  return {
    CLIP_COMMENT_MAX_LENGTH: 300,
    fetchClipComments: (...args: unknown[]) => clipCommentsMocks.fetch(...args),
    createClipComment: (...args: unknown[]) => clipCommentsMocks.create(...args),
    deleteClipComment: (...args: unknown[]) => clipCommentsMocks.remove(...args),
  };
}

/** Module replacement for `services/logger` — silences expected warn paths. */
export function loggerModuleMock() {
  return { logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } };
}

/**
 * Reset the spies and put `fetchClipComments` back to "empty thread", the
 * state most cases start from. Call from `beforeEach`.
 */
export function resetClipCommentsMocks(): void {
  vi.clearAllMocks();
  clipCommentsMocks.fetch.mockResolvedValue({ comments: [], cursor: null });
}

/** A comment by another skater. Override `userId` to make it the viewer's. */
export function makeClipComment(overrides: Partial<ClipComment> = {}): ClipComment {
  return {
    id: "cm1",
    clipId: "c1",
    userId: "p2",
    username: "bob",
    text: "Clean.",
    createdAt: null,
    ...overrides,
  };
}

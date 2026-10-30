/**
 * Block-list listener stubs shared by the ClipsFeed and DisputeLane specs.
 *
 * Each spec still mocks `services/blocking` itself (vi.mock is hoisted per
 * file) and points `subscribeToBlockedUsers` at one of these. Filename follows
 * the `*.test-helpers.ts` convention: outside the Vitest include glob,
 * excluded from coverage and skipped by the test-duplication gate.
 */
export type BlockListener = (uid: string, onUpdate: (uids: Set<string>) => void, onError?: () => void) => () => void;

/** Answers at once with the given blocked uids. */
export const answerBlockList =
  (uids: string[]): BlockListener =>
  (_uid, onUpdate) => {
    onUpdate(new Set(uids));
    return () => {};
  };

/** Fails before the first snapshot, like a denied or offline listener. */
export const failBlockList: BlockListener = (_uid, _onUpdate, onError) => {
  onError?.();
  return () => {};
};

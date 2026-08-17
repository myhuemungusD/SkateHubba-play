import type { LockerItem } from "../../services/locker";

/**
 * Shared Economy Phase A fixtures.
 *
 * Lives beside the component specs that own the rendering contract
 * (`LockerShowcase.test.tsx`), and is imported by the screen-level failure
 * spec too so there is exactly one description of a locker item across the
 * suite — the profile spec asserting "the locker still populated" should not
 * carry its own copy of the shape.
 *
 * Filename follows the project `*.test-helpers.ts` convention: outside
 * Vitest's `*.test.{ts,tsx}` include glob, excluded from coverage, and skipped
 * by the test-duplication gate.
 */

/**
 * A locker item, defaulting to a plain common deck with no image and no
 * provenance. Override any field to exercise rarity tints, icon fallbacks,
 * empty brand, etc.
 */
export function buildLockerItem(overrides?: Partial<LockerItem>): LockerItem {
  return {
    id: "i1",
    type: "deck",
    brand: "Hubba",
    name: "Ledge Deck",
    imageUrl: null,
    rarity: "common",
    acquiredAt: null,
    provenanceReason: null,
    ...overrides,
  };
}

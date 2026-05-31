/**
 * Shared fixtures for Firestore rules tests.
 *
 * Test files in this dir each tend to spin up their own copy of a "valid
 * game doc" factory plus a near-identical `beforeAll` initializer because
 * the games schema has lots of required fields. That copy/paste is what
 * triggers `npm run check:test-dup`. Centralizing the common shape and
 * test-env bootstrap here keeps new red-team suites lean without re-touching
 * the existing files (whose duplicates are already snapshotted in the
 * baseline).
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import type { Reference } from "@firebase/storage-types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { doc, serverTimestamp, setDoc, setLogLevel } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach } from "vitest";

interface ValidGameOpts {
  player1Uid: string;
  player2Uid: string;
  player1Username?: string;
  player2Username?: string;
}

/**
 * Seed a /games doc through admin rules-disabled context. Lets a test re-seed
 * with custom overrides (e.g. a stale updatedAt for negative cases).
 */
export async function seedValidGame(
  env: RulesTestEnvironment,
  gameId: string,
  opts: ValidGameOpts,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "games", gameId), makeValidGame(opts, overrides));
  });
}

/**
 * Returns a fresh valid /games doc payload that satisfies the create rule.
 * Pass `overrides` for per-test customization (e.g. status, judge fields).
 */
export function makeValidGame(
  { player1Uid, player2Uid, player1Username = "alice", player2Username = "bob" }: ValidGameOpts,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    player1Uid,
    player2Uid,
    player1Username,
    player2Username,
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: player1Uid,
    phase: "setting",
    currentSetter: player1Uid,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnNumber: 1,
    winner: null,
    turnHistory: [],
    turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

/**
 * Seed a terminated /games doc whose `winner` field is pre-populated. Used by
 * the wins/losses-update tests that need a backing game for the owner-side
 * `ownerCanCloseWins` / `ownerCanCloseLosses` checks in firestore.rules. Keeps
 * the per-test shape down to a single helper call so the test-duplication
 * detector stays clean.
 *
 * When `winner` is omitted, the seeded game records the OPPONENT as the
 * winner — convenient for tests that need a "losing" backing game.
 */
export async function seedTerminatedGame(
  env: RulesTestEnvironment,
  gameId: string,
  opts: {
    player1Uid: string;
    player2Uid: string;
    winner?: string;
    status?: "complete" | "forfeit";
  },
): Promise<void> {
  const { player1Uid, player2Uid, status = "complete" } = opts;
  const winner = opts.winner ?? player2Uid;
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "games", gameId), {
      player1Uid,
      player2Uid,
      status,
      winner,
    });
  });
}

/**
 * Recursively delete every object under a Storage emulator bucket.
 *
 * `RulesTestEnvironment.clearStorage()` only calls `listAll()` on the bucket
 * ROOT and deletes the returned `items` — i.e. top-level objects ONLY. It
 * does NOT descend into `prefixes`. Every game-video path in this suite is
 * nested (`games/{gameId}/{turnPath}/{role}.{ext}`), so the built-in clear
 * deletes ZERO of them: residual objects pile up across tests and across
 * test files (the storage emulator is a single shared process), which is
 * exactly what made `npm run test:rules` non-deterministic — a leftover
 * object at a create path flips the emulator onto a stale-metadata branch,
 * surfacing as spurious `storage/unauthorized` / "uploaderUid undefined"
 * failures on otherwise-valid uploads. Walking `prefixes` recursively clears
 * the whole tree so each test (and each file) starts from an empty bucket.
 */
/** Storage-emulator codes that mean "nothing here" — safe to treat as clean. */
function isEmptyPrefixError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "storage/object-not-found";
}

/**
 * `listAll()` against the Storage emulator can answer with a transient
 * `storage/unauthorized` (NOT a real permission failure under
 * withSecurityRulesDisabled — the emulator just hasn't settled the prefix
 * yet). Swallowing it would skip a prefix that still holds objects and let
 * pollution survive, so retry a few times before surfacing it.
 */
async function listAllWithRetry(ref: Reference, attempts = 5): Promise<Awaited<ReturnType<Reference["listAll"]>>> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await ref.listAll();
    } catch (err) {
      if (isEmptyPrefixError(err)) return { items: [], prefixes: [] };
      lastErr = err;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
  throw lastErr;
}

async function deleteRefTree(ref: Reference): Promise<void> {
  const listing = await listAllWithRetry(ref);
  await Promise.all(listing.items.map((item) => item.delete()));
  await Promise.all(listing.prefixes.map((prefix) => deleteRefTree(prefix)));
}

/**
 * The top-level prefixes every storage rules-test writes under. Clearing
 * these explicitly (rather than the bucket ROOT) sidesteps a Storage-emulator
 * quirk where `listAll()` on `''` intermittently throws `unauthorized` when
 * the suite runs after another storage file in the shared emulator process.
 */
const STORAGE_TEST_PREFIXES = ["games", "users"] as const;

/**
 * Fully clear the Storage emulator for a rules-test env, including the NESTED
 * paths the built-in `clearStorage()` misses. `clearStorage()` only deletes
 * the bucket ROOT's `items` — never descending into `prefixes` — so every
 * game-video (`games/{id}/{turn}/{role}.{ext}`) and avatar
 * (`users/{uid}/avatar.*`) object survives it. Those survivors accumulate
 * across tests and across files (the storage emulator is one shared process),
 * which is what made `npm run test:rules` non-deterministic. Walking each
 * known prefix recursively clears the tree so no test (and no file) inherits
 * another's objects. Call this in both `beforeEach` AND `afterAll`.
 */
export async function clearStorageDeep(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const root = ctx.storage().ref() as unknown as Reference;
    for (const prefix of STORAGE_TEST_PREFIXES) {
      await deleteRefTree(root.child(prefix));
    }
  });
}

/**
 * Boot a Storage rules test env against the local emulator on port 9199,
 * loading the repo's storage.rules. Mirrors the per-file boilerplate every
 * storage suite was reproducing by hand.
 */
export async function bootStorageRulesTestEnv(projectId: string): Promise<RulesTestEnvironment> {
  setLogLevel("error");
  return initializeTestEnvironment({
    projectId,
    storage: {
      host: "127.0.0.1",
      port: 9199,
      rules: readFileSync(resolve(process.cwd(), "storage.rules"), "utf8"),
    },
  });
}

/**
 * Wires the standard Storage rules-test lifecycle so each suite starts AND
 * ends with an empty bucket. Uses `clearStorageDeep` (not the built-in
 * shallow `clearStorage`) in both `beforeEach` and `afterAll` so no test —
 * and no later test FILE in the shared emulator process — inherits leftover
 * objects. Returns a getter for the live env (beforeAll runs after import).
 */
export function setupStorageRulesTestEnv(projectId: string): () => RulesTestEnvironment {
  let env: RulesTestEnvironment | undefined;
  beforeAll(async () => {
    env = await bootStorageRulesTestEnv(projectId);
  });
  afterAll(async () => {
    if (env) await clearStorageDeep(env);
    await env?.cleanup();
  });
  beforeEach(async () => {
    if (!env) throw new Error("storage rules test env not initialized");
    await clearStorageDeep(env);
  });
  return () => {
    if (!env) throw new Error("storage rules test env not initialized");
    return env;
  };
}

/**
 * Boot a Firestore rules test env against the local emulator on port 8080,
 * loading the repo's firestore.rules. Mirrors the shape every red-team
 * `beforeAll` was reproducing by hand.
 */
export async function bootRulesTestEnv(projectId: string): Promise<RulesTestEnvironment> {
  setLogLevel("error");
  return initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
}

/**
 * Wires the standard rules-test lifecycle (beforeAll/afterAll/beforeEach) so
 * red-team suites don't reproduce the same boilerplate. Returns an accessor
 * for the live `RulesTestEnvironment` (not the env itself — beforeAll runs
 * AFTER module import, so we hand back a getter).
 *
 * Usage:
 *   const getEnv = setupRulesTestEnv("demo-foo-redteam", async (env) => {
 *     await env.withSecurityRulesDisabled(async (ctx) => seedFixtures(ctx));
 *   });
 *   ...
 *   it("...", () => {
 *     const ctx = getEnv().authenticatedContext("uid");
 *     ...
 *   });
 */
export function setupRulesTestEnv(
  projectId: string,
  perTestSetup?: (env: RulesTestEnvironment) => Promise<void>,
): () => RulesTestEnvironment {
  let env: RulesTestEnvironment | undefined;
  beforeAll(async () => {
    env = await bootRulesTestEnv(projectId);
  });
  afterAll(async () => {
    await env?.cleanup();
  });
  beforeEach(async () => {
    if (!env) throw new Error("rules test env not initialized");
    await env.clearFirestore();
    if (perTestSetup) await perTestSetup(env);
  });
  return () => {
    if (!env) throw new Error("rules test env not initialized");
    return env;
  };
}

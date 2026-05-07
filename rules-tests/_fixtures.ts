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

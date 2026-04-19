/**
 * Spots update — red-team tests for the hardened update-path validation.
 *
 * Before the April 2026 hardening pass, the /spots/{id} update rule only
 * re-validated `name` and `description`; an attacker who controlled their
 * own spot doc could PATCH in a malformed `gnarRating`, oversized
 * `obstacles` array, or bogus types. The hardening rule now re-applies
 * the full create-time validation block to every update.
 *
 * Each test here is an attack the new rule must reject. The legitimate
 * update companion proves the rule didn't over-tighten.
 *
 * Run via:  npm run test:rules
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { doc, setDoc, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-spots-redteam";

const OWNER_UID = "owner-uid";
const SPOT_ID = "99999999-aaaa-bbbb-cccc-dddddddddddd";

let testEnv: RulesTestEnvironment;

function makeValidSpot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    createdBy: OWNER_UID,
    name: "Hollenbeck Hubba",
    description: null,
    latitude: 34.0522,
    longitude: -118.2437,
    gnarRating: 3,
    bustRisk: 2,
    obstacles: ["ledge", "hubba"],
    photoUrls: [],
    isVerified: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function asOwner(): RulesTestContext {
  return testEnv.authenticatedContext(OWNER_UID, { email_verified: true });
}

async function seedSpot(overrides: Record<string, unknown> = {}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "spots", SPOT_ID), makeValidSpot(overrides));
  });
}

beforeAll(async () => {
  setLogLevel("error");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedSpot();
});

describe("spots update — red-team against hardened validation", () => {
  it("attack: owner CANNOT set gnarRating to a string on update", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ gnarRating: "gnarly" })));
  });

  it("attack: owner CANNOT set gnarRating to 999 (out of 1–5 range)", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ gnarRating: 999 })));
  });

  it("attack: owner CANNOT set gnarRating to 0 (below range)", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ gnarRating: 0 })));
  });

  it("attack: owner CANNOT set bustRisk to a float-ish non-int", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ bustRisk: 2.5 })));
  });

  it("attack: owner CANNOT submit a 15-item obstacles list (cap is 14)", async () => {
    const obstacles = Array.from({ length: 15 }, (_, i) => `obstacle-${i}`);
    await assertFails(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ obstacles })));
  });

  it("attack: owner CANNOT replace obstacles with a non-list type", async () => {
    await assertFails(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ obstacles: "rail,ledge" })));
  });

  it("attack: owner CANNOT submit a 6-item photoUrls list (cap is 5)", async () => {
    const photoUrls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}.jpg`);
    await assertFails(setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ photoUrls })));
  });

  it("legitimate: owner CAN update the description within caps", async () => {
    await assertSucceeds(
      setDoc(doc(asOwner().firestore(), "spots", SPOT_ID), makeValidSpot({ description: "Fresh wax, mid-block." })),
    );
  });
});

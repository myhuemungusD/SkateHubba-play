/**
 * Spots auth red-team — proves the H-R4 April 2026 hardening that requires
 * `isSignedIn()` for every `/spots/{spotId}` read.
 *
 * Previously active spots were world-readable (`allow read: if
 * resource.data.isActive == true`). That let an anonymous attacker
 * enumerate the spots collection + join with clips + users to build a
 * user-location graph — a privacy incident and an App-Store location-
 * data disclosure risk. The rule now demands auth in addition to the
 * isActive gate; inactive spots remain unreadable by anyone.
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
import { doc, getDoc, setDoc, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-spots-auth-redteam";

const OWNER_UID = "owner-uid";
const OTHER_UID = "stranger-uid";
const SPOT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

let testEnv: RulesTestEnvironment;

function makeValidSpot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    createdBy: OWNER_UID,
    name: "Red-Team Ledge",
    description: null,
    latitude: 34.0522,
    longitude: -118.2437,
    gnarRating: 3,
    bustRisk: 2,
    obstacles: ["ledge"],
    photoUrls: [],
    isVerified: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function asSignedIn(): RulesTestContext {
  return testEnv.authenticatedContext(OTHER_UID, { email_verified: true });
}

function asAnonymous(): RulesTestContext {
  return testEnv.unauthenticatedContext();
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
});

describe("spots — auth red-team", () => {
  it("attack: anonymous read of an active spot is DENIED", async () => {
    await seedSpot();
    await assertFails(getDoc(doc(asAnonymous().firestore(), "spots", SPOT_ID)));
  });

  it("attack: anonymous read of an inactive spot is also DENIED", async () => {
    await seedSpot({ isActive: false });
    await assertFails(getDoc(doc(asAnonymous().firestore(), "spots", SPOT_ID)));
  });

  it("legitimate: signed-in read of an active spot succeeds", async () => {
    await seedSpot();
    await assertSucceeds(getDoc(doc(asSignedIn().firestore(), "spots", SPOT_ID)));
  });

  it("legitimate: inactive spots remain hidden even from signed-in users", async () => {
    // `isActive == true` is still a second-layer gate; anonymous-gate
    // hardening must not accidentally relax the soft-delete behavior.
    await seedSpot({ isActive: false });
    await assertFails(getDoc(doc(asSignedIn().firestore(), "spots", SPOT_ID)));
  });
});

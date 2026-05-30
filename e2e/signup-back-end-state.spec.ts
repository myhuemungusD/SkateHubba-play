/**
 * E2E — first-time signup writes the canonical 3-doc back-end shape.
 *
 * This is the spec that would have caught the May 2026 production code red.
 *
 * Background: a 3-month-stale `firestore.rules` deploy made the 3-write
 * `runTransaction` in `src/services/users.ts:createProfile` fail with
 * `permission-denied` for every new signup. The auth pipeline succeeded
 * (the user landed in the lobby UI) but the back-end never received the
 * canonical profile docs. No existing E2E asserted on the back-end state
 * after signup — every spec only checked the post-signup UI — so the
 * regression slipped past CI.
 *
 * This spec drives the production signup flow end-to-end through the UI,
 * then reads the three docs directly from the Firestore emulator REST API
 * and asserts each one was written with the expected shape. If
 * `firestore.rules` ever drifts from the createProfile contract again,
 * this fails immediately.
 *
 * Sibling: `rules-tests/users-create-tx.rules.test.ts` proves the rule
 * shape unit-side. This E2E proves the full client → emulator path lands
 * the same shape.
 *
 * Local run (requires emulators):
 *   npm run test:e2e -- e2e/signup-back-end-state.spec.ts
 */
import { test, expect } from "@playwright/test";
import { clearAll } from "./helpers/emulator";
import { signUpAndSetupProfile } from "./helpers/auth-flow";
import { readDocByPath, uidForEmail } from "./helpers/firestore-read";

test.beforeEach(async () => {
  await clearAll();
});

test("first-time signup writes users/{uid}, users/{uid}/private/profile, and usernames/{handle}", async ({
  page,
}) => {
  const email = "backend-state@test.com";
  const password = "password123";
  const username = "sk8backend";

  // Drive the canonical signup flow through the UI. `signUpAndSetupProfile`
  // walks the signup card → profile setup → lobby exactly as a real user
  // would; the underlying createProfile runs as the 3-write transaction
  // that the May 2026 regression broke.
  await signUpAndSetupProfile(page, email, password, username);

  // Lobby header is the UI's confirmation the flow completed without an
  // error toast. The whole point of this spec is that the UI succeeding
  // is NOT sufficient — we now verify the back-end shape.
  await expect(page.getByRole("heading", { name: "Your Games" })).toBeVisible({ timeout: 10_000 });

  const uid = await uidForEmail(email);

  // 1. users/{uid} — public profile doc.
  // Fields mirror UserProfile in src/services/users.ts. createdAt is a
  // serverTimestamp so we assert presence, not value.
  const userDoc = await readDocByPath(`users/${uid}`);
  expect(userDoc, "users/{uid} must exist after signup").not.toBeNull();
  expect(userDoc).toMatchObject({
    uid,
    username,
    stance: expect.any(String) as unknown as string,
  });
  expect(userDoc).toHaveProperty("createdAt");

  // 2. users/{uid}/private/profile — owner-only sensitive fields.
  // emailVerified starts false (Firebase emulator does not auto-verify
  // password signups). dob is set by the inline age-gate on the signup
  // card; the production createProfile rejects calls without it.
  const privateDoc = await readDocByPath(`users/${uid}/private/profile`);
  expect(privateDoc, "users/{uid}/private/profile must exist after signup").not.toBeNull();
  expect(privateDoc).toHaveProperty("emailVerified");
  expect(privateDoc).toHaveProperty("dob");
  // dob shape is ISO YYYY-MM-DD per DOB_RE in src/services/users.ts.
  expect(privateDoc?.dob).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // 3. usernames/{handle} — uniqueness reservation. Keyed by the
  // normalized (lowercase) handle. uid must match the new account so the
  // reservation can't be hijacked.
  const usernameDoc = await readDocByPath(`usernames/${username.toLowerCase()}`);
  expect(usernameDoc, "usernames/{handle} reservation must exist after signup").not.toBeNull();
  expect(usernameDoc).toMatchObject({ uid });
  expect(usernameDoc).toHaveProperty("reservedAt");
});

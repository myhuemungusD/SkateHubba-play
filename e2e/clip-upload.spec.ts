/**
 * E2E coverage for the core user action: recording a clip during a turn and
 * uploading it to Firebase Storage.
 *
 * game.spec.ts exercises the setter UI up to "Recorded" but does NOT click the
 * "✓ Landed" decision button, so it never triggers submitSetterTrick() — which
 * is the function that actually runs `uploadVideo()` and then persists the
 * resulting download URL via `setTrick()`. As a result the real upload path
 * (record → upload to Storage emulator → write currentTrickVideoUrl → advance
 * to the matching phase) had no end-to-end assertion: a regression that broke
 * upload-then-persist could not be caught here.
 *
 * This spec drives the setter upload path (single-player reachable with
 * mockMedia) and asserts the OUTCOME of the upload rather than a transient
 * progress frame:
 *   1. After recording, the setter confirms with "✓ Landed", which kicks off
 *      the real resumable upload to the Storage emulator (:9199) — the media
 *      mock fakes only the camera/MediaRecorder, never uploadVideo().
 *   2. The game advances from the setting phase to the matching phase, so the
 *      setter (now waiting on the matcher) sees the waiting screen.
 *   3. `currentTrickVideoUrl` in Firestore is a real Storage-emulator download
 *      URL for THIS game's clip — proving the uploaded bytes resolved to a URL
 *      that landed in game state.
 *
 * The "Uploading video..." progress label is intentionally NOT asserted: a
 * ~6 KB fake clip uploads to the local emulator in milliseconds, so the
 * progress frame is not reliably observable. Asserting the persisted URL is
 * both stronger (it proves the upload *completed*) and race-free.
 *
 * Follows the same emulator-aware helpers as game.spec.ts (auth-flow,
 * media-mock, emulator REST helpers) — no new mocking approach.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { clearAll, createUser, createProfile, listGames, getCurrentTrickVideoUrl } from "./helpers/emulator";
import { MEDIA_MOCK_SCRIPT } from "./helpers/media-mock";
import { signUpVerifiedAndChallenge } from "./helpers/game-flow";

const P1 = { email: "p1@test.com", password: "password123", username: "p1skater" };
const P2 = { email: "p2@test.com", password: "password123", username: "p2skater" };

test.beforeEach(async () => {
  await clearAll();
});

test("setter records a clip → upload completes and download URL is persisted to game state", async ({ browser }) => {
  // P2 only needs to exist so P1 can challenge them; created via the emulator
  // REST API (no UI walkthrough needed for the opponent).
  const p2 = await createUser(P2.email, P2.password);
  await createProfile(p2.uid, P2.username, P2.email, false);

  const p1Ctx: BrowserContext = await browser.newContext();
  const p1: Page = await p1Ctx.newPage();
  // Enable the fake camera / MediaRecorder BEFORE any navigation (the helper
  // performs the first goto). The Storage upload itself is NOT mocked — it
  // hits the Storage emulator for real.
  await p1.addInitScript(MEDIA_MOCK_SCRIPT);

  // Sign up + verify P1, then challenge P2 → P1 becomes the setter in the
  // setting phase, landing on the "Name your trick" step.
  await signUpVerifiedAndChallenge(p1, P1, P2.username);

  // Name the trick (this reveals the recorder).
  await p1.getByPlaceholder("Name your trick").fill("Kickflip");

  // Record and stop the fake clip (camera auto-opens for the setter).
  await p1.getByRole("button", { name: /Record.*Land Your Trick/i }).click();
  await p1.waitForTimeout(200);
  await p1.getByRole("button", { name: "Stop Recording" }).click();
  await expect(p1.getByText("Recorded", { exact: false })).toBeVisible({ timeout: 5_000 });

  // (1) Confirm the trick was LANDED. This is the click game.spec.ts omits —
  // it is what triggers submitSetterTrick() → uploadVideo() → setTrick().
  // Without it the upload never runs and the phase never advances.
  await expect(p1.getByRole("button", { name: "✓ Landed" })).toBeVisible({ timeout: 5_000 });
  await p1.getByRole("button", { name: "✓ Landed" }).click();

  // (2) Upload + setTrick complete → game advances to the matching phase, so
  // P1 (now waiting on the matcher) sees the waiting screen. This also proves
  // the upload didn't fail: a failed upload surfaces an inline error/Retry on
  // the setter screen and never reaches the waiting screen.
  await expect(p1.getByText(/Waiting on @p2skater/i)).toBeVisible({ timeout: 20_000 });

  await p1Ctx.close();

  // (3) Read the game back from Firestore and assert the uploaded clip's
  // download URL was persisted. clearAll() ran in beforeEach and this test
  // creates exactly one game, so listGames() returns a single entry.
  const games = await listGames();
  const gameIds = Object.keys(games);
  expect(gameIds).toHaveLength(1);
  const gameId = gameIds[0];

  const videoUrl = await getCurrentTrickVideoUrl(gameId);
  expect(videoUrl).not.toBeNull();
  // The Storage emulator serves download URLs from :9199. Asserting the host
  // (rather than the full signed URL) keeps this robust to token/query-string
  // changes across firebase-tools versions.
  expect(videoUrl).toContain("9199");
  // The clip is stored at the deterministic path games/{gameId}/turn-1/set.*,
  // which appears URL-encoded in the download URL. Matching the gameId proves
  // the persisted URL belongs to THIS game's clip, not a stale one.
  expect(videoUrl).toContain(gameId);
});

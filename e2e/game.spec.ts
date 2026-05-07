/**
 * E2E tests for the full game flow:
 *   challenge → set trick → match trick (miss/land) → timeout → game over
 *
 * Two-player tests use two browser contexts (p1Ctx / p2Ctx) so each player has
 * an independent auth session — the same way real users play on separate devices.
 *
 * Player 2 is created programmatically via the emulator REST API (faster than a
 * second UI sign-up) and their profile is seeded directly into Firestore.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  clearAll,
  createUser,
  createProfile,
  createGame,
  verifyEmail,
  expireGameDeadline,
  forceTokenRefresh,
} from "./helpers/emulator";
import { MEDIA_MOCK_SCRIPT } from "./helpers/media-mock";
import { signUpAndSetupProfile, signInViaUI } from "./helpers/auth-flow";

// ─── Fixed test data ──────────────────────────────────────────────────────────

const P1 = { email: "p1@test.com", password: "password123", username: "p1skater" };
const P2 = { email: "p2@test.com", password: "password123", username: "p2skater" };

/**
 * Enable the fake camera/MediaRecorder for the given page.
 * Must be called before `page.goto()`.
 */
async function mockMedia(page: Page) {
  await page.addInitScript(MEDIA_MOCK_SCRIPT);
}

/**
 * Complete a VideoRecorder interaction:
 *  1. Click "Open Camera" (if shown — not shown when autoOpen=true)
 *  2. Click "Record — {label}"
 *  3. Wait briefly, then click "Stop Recording"
 *  4. Wait for the "done" state to indicate the blob was captured
 */
async function recordVideo(page: Page, recordLabel: string, doneLabel = "Recorded") {
  // For matchers (autoOpen=false) the "Open Camera" button must be clicked.
  // For setters (autoOpen=true) the camera opens automatically — the button
  // is absent or disappears very quickly.  We use a generous 5 s timeout so
  // CI latency doesn't cause the check to time-out and skip the click.
  const openBtn = page.getByRole("button", { name: /Open Camera/i });
  if (await openBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await openBtn.click();
  }

  await page.getByRole("button", { name: new RegExp(`Record.*${recordLabel}`, "i") }).click();
  // Let the fake recording "run" for 200 ms before stopping
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Stop Recording" }).click();

  // Wait for the "done" indicator
  await expect(page.getByText(doneLabel, { exact: false })).toBeVisible({ timeout: 5_000 });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

test.beforeEach(async () => {
  await clearAll();
});

// ─── Challenge ────────────────────────────────────────────────────────────────

test("player 1 challenges player 2 → waiting screen shown", async ({ browser }) => {
  // Set up P2 programmatically (no need to go through the UI)
  const p2 = await createUser(P2.email, P2.password);
  await createProfile(p2.uid, P2.username, P2.email, false);

  // P1 signs up through the UI and verifies their email
  const p1Ctx: BrowserContext = await browser.newContext();
  const p1: Page = await p1Ctx.newPage();
  await signUpAndSetupProfile(p1, P1.email, P1.password, P1.username);
  await verifyEmail(P1.email);
  await p1.reload();
  await forceTokenRefresh(p1);

  // Challenge P2
  await p1.getByRole("button", { name: "Challenge Someone" }).click();
  await expect(p1.getByRole("heading", { name: "Challenge" })).toBeVisible();
  await p1.getByPlaceholder("their_handle").fill(P2.username);
  await p1.getByRole("button", { name: /Send Challenge/i }).click();

  // P1 set the challenge so now P1 is the setter — game is in "setting" phase
  // and it IS P1's turn, so P1 should see the setter UI, not the waiting screen
  await expect(p1.getByText("Name your trick", { exact: false })).toBeVisible({ timeout: 10_000 });

  await p1Ctx.close();
});

// ─── Set trick ────────────────────────────────────────────────────────────────

test("setter records trick → game moves to matching phase", async ({ browser }) => {
  const p2 = await createUser(P2.email, P2.password);
  await createProfile(p2.uid, P2.username, P2.email, false);

  const p1Ctx: BrowserContext = await browser.newContext();
  const p1: Page = await p1Ctx.newPage();
  await mockMedia(p1);
  await signUpAndSetupProfile(p1, P1.email, P1.password, P1.username);
  await verifyEmail(P1.email);
  await p1.reload();
  await forceTokenRefresh(p1);

  // Challenge P2 to create a game
  await p1.getByRole("button", { name: "Challenge Someone" }).click();
  await p1.getByPlaceholder("their_handle").fill(P2.username);
  await p1.getByRole("button", { name: /Send Challenge/i }).click();

  // P1 is the setter — name the trick (this reveals the recorder)
  await expect(p1.getByText("Name your trick", { exact: false })).toBeVisible({ timeout: 10_000 });
  await p1.getByPlaceholder("Name your trick").fill("Kickflip");

  // The VideoRecorder should auto-open the camera
  await expect(p1.getByRole("button", { name: /Stop Recording|Record/i })).toBeVisible({
    timeout: 5_000,
  });

  // Record and stop
  await recordVideo(p1, "Land Your Trick", "Recorded");

  // After submitting the trick the game moves to "matching" phase —
  // P1 should see the waiting screen (it's now P2's turn to match)
  await expect(p1.getByText(/Waiting on @p2skater/i)).toBeVisible({ timeout: 15_000 });

  await p1Ctx.close();
});

// ─── Match trick (miss → earn a letter) ──────────────────────────────────────

test("matcher records response and misses → earns a letter", async ({ browser }) => {
  // Create both users
  const p2 = await createUser(P2.email, P2.password);
  await createProfile(p2.uid, P2.username, P2.email, false);

  // P1 flow: sign up, verify, challenge, set trick
  const p1Ctx: BrowserContext = await browser.newContext();
  const p1: Page = await p1Ctx.newPage();
  await mockMedia(p1);
  await signUpAndSetupProfile(p1, P1.email, P1.password, P1.username);
  await verifyEmail(P1.email);
  await p1.reload();
  await forceTokenRefresh(p1);

  await p1.getByRole("button", { name: "Challenge Someone" }).click();
  await p1.getByPlaceholder("their_handle").fill(P2.username);
  await p1.getByRole("button", { name: /Send Challenge/i }).click();

  await expect(p1.getByText("Name your trick", { exact: false })).toBeVisible({ timeout: 10_000 });
  await p1.getByPlaceholder("Name your trick").fill("Heelflip");
  await recordVideo(p1, "Land Your Trick", "Recorded");
  await expect(p1.getByText(/Waiting on @p2skater/i)).toBeVisible({ timeout: 15_000 });

  // Grab the game ID from the URL or wait — we need P2 to open this game.
  // P2 doesn't know the game ID yet, but their lobby will list it.
  const p2Ctx: BrowserContext = await browser.newContext();
  const p2Page: Page = await p2Ctx.newPage();
  await mockMedia(p2Page);
  await signInViaUI(p2Page, P2.email, P2.password);

  // P2's lobby should show the active game with P1 (card shows "vs @p1skater")
  await expect(p2Page.getByRole("button").filter({ hasText: P1.username })).toBeVisible({
    timeout: 10_000,
  });
  // Click the game card (it's the matcher's turn)
  await p2Page.getByRole("button").filter({ hasText: P1.username }).click();

  // P2 should see the matching UI
  await expect(p2Page.getByText(/Match @p1skater's Heelflip/i)).toBeVisible({ timeout: 10_000 });

  // Record the matching attempt
  await recordVideo(p2Page, "Match the Heelflip", "Recorded");

  // Submit as missed — P2 earns a letter
  await p2Page.getByRole("button", { name: "✗ Missed" }).click();

  // Wait for the result to save — P2 is now the setter for the next turn
  // (they missed so the original setter P1 stays as setter... actually no:
  //  if matcher misses, the setter stays the same setter → back to setting phase
  //  Actually from games.ts: if !landed, nextSetter = game.currentSetter (P1)
  //  so P2 should now see the waiting screen since it's P1's turn to set again)
  await expect(p2Page.getByText(/Waiting on @p1skater/i)).toBeVisible({ timeout: 15_000 });

  // Assert on P2's WaitingScreen — it renders <LetterDisplay> with a stable
  // testid. Previously this pointed at P1's Lobby, which uses inline <span>
  // loops (no testid) and would never resolve.
  await expect(p2Page.locator(`[data-testid="letter-display-${P2.username}"]`)).toHaveAttribute(
    "data-letter-count",
    "1",
    { timeout: 10_000 },
  );
  await expect(p2Page.locator(`[data-testid="letter-display-${P1.username}"]`)).toHaveAttribute(
    "data-letter-count",
    "0",
  );

  await p1Ctx.close();
  await p2Ctx.close();
});

// ─── Match trick (land → roles swap) ─────────────────────────────────────────

test("matcher records response and lands → roles swap, no letters earned", async ({ browser }) => {
  // Covers submitMatchAttempt(landed=true) honor-system path — the most
  // important game mechanic that was previously uncovered end-to-end.
  const p2 = await createUser(P2.email, P2.password);
  await createProfile(p2.uid, P2.username, P2.email, false);

  // P1 signs up, verifies, challenges P2, and sets a trick.
  const p1Ctx: BrowserContext = await browser.newContext();
  const p1: Page = await p1Ctx.newPage();
  await mockMedia(p1);
  await signUpAndSetupProfile(p1, P1.email, P1.password, P1.username);
  await verifyEmail(P1.email);
  await p1.reload();
  await forceTokenRefresh(p1);

  await p1.getByRole("button", { name: "Challenge Someone" }).click();
  await p1.getByPlaceholder("their_handle").fill(P2.username);
  await p1.getByRole("button", { name: /Send Challenge/i }).click();

  await expect(p1.getByText("Name your trick", { exact: false })).toBeVisible({ timeout: 10_000 });
  await p1.getByPlaceholder("Name your trick").fill("Ollie");
  await recordVideo(p1, "Land Your Trick", "Recorded");
  await expect(p1.getByText(/Waiting on @p2skater/i)).toBeVisible({ timeout: 15_000 });

  // P2 signs in, opens the game, records a match, and claims LANDED.
  const p2Ctx: BrowserContext = await browser.newContext();
  const p2Page: Page = await p2Ctx.newPage();
  await mockMedia(p2Page);
  await signInViaUI(p2Page, P2.email, P2.password);

  await p2Page.getByRole("button").filter({ hasText: P1.username }).click();
  await expect(p2Page.getByText(/Match @p1skater's Ollie/i)).toBeVisible({ timeout: 10_000 });

  await recordVideo(p2Page, "Match the Ollie", "Recorded");
  await p2Page.getByRole("button", { name: "✓ Landed" }).click();

  // Roles swap: P2 becomes the setter for turn 2 (GamePlayScreen remounts via
  // `key={game.turnNumber}` in App.tsx). P2 should see the fresh setter UI
  // with the trick-name input (NOT a stale matcher confirmation).
  await expect(p2Page.getByPlaceholder("Name your trick")).toBeVisible({ timeout: 15_000 });

  // No letters were earned on either side.
  await expect(p2Page.locator(`[data-testid="letter-display-${P1.username}"]`)).toHaveAttribute(
    "data-letter-count",
    "0",
  );
  await expect(p2Page.locator(`[data-testid="letter-display-${P2.username}"]`)).toHaveAttribute(
    "data-letter-count",
    "0",
  );

  // P1 reloads — still watching, but now waiting on P2 (who is the new setter).
  await p1.reload();
  await expect(p1.getByText(/Waiting on @p2skater/i)).toBeVisible({ timeout: 15_000 });

  await p1Ctx.close();
  await p2Ctx.close();
});

// ─── Timeout / forfeit ────────────────────────────────────────────────────────

test("expired turn deadline → forfeit screen shown to both players", async ({ browser }) => {
  // Create both users
  const p1 = await createUser(P1.email, P1.password);
  await createProfile(p1.uid, P1.username, P1.email, true);
  const p2 = await createUser(P2.email, P2.password);
  await createProfile(p2.uid, P2.username, P2.email, true);

  // Seed a game in "matching" phase where it's P2's turn (P2 has the deadline)
  const gameId = "timeout-game";
  await createGame(gameId, p1.uid, P1.username, p2.uid, P2.username, {
    phase: "matching",
    currentTurn: p2.uid,
    currentSetter: p1.uid,
    currentTrickName: "Kickflip",
    currentTrickVideoUrl: null, // no video needed for this test
  });
  // Expire the deadline so the forfeit check fires immediately
  await expireGameDeadline(gameId);

  // P2 signs in and opens the game — the forfeit check on mount should trigger
  const p2Ctx: BrowserContext = await browser.newContext();
  const p2Page: Page = await p2Ctx.newPage();
  await signInViaUI(p2Page, P2.email, P2.password);

  // Open the game from the lobby (card shows "vs @p1skater")
  await p2Page.getByRole("button").filter({ hasText: P1.username }).click();

  // The GamePlayScreen's useEffect fires forfeitExpiredTurn() which sets
  // status="forfeit" on the game.  The GameContext subscription then routes
  // both players to the GameOverScreen.
  await expect(p2Page.getByText("Forfeit")).toBeVisible({ timeout: 15_000 });
  await expect(p2Page.getByText("You ran out of time.")).toBeVisible();

  // P1 opens their app and should also see the forfeit result (they win)
  const p1Ctx: BrowserContext = await browser.newContext();
  const p1Page: Page = await p1Ctx.newPage();
  await signInViaUI(p1Page, P1.email, P1.password);
  await p1Page.getByRole("button").filter({ hasText: P2.username }).click();

  await expect(p1Page.getByText("You Win")).toBeVisible({ timeout: 10_000 });
  await expect(p1Page.getByText(/@p2skater ran out of time/i)).toBeVisible();

  await p1Ctx.close();
  await p2Ctx.close();
});

// ─── Full game → game over ────────────────────────────────────────────────────

test("completing a game shows game over screen with winner and rematch option", async ({ browser }) => {
  // Create both users
  const p1 = await createUser(P1.email, P1.password);
  await createProfile(p1.uid, P1.username, P1.email, true);
  const p2 = await createUser(P2.email, P2.password);
  await createProfile(p2.uid, P2.username, P2.email, true);

  // Seed a game where P2 already has 4 letters and it's the matching phase.
  // One more miss by P2 will end the game (P2 spells S.K.A.T.E. → P1 wins).
  const gameId = "near-over-game";
  await createGame(gameId, p1.uid, P1.username, p2.uid, P2.username, {
    phase: "matching",
    currentTurn: p2.uid,
    currentSetter: p1.uid,
    currentTrickName: "360 Flip",
    currentTrickVideoUrl: null,
    p2Letters: 4, // P2 is one miss away from losing
  });

  // P2 opens the game and submits a miss → should trigger game over
  const p2Ctx: BrowserContext = await browser.newContext();
  const p2Page: Page = await p2Ctx.newPage();
  await mockMedia(p2Page);
  await signInViaUI(p2Page, P2.email, P2.password);

  await p2Page.getByRole("button").filter({ hasText: P1.username }).click();
  await expect(p2Page.getByText(/Match @p1skater's 360 Flip/i)).toBeVisible({ timeout: 10_000 });

  await recordVideo(p2Page, "Match the 360 Flip", "Recorded");
  await p2Page.getByRole("button", { name: "✗ Missed" }).click();

  // P2 spells S.K.A.T.E → P2 loses
  await expect(p2Page.getByText("S.K.A.T.E.")).toBeVisible({ timeout: 15_000 });
  await expect(p2Page.getByRole("button", { name: /Back to Lobby/i })).toBeVisible();

  // P1 signs in and sees "You Win"
  const p1Ctx: BrowserContext = await browser.newContext();
  const p1Page: Page = await p1Ctx.newPage();
  await signInViaUI(p1Page, P1.email, P1.password);
  await p1Page.getByRole("button").filter({ hasText: P2.username }).click();
  await expect(p1Page.getByText("You Win")).toBeVisible({ timeout: 10_000 });
  await expect(p1Page.getByRole("button", { name: /Rematch/i })).toBeVisible();

  await p1Ctx.close();
  await p2Ctx.close();
});

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
  expireGameDeadline,
} from "./helpers/emulator";
import { signInViaUI } from "./helpers/auth-flow";
import { openMatcherSession, openSetterSession } from "./helpers/game-flow";
import { openFinishedGameFromLobby } from "./helpers/lobby-nav";

// ─── Fixed test data ──────────────────────────────────────────────────────────

const P1 = { email: "p1@test.com", password: "password123", username: "p1skater" };
const P2 = { email: "p2@test.com", password: "password123", username: "p2skater" };

/**
 * Complete a VideoRecorder interaction:
 *  1. Click "Open Camera" (if shown — not shown when autoOpen=true)
 *  2. Click "Record — {label}"
 *  3. Wait briefly, then click "Stop Recording"
 *  4. Wait for the "done" state to indicate the blob was captured
 */
async function recordVideo(page: Page, recordLabel: string) {
  // The camera is opened by tap on every path now: VideoRecorder only calls
  // getUserMedia unprompted when camera AND mic are already granted, which
  // headless Chromium never is. The 5 s probe covers the case where a build
  // does auto-open (the button then never appears) without failing here.
  const openBtn = page.getByRole("button", { name: /Open Camera/i });
  if (await openBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await openBtn.click();
  }

  await page.getByRole("button", { name: new RegExp(`Record.*${recordLabel}`, "i") }).click();
  // Let the fake recording "run" for 200 ms before stopping
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Stop Recording" }).click();

  // Wait for the "done" chip. Matched exactly: a matcher whose setter left no
  // clip is told "No video recorded — just match the trick!", which a loose
  // "Recorded" substring also hits.
  await expect(page.getByText("✓ Recorded", { exact: true })).toBeVisible({ timeout: 5_000 });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

test.beforeEach(async () => {
  await clearAll();
});

// ─── Challenge ────────────────────────────────────────────────────────────────

test("player 1 challenges player 2 → waiting screen shown", async ({ browser }) => {
  // P2 is seeded via the emulator REST API; P1 signs up through the UI,
  // verifies their email, and challenges P2.
  const { ctx: p1Ctx, page: p1 } = await openSetterSession(browser, P1, P2);

  // P1 set the challenge so now P1 is the setter — game is in "setting" phase
  // and it IS P1's turn, so P1 should see the setter UI, not the waiting screen
  await expect(p1.getByPlaceholder("Name your trick")).toBeVisible({ timeout: 10_000 });

  await p1Ctx.close();
});

// ─── Set trick ────────────────────────────────────────────────────────────────

test("setter records trick → game moves to matching phase", async ({ browser }) => {
  // Seed P2, then sign up + verify + challenge as P1, landing on the setter's
  // trick-name step with the fake camera installed.
  const { ctx: p1Ctx, page: p1 } = await openSetterSession(browser, P1, P2);

  // P1 is the setter — name the trick (this reveals the recorder)
  await p1.getByPlaceholder("Name your trick").fill("Kickflip");

  // The recorder mounts with its camera control. It no longer auto-opens the
  // stream: VideoRecorder only calls getUserMedia unprompted when camera AND
  // mic are already granted, and headless Chromium grants neither, so the
  // setter gets the same "Open Camera" tap a first-time user gets.
  await expect(p1.getByRole("button", { name: "Open Camera" })).toBeVisible({
    timeout: 5_000,
  });

  // Record and stop
  await recordVideo(p1, "Land Your Trick");
  // Recording alone doesn't set the trick — the setter still has to answer
  // "Did you land it?", which is what runs submitSetterTrick() (upload +
  // setTrick) and advances the phase.
  await p1.getByRole("button", { name: "✓ Landed" }).click();

  // After submitting the trick the game moves to "matching" phase —
  // P1 should see the waiting screen (it's now P2's turn to match)
  await expect(p1.getByText(/Waiting on @p2skater/i)).toBeVisible({ timeout: 15_000 });

  await p1Ctx.close();
});

// ─── Match trick (miss → earn a letter) ──────────────────────────────────────

test("matcher records response and misses → earns a letter", async ({ browser }) => {
  // Create both users
  // P1 flow: seed P2, sign up, verify, challenge, set trick
  const { ctx: p1Ctx, page: p1 } = await openSetterSession(browser, P1, P2);

  await p1.getByPlaceholder("Name your trick").fill("Heelflip");
  await recordVideo(p1, "Land Your Trick");
  // Recording alone doesn't set the trick — the setter still has to answer
  // "Did you land it?", which is what runs submitSetterTrick() (upload +
  // setTrick) and advances the phase.
  await p1.getByRole("button", { name: "✓ Landed" }).click();
  await expect(p1.getByText(/Waiting on @p2skater/i)).toBeVisible({ timeout: 15_000 });

  // P2 doesn't know the game ID — they find the game on their own lobby,
  // where it sits in the "YOUR TURN" stack (card reads "vs @p1skater").
  const { ctx: p2Ctx, page: p2Page } = await openMatcherSession(browser, P2, P1.username);

  // P2 should see the matching UI
  await expect(p2Page.getByText(/Match @p1skater's Heelflip/i)).toBeVisible({ timeout: 10_000 });

  // Record the matching attempt
  await recordVideo(p2Page, "Match the Heelflip");

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
  // P1 seeds P2, signs up, verifies, challenges P2, and sets a trick.
  const { ctx: p1Ctx, page: p1 } = await openSetterSession(browser, P1, P2);

  await p1.getByPlaceholder("Name your trick").fill("Ollie");
  await recordVideo(p1, "Land Your Trick");
  // Recording alone doesn't set the trick — the setter still has to answer
  // "Did you land it?", which is what runs submitSetterTrick() (upload +
  // setTrick) and advances the phase.
  await p1.getByRole("button", { name: "✓ Landed" }).click();
  await expect(p1.getByText(/Waiting on @p2skater/i)).toBeVisible({ timeout: 15_000 });

  // P2 signs in, opens the game, records a match, and claims LANDED.
  const { ctx: p2Ctx, page: p2Page } = await openMatcherSession(browser, P2, P1.username);
  await expect(p2Page.getByText(/Match @p1skater's Ollie/i)).toBeVisible({ timeout: 10_000 });

  await recordVideo(p2Page, "Match the Ollie");
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

  // P2 signs in — GameContext sweeps the expired deadline straight off the
  // games snapshot, so the game is already resolved as a forfeit before P2
  // can act on it and sits in the finished roll-up rather than the turn
  // stack. Open the recap from P2's own profile.
  const p2Ctx: BrowserContext = await browser.newContext();
  const p2Page: Page = await p2Ctx.newPage();
  await signInViaUI(p2Page, P2.email, P2.password);
  await openFinishedGameFromLobby(p2Page, P1.username);

  // forfeitExpiredTurn set status="forfeit" with P2 (who held the lapsed
  // turn) as the loser, so P2's recap is the loss view.
  await expect(p2Page.getByText("Forfeit")).toBeVisible({ timeout: 15_000 });
  await expect(p2Page.getByText("You ran out of time.")).toBeVisible();

  // P1 opens their app and should also see the forfeit result (they win)
  const p1Ctx: BrowserContext = await browser.newContext();
  const p1Page: Page = await p1Ctx.newPage();
  await signInViaUI(p1Page, P1.email, P1.password);
  // P2 already forfeited, so for P1 this game is FINISHED: it left the lobby
  // stack for the "N finished · W–L" roll-up, and the recap is reached from
  // P1's own profile.
  await openFinishedGameFromLobby(p1Page, P2.username);

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
  const { ctx: p2Ctx, page: p2Page } = await openMatcherSession(browser, P2, P1.username);
  await expect(p2Page.getByText(/Match @p1skater's 360 Flip/i)).toBeVisible({ timeout: 10_000 });

  await recordVideo(p2Page, "Match the 360 Flip");
  await p2Page.getByRole("button", { name: "✗ Missed" }).click();

  // P2 spells S.K.A.T.E → P2 loses
  await expect(p2Page.getByText("S.K.A.T.E.")).toBeVisible({ timeout: 15_000 });
  await expect(p2Page.getByRole("button", { name: /Back to Lobby/i })).toBeVisible();

  // P1 signs in and sees "You Win"
  const p1Ctx: BrowserContext = await browser.newContext();
  const p1Page: Page = await p1Ctx.newPage();
  await signInViaUI(p1Page, P1.email, P1.password);
  // The game is over, so it's in the finished roll-up rather than the lobby
  // stack — open the recap from P1's own profile.
  await openFinishedGameFromLobby(p1Page, P2.username);
  await expect(p1Page.getByText("You Win")).toBeVisible({ timeout: 10_000 });
  await expect(p1Page.getByRole("button", { name: /Rematch/i })).toBeVisible();

  await p1Ctx.close();
  await p2Ctx.close();
});

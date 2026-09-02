/**
 * E2E tests for the full game flow:
 *   challenge → set trick → match trick (miss/land) → timeout → game over
 *
 * Two-player tests use two browser contexts (p1Ctx / p2Ctx) so each player has
 * an independent auth session — the same way real users play on separate devices.
 *
 * Player 2 is created programmatically via the emulator REST API (faster than a
 * second UI sign-up) and their profile is seeded directly into Firestore.
 *
 * Session setup (context + media mock + browser-error relay + sign-in + how to
 * reach the game from the redesigned lobby) lives in helpers/game-flow.ts and
 * helpers/lobby-nav.ts. The lobby no longer has a "Challenge Someone" button
 * (challenging starts from the bottom nav's Challenge tab) and no longer lists
 * finished games as cards (they collapse into a "N finished · W–L" roll-up that
 * opens the viewer's own profile), so both routes are helper-owned.
 */

import { test, expect, type Page } from "@playwright/test";
import { clearAll, createUser, createProfile, createGame, expireGameDeadline } from "./helpers/emulator";
import { openMatcherSession, openPlayerSession, openSetterSession } from "./helpers/game-flow";
import { openFinishedGameFromLobby } from "./helpers/lobby-nav";

// ─── Fixed test data ──────────────────────────────────────────────────────────

const P1 = { email: "p1@test.com", password: "password123", username: "p1skater" };
const P2 = { email: "p2@test.com", password: "password123", username: "p2skater" };

/**
 * Complete a VideoRecorder interaction:
 *  1. Click "Open Camera" (always required — the stream needs a gesture)
 *  2. Click "Record — {label}"
 *  3. Wait briefly, then click "Stop Recording"
 *  4. Wait for the "done" state to indicate the blob was captured
 */
async function recordVideo(page: Page, recordLabel: string, doneLabel = "Recorded") {
  // The camera does NOT auto-open for anyone. The recorder only acquires a
  // stream inside a user gesture (see useMediaRecorder), so "Open Camera" has
  // to be tapped — by the setter as much as the matcher. This helper used to
  // treat the tap as optional-for-setters, which is why every recording spec
  // then failed at the Record button that the tap is what reveals.
  //
  // The click is bounded: unbounded, it sat in Playwright's actionability
  // retry loop and burned the whole 30 s test budget, reporting "Test ended"
  // against this line instead of anything diagnostic.
  const openBtn = page.getByRole("button", { name: /Open Camera/i });
  await expect(openBtn).toBeVisible({ timeout: 5_000 });
  await openBtn.click({ timeout: 5_000 });

  await page.getByRole("button", { name: new RegExp(`Record.*${recordLabel}`, "i") }).click();
  // Let the fake recording "run" for 200 ms before stopping
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Stop Recording" }).click();

  // Wait for the "done" indicator. The ✓ prefix is load-bearing:
  // getByText matches case-insensitive substrings, so a bare "Recorded"
  // also matches the matcher screen's "No video recorded — just match the
  // trick!" copy and dies as a strict-mode violation whenever both render.
  await expect(page.getByText(`✓ ${doneLabel}`)).toBeVisible({ timeout: 5_000 });
}

/**
 * Confirm the recorded set trick as landed. Recording alone submits nothing:
 * the decision panel ("Did you land it?") appears after the take, and the
 * "✓ Landed" click is what triggers submitSetterTrick() → uploadVideo() →
 * setTrick(). These specs predate that panel — the setter used to
 * auto-submit — and clip-upload.spec's own comment has flagged the omission
 * ("the click game.spec.ts omits") for as long as the panel has existed.
 */
async function setterConfirmsLanded(page: Page) {
  await expect(page.getByRole("group", { name: "Did you land the trick?" })).toBeVisible({ timeout: 5_000 });
  // Wait out the turn-action rate limit before submitting. firestore.rules
  // rejects a game update within 2 s of the doc's updatedAt (anti-flood), and
  // Playwright gets from "Send Challenge" (which stamps updatedAt) to this
  // click in ~1.8 s — faster than any human, so setTrick came back
  // permission-denied on exactly the writes a real player would land.
  await page.waitForTimeout(2_100);
  await page.getByRole("button", { name: "✓ Landed" }).click();
}

/**
 * P1's half of a two-player game, from the setter's trick-name step: name
 * `trickName`, record the take, confirm it landed, and wait for the turn to
 * hand over. Shared by the matcher specs, which then differ only in what P2
 * does with the trick.
 */
async function setterSetsTrick(p1: Page, trickName: string) {
  await p1.getByPlaceholder("Name your trick").fill(trickName);
  await recordVideo(p1, "Land Your Trick", "Recorded");
  await setterConfirmsLanded(p1);
  await expect(p1.getByText(/Waiting on @p2skater/i)).toBeVisible({ timeout: 15_000 });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

test.beforeEach(async () => {
  await clearAll();
});

// ─── Challenge ────────────────────────────────────────────────────────────────

test("player 1 challenges player 2 → waiting screen shown", async ({ browser }) => {
  // Seeds P2 via the REST API, signs P1 up through the UI, verifies their
  // email, then challenges P2 from the bottom nav's Challenge tab (the lobby
  // has no challenge button any more) — asserting the ChallengeScreen heading
  // on the way through.
  const { ctx: p1Ctx, page: p1 } = await openSetterSession(browser, P1, P2);

  // P1 set the challenge so now P1 is the setter — game is in "setting" phase
  // and it IS P1's turn, so P1 should see the setter UI, not the waiting screen
  await expect(p1.getByPlaceholder("Name your trick")).toBeVisible({ timeout: 10_000 });

  await p1Ctx.close();
});

// ─── Set trick ────────────────────────────────────────────────────────────────

test("setter records trick → game moves to matching phase", async ({ browser }) => {
  const { ctx: p1Ctx, page: p1 } = await openSetterSession(browser, P1, P2);

  // P1 is the setter — name the trick (this reveals the recorder)
  await p1.getByPlaceholder("Name your trick").fill("Kickflip");

  // The VideoRecorder is revealed by the trick name, showing its "Open Camera"
  // affordance — it does not auto-open. recordVideo() does the tapping.
  await expect(p1.getByRole("button", { name: /Open Camera/i })).toBeVisible({
    timeout: 5_000,
  });

  // Record and stop
  await recordVideo(p1, "Land Your Trick", "Recorded");
  await setterConfirmsLanded(p1);

  // After submitting the trick the game moves to "matching" phase —
  // P1 should see the waiting screen (it's now P2's turn to match)
  await expect(p1.getByText(/Waiting on @p2skater/i)).toBeVisible({ timeout: 15_000 });

  await p1Ctx.close();
});

// ─── Match trick (miss → earn a letter) ──────────────────────────────────────

test("matcher records response and misses → earns a letter", async ({ browser }) => {
  // P1 flow: seed P2, sign up, verify, challenge, set trick
  const { ctx: p1Ctx, page: p1 } = await openSetterSession(browser, P1, P2);
  await setterSetsTrick(p1, "Heelflip");

  // P2 doesn't know the game ID — they find it on their own lobby, where it
  // sits in the "YOUR TURN" stack (card reads "vs @p1skater"), and open it.
  const { ctx: p2Ctx, page: p2Page } = await openMatcherSession(browser, P2, P1.username);

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

test("matcher lands → setter accepts the claim → roles swap, no letters earned", async ({ browser }) => {
  // Covers submitMatchAttempt(landed=true) honor-system path — the most
  // important game mechanic that was previously uncovered end-to-end.
  //
  // A landed claim is NOT self-certifying any more. submitMatchAttempt
  // freezes the game into phase "pendingReview" and the SETTER gets a 24 h
  // accept/dispute window (docs/DISPUTE_BINDING_DESIGN.md §3.3); the role
  // swap, the clips, and the result notification are all deferred to
  // acceptLanded. This test used to expect the pre-redesign behaviour — an
  // immediate swap — and waited for a setter UI that deliberately never
  // comes.
  // P1 seeds P2, signs up, verifies, challenges P2, and sets a trick.
  const { ctx: p1Ctx, page: p1 } = await openSetterSession(browser, P1, P2);
  await setterSetsTrick(p1, "Ollie");

  // P2 signs in, opens the game from their lobby, records a match, and claims
  // LANDED.
  const { ctx: p2Ctx, page: p2Page } = await openMatcherSession(browser, P2, P1.username);
  await expect(p2Page.getByText(/Match @p1skater's Ollie/i)).toBeVisible({ timeout: 10_000 });

  await recordVideo(p2Page, "Match the Ollie", "Recorded");
  await p2Page.getByRole("button", { name: "✓ Landed" }).click();

  // The claim freezes the game into pendingReview: P2 waits on P1's call.
  await expect(p2Page.getByText(/Waiting for @p1skater to accept or dispute/i)).toBeVisible({
    timeout: 15_000,
  });

  // P1's screen offers the accept/dispute window; P1 accepts the claim.
  await expect(p1.getByRole("group", { name: "Accept the landed claim or dispute it" })).toBeVisible({
    timeout: 15_000,
  });
  // Same 2 s turn-action cooldown as the setter path: P2's claim stamped
  // updatedAt moments ago, P1's panel appears via the live snapshot almost
  // instantly, and an immediate Accept is permission-denied (observed 0.45 s
  // after the claim in CI).
  await p1.waitForTimeout(2_100);
  await p1.getByRole("button", { name: "Accept", exact: true }).click();

  // NOW the roles swap: P2 becomes the setter for turn 2 (GamePlayScreen
  // remounts via `key={game.turnNumber}` in App.tsx) and sees the fresh
  // setter UI with the trick-name input.
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

  // P1 — still watching — is now waiting on P2 (who is the new setter).
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

  // P2 signs in. `GameContext.sweepExpiredTurns` runs against the games
  // snapshot as soon as the lobby subscribes, so `forfeitExpiredTurn` fires
  // and the game is already resolved by the time the lobby paints — it never
  // appears as an actionable card. Finished games are not lobby cards any
  // more either, so the recap is reached through the "N finished · W–L"
  // roll-up on P2's own profile.
  const { ctx: p2Ctx, page: p2Page } = await openPlayerSession(browser, P2);
  await openFinishedGameFromLobby(p2Page, P1.username);

  await expect(p2Page.getByText("Forfeit")).toBeVisible({ timeout: 15_000 });
  await expect(p2Page.getByText("You ran out of time.")).toBeVisible();

  // P1 opens their app and should also see the forfeit result (they win)
  const { ctx: p1Ctx, page: p1Page } = await openPlayerSession(browser, P1);
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

  // P2 opens the game from the "YOUR TURN" stack and submits a miss → should
  // trigger game over
  const { ctx: p2Ctx, page: p2Page } = await openMatcherSession(browser, P2, P1.username);
  await expect(p2Page.getByText(/Match @p1skater's 360 Flip/i)).toBeVisible({ timeout: 10_000 });

  await recordVideo(p2Page, "Match the 360 Flip", "Recorded");
  await p2Page.getByRole("button", { name: "✗ Missed" }).click();

  // P2 spells S.K.A.T.E → P2 loses
  await expect(p2Page.getByText("S.K.A.T.E.")).toBeVisible({ timeout: 15_000 });
  await expect(p2Page.getByRole("button", { name: /Back to Lobby/i })).toBeVisible();

  // P1 signs in and sees "You Win". The game is finished, so it is no longer
  // a lobby card — it is reached through the finished roll-up on P1's profile.
  const { ctx: p1Ctx, page: p1Page } = await openPlayerSession(browser, P1);
  await openFinishedGameFromLobby(p1Page, P2.username);
  await expect(p1Page.getByText("You Win")).toBeVisible({ timeout: 10_000 });
  await expect(p1Page.getByRole("button", { name: /Rematch/i })).toBeVisible();

  await p1Ctx.close();
  await p2Ctx.close();
});

/**
 * E2E for the refereed dispute / "Call BS" flows (GAME_STATE_MACHINE.md
 * §setReview / §disputable).
 *
 * Honor-system games are already covered by game.spec.ts (matcher self-reports
 * landed/missed). This spec covers the THIRD-PARTY JUDGE paths that only exist
 * when a nominated referee has accepted: a player calls BS / claims landed, the
 * game routes to the judge, and the judge's ruling drives the next transition.
 *
 * Each game is seeded directly with an accepted judge via `seedJudgeRefGame`
 * (emulator REST), so the specs start in the exact phase under test without
 * driving the full set→match preamble through the UI. The judge and players
 * are signed in across separate browser contexts — mirroring real play on
 * three devices.
 *
 * Assertions hit BOTH layers: the authoritative Firestore state (phase, turn,
 * letters — read back via `getGameState`/`waitForGameState`) AND the rendered
 * UI each party lands on. The state read pins the state-machine contract; the
 * UI assertion proves the player actually sees the correct next screen.
 *
 * Scope note: the disputable (landed-claim) rulings are exercised end-to-end
 * through the judge's button tap. The Call-BS path is covered up to the judge's
 * review surface — the setReview ruling commit (game-update + notification in
 * one transaction) currently trips Firestore's rules node-evaluation budget in
 * the emulator and is filed as a rules-side finding (see the agent report).
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { clearAll, getGameState, waitForGameState } from "./helpers/emulator";
import { seedJudgeRefGame } from "./helpers/game-flow";
import { signInViaUI } from "./helpers/auth-flow";

const SETTER = { email: "setter@test.com", password: "password123", username: "settersam" };
const MATCHER = { email: "matcher@test.com", password: "password123", username: "matchermo" };
const JUDGE = { email: "judge@test.com", password: "password123", username: "reflee" };

test.beforeEach(async () => {
  await clearAll();
});

/** Open the seeded game from a player's lobby (card reads "vs @opponent"). */
async function openGameAsPlayer(page: Page, opponentUsername: string): Promise<void> {
  await page
    .getByRole("button")
    .filter({ hasText: new RegExp(`vs @${opponentUsername}`, "i") })
    .first()
    .click();
}

/** Open the seeded game from the judge's lobby (card reads "REF @p1 vs @p2"). */
async function openGameAsJudge(page: Page, anyPlayerUsername: string): Promise<void> {
  await page
    .getByRole("button")
    .filter({ hasText: new RegExp(`@${anyPlayerUsername}`, "i") })
    .first()
    .click();
}

// ─── Call BS → judge rules "Sketchy" → setter re-sets ──────────────────────────

test("matcher calls BS on the set → game routes to the judge's Call-BS review", async ({ browser }) => {
  // Two sequential UI sign-ins (matcher, judge) across separate contexts —
  // past the 30s default, so bump the budget like game.spec.ts's multi-context
  // tests.
  test.setTimeout(90_000);

  // Matching phase with an active judge: the matcher can attempt OR call BS on
  // the set. A null set video keeps the seed simple — the Call-BS button
  // renders whenever a judge is active, regardless of whether a video exists.
  const gameId = "callbs-review-game";
  const { setterUid, judgeUid } = await seedJudgeRefGame(gameId, SETTER, MATCHER, JUDGE, {
    phase: "matching",
    turnHolder: "matcher",
    fields: { currentTrickName: "Kickflip", currentTrickVideoUrl: null },
  });

  // Matcher opens the game and calls BS — phase routes to the judge (setReview).
  const matcherCtx: BrowserContext = await browser.newContext();
  const matcherPage: Page = await matcherCtx.newPage();
  await signInViaUI(matcherPage, MATCHER.email, MATCHER.password);
  await openGameAsPlayer(matcherPage, SETTER.username);

  // Target by accessible name: the component passes data-testid="call-bs-button"
  // to <Btn>, but Btn doesn't forward arbitrary DOM props, so the test id never
  // reaches the DOM — the visible label is the reliable contract here.
  await matcherPage.getByRole("button", { name: "Call BS on this trick" }).click();

  // The matcher's Call BS flips the game to setReview and parks the turn on the
  // judge — the authoritative state-machine transition from matching.
  const after = await waitForGameState(gameId, (s) => s.phase === "setReview");
  expect(after.currentTurn).toBe(judgeUid);
  expect(after.currentSetter).toBe(setterUid);
  expect(after.p1Letters).toBe(0);
  expect(after.p2Letters).toBe(0);

  // The judge opens the game and sees the Call-BS review surface with both
  // ruling options — proving the dispute routed to the third party, not back
  // to a player.
  const judgeCtx: BrowserContext = await browser.newContext();
  const judgePage: Page = await judgeCtx.newPage();
  await signInViaUI(judgePage, JUDGE.email, JUDGE.password);
  await openGameAsJudge(judgePage, MATCHER.username);

  await expect(judgePage.getByText("CALL BS REVIEW")).toBeVisible({ timeout: 15_000 });
  await expect(judgePage.getByRole("button", { name: "Clean" })).toBeVisible();
  await expect(judgePage.getByRole("button", { name: "Sketchy" })).toBeVisible();

  await matcherCtx.close();
  await judgeCtx.close();
});

// ─── Disputable: judge accepts "landed" → roles swap ───────────────────────────

test("judge accepts the matcher's landed claim → roles swap, no letters", async ({ browser }) => {
  // Seed straight into the disputable phase: the matcher already claimed landed
  // and the game is parked on the judge. No videos so resolveDispute's clip
  // write (gated on a stored video URL) stays out of the path.
  const gameId = "dispute-accept-game";
  const { setterUid, matcherUid, judgeUid } = await seedJudgeRefGame(gameId, SETTER, MATCHER, JUDGE, {
    phase: "disputable",
    turnHolder: "judge",
    judgeReviewFor: "matcher",
    fields: { currentTrickName: "Tre Flip", currentTrickVideoUrl: null, matchVideoUrl: null },
  });

  const judgeCtx: BrowserContext = await browser.newContext();
  const judgePage: Page = await judgeCtx.newPage();
  await signInViaUI(judgePage, JUDGE.email, JUDGE.password);
  await openGameAsJudge(judgePage, SETTER.username);

  await expect(judgePage.getByText("REFEREE'S CALL")).toBeVisible({ timeout: 15_000 });
  await judgePage.getByRole("button", { name: "Landed" }).click();

  // Accept → roles swap: matcher becomes the new setter, no letters awarded.
  const after = await waitForGameState(gameId, (s) => s.phase === "setting" && s.currentSetter === matcherUid);
  expect(after.currentTurn).toBe(matcherUid);
  expect(after.p1Letters).toBe(0);
  expect(after.p2Letters).toBe(0);
  expect(after.currentSetter).not.toBe(setterUid);
  expect(after.winner).toBeNull();
  // Judges never play — the setter role must never land on the judge.
  expect(after.currentSetter).not.toBe(judgeUid);

  // The matcher (now setter) opens the game to the fresh "Name your trick" step.
  const matcherCtx: BrowserContext = await browser.newContext();
  const matcherPage: Page = await matcherCtx.newPage();
  await signInViaUI(matcherPage, MATCHER.email, MATCHER.password);
  await openGameAsPlayer(matcherPage, SETTER.username);
  await expect(matcherPage.getByText("Name your trick", { exact: false })).toBeVisible({ timeout: 15_000 });

  await judgeCtx.close();
  await matcherCtx.close();
});

// ─── Disputable: judge rejects "landed" → matcher gets a letter ────────────────

test("judge overrules the landed claim → matcher takes a letter, setter keeps setting", async ({ browser }) => {
  // player2 (the matcher) starts with no letters; an overrule pushes them to 1.
  const gameId = "dispute-reject-game";
  const { setterUid, matcherUid } = await seedJudgeRefGame(gameId, SETTER, MATCHER, JUDGE, {
    phase: "disputable",
    turnHolder: "judge",
    judgeReviewFor: "matcher",
    fields: { currentTrickName: "Nollie Heel", currentTrickVideoUrl: null, matchVideoUrl: null },
  });
  const before = await getGameState(gameId);
  expect(before.p2Letters).toBe(0);

  const judgeCtx: BrowserContext = await browser.newContext();
  const judgePage: Page = await judgeCtx.newPage();
  await signInViaUI(judgePage, JUDGE.email, JUDGE.password);
  await openGameAsJudge(judgePage, MATCHER.username);

  await expect(judgePage.getByText("REFEREE'S CALL")).toBeVisible({ timeout: 15_000 });
  await judgePage.getByRole("button", { name: "Missed" }).click();

  // Overrule → matcher (player2) +1 letter; setter keeps the role, no game over.
  const after = await waitForGameState(gameId, (s) => s.p2Letters === 1);
  expect(after.phase).toBe("setting");
  expect(after.currentSetter).toBe(setterUid);
  expect(after.currentTurn).toBe(setterUid);
  expect(after.p1Letters).toBe(0);
  expect(after.status).toBe("active");
  expect(after.winner).toBeNull();
  // The matcher is a distinct player from the setter — guards a same-uid seed bug.
  expect(matcherUid).not.toBe(setterUid);

  // The matcher opens the game and sees their letter count bumped to 1 on the
  // waiting screen's LetterDisplay (stable testid, same probe as game.spec.ts).
  const matcherCtx: BrowserContext = await browser.newContext();
  const matcherPage: Page = await matcherCtx.newPage();
  await signInViaUI(matcherPage, MATCHER.email, MATCHER.password);
  await openGameAsPlayer(matcherPage, SETTER.username);
  await expect(matcherPage.locator(`[data-testid="letter-display-${MATCHER.username}"]`)).toHaveAttribute(
    "data-letter-count",
    "1",
    { timeout: 15_000 },
  );

  await judgeCtx.close();
  await matcherCtx.close();
});

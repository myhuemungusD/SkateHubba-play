/**
 * E2E for the auto-forfeit on turn-deadline expiry (audit F8).
 *
 * `forfeitExpiredTurn` (src/services/games.turns.ts) is invoked from the
 * GamePlayScreen mount effect whenever the active player opens a game with
 * a past `turnDeadline`. The transaction sets `status: "forfeit"` and the
 * opponent becomes the winner; the GameContext subscription then routes
 * both players to the GameOverScreen.
 *
 * Existing game.spec.ts covers the matching-phase forfeit (matcher misses
 * the deadline). This spec covers the setting-phase forfeit — the path
 * exercised when the setter abandons a game after sending the challenge.
 *
 * Time advancement uses the emulator REST helper `expireGameDeadline`
 * (back-dates `turnDeadline`) rather than real wall-clock waits or
 * Playwright's clock API, matching the convention from game.spec.ts.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { clearAll, createUser, createProfile, createGame, expireGameDeadline } from "./helpers/emulator";
import { signInViaUI } from "./helpers/auth-flow";

const P1 = { email: "p1@test.com", password: "password123", username: "settercat" };
const P2 = { email: "p2@test.com", password: "password123", username: "matcherdog" };

test.beforeEach(async () => {
  await clearAll();
});

test("setter's deadline passes → setter forfeits and matcher wins on game-over screen", async ({ browser }) => {
  // Both users seeded directly — we only need UI sign-in below.
  const p1 = await createUser(P1.email, P1.password);
  await createProfile(p1.uid, P1.username, P1.email, true);
  const p2 = await createUser(P2.email, P2.password);
  await createProfile(p2.uid, P2.username, P2.email, true);

  // Seed a game in `setting` phase where P1 (the setter) holds the turn —
  // this is the state immediately after a challenge accept, before the
  // setter has recorded their trick.
  const gameId = "setting-forfeit-game";
  await createGame(gameId, p1.uid, P1.username, p2.uid, P2.username, {
    phase: "setting",
    currentTurn: p1.uid,
    currentSetter: p1.uid,
  });
  // Backdate the deadline so the forfeit fires the moment P1 mounts the screen.
  await expireGameDeadline(gameId);

  // P1 (the setter) opens the game and sees the forfeit-loss screen.
  const p1Ctx: BrowserContext = await browser.newContext();
  const p1Page: Page = await p1Ctx.newPage();
  await signInViaUI(p1Page, P1.email, P1.password);
  await p1Page
    .getByRole("button", { name: new RegExp(`vs @${P2.username}`, "i") })
    .first()
    .click();

  await expect(p1Page.getByText("Forfeit")).toBeVisible({ timeout: 15_000 });
  await expect(p1Page.getByText("You ran out of time.")).toBeVisible();

  // P2 opens the same game from their lobby and sees the winning view.
  const p2Ctx: BrowserContext = await browser.newContext();
  const p2Page: Page = await p2Ctx.newPage();
  await signInViaUI(p2Page, P2.email, P2.password);
  await p2Page
    .getByRole("button", { name: new RegExp(`vs @${P1.username}`, "i") })
    .first()
    .click();

  await expect(p2Page.getByText("You Win")).toBeVisible({ timeout: 15_000 });
  await expect(p2Page.getByText(new RegExp(`@${P1.username} ran out of time`, "i"))).toBeVisible();

  await p1Ctx.close();
  await p2Ctx.close();
});

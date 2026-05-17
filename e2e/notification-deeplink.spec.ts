/**
 * E2E for the push-notification deep-link bridge (audit F8).
 *
 * When a user taps a SkateHubba push notification, the service worker
 * `firebase-messaging-sw.js` posts `{ type: "OPEN_GAME", gameId }` into the
 * controlled tab. <GameNotificationWatcher> forwards that as a typed
 * `CustomEvent` on `window` (`skatehubba:open-game`), and the App.tsx
 * listener resolves it against `game.games` and calls `game.openGame`
 * (which navigates to `/game`).
 *
 * Per F8 guidance: dispatch the `skatehubba:open-game` event directly from
 * the page rather than driving an FCM payload through the service worker.
 * The listener under test consumes the CustomEvent unconditionally — any
 * upstream FCM behaviour is its own concern and covered by unit tests.
 */
import { test, expect } from "@playwright/test";
import { clearAll, createUser, createProfile, createGame } from "./helpers/emulator";
import { signUpAndSetupProfile } from "./helpers/auth-flow";

const RECIPIENT = { email: "deeplink@test.com", password: "password123", username: "deepuser" };
const CHALLENGER = { email: "challenger@test.com", password: "password123", username: "rivalfox" };

test.beforeEach(async () => {
  await clearAll();
});

test("dispatching skatehubba:open-game routes recipient into the referenced game", async ({ page }) => {
  // Seed the challenger so their game card has a real opponent username.
  const challenger = await createUser(CHALLENGER.email, CHALLENGER.password);
  await createProfile(challenger.uid, CHALLENGER.username, CHALLENGER.email, true);

  // Recipient signs up through the UI so we get a real auth session.
  await signUpAndSetupProfile(page, RECIPIENT.email, RECIPIENT.password, RECIPIENT.username);

  // Resolve the recipient's uid from the in-page Firebase auth handle so we
  // can pin them as `player2Uid` on the seeded game.
  const recipientUid = await page.evaluate(() => {
    type E2EAuth = { currentUser?: { uid?: string } };
    const auth = (globalThis as Record<string, E2EAuth | undefined>).__e2eFirebaseAuth;
    return auth?.currentUser?.uid ?? null;
  });
  expect(recipientUid).toBeTruthy();

  const gameId = "deeplink-target-game";
  await createGame(gameId, challenger.uid, CHALLENGER.username, recipientUid as string, RECIPIENT.username, {
    phase: "setting",
    currentTurn: challenger.uid,
    currentSetter: challenger.uid,
  });

  // Wait for the recipient's lobby to surface the game (the listener in
  // App.tsx only fires when `game.games.find(...)` resolves — so we must
  // wait for the games snapshot before dispatching).
  await expect(
    page.getByRole("button", { name: new RegExp(`vs @${CHALLENGER.username}`, "i") }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Dispatch the deep-link CustomEvent exactly as <GameNotificationWatcher>
  // would after the SW posts OPEN_GAME. The App.tsx listener calls
  // `game.openGame(found)` which sets the screen to "game" → URL "/game".
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent("skatehubba:open-game", { detail: { gameId: id } }));
  }, gameId);

  await page.waitForURL("**/game**", { timeout: 10_000 });
  // Sanity: the game-play screen is mounted (the setter prompt for the
  // opponent is "Waiting on @<challenger>", since it's their turn).
  await expect(page.getByText(new RegExp(`Waiting on @${CHALLENGER.username}`, "i"))).toBeVisible({
    timeout: 10_000,
  });
});

test("deep-link event for an unknown game id is a no-op (no navigation)", async ({ page }) => {
  // A stale push for a game the recipient is no longer party to must not
  // throw or yank them off the lobby. Covers the `if (found) game.openGame`
  // guard in App.tsx.
  await signUpAndSetupProfile(page, RECIPIENT.email, RECIPIENT.password, RECIPIENT.username);

  await expect(page.getByRole("heading", { name: "Your Games" })).toBeVisible({ timeout: 15_000 });
  const urlBefore = page.url();

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("skatehubba:open-game", { detail: { gameId: "no-such-game" } }));
  });

  // Give any micro-task / state flush a beat to settle, then re-check the URL.
  await expect(page.getByRole("heading", { name: "Your Games" })).toBeVisible();
  expect(page.url()).toBe(urlBefore);
});

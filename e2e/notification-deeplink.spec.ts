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
import { clearAll, createUser, createProfile, createGame, getSignedInUid } from "./helpers/emulator";
import { signInViaUI, signUpAndSetupProfile, waitForAuthForm } from "./helpers/auth-flow";
import { CONSENT_ANSWERED_SCRIPT } from "./helpers/consent";
import { expectOnLobby, revealActiveGameInLobby } from "./helpers/lobby-nav";

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
  const recipientUid = await getSignedInUid(page);

  const gameId = "deeplink-target-game";
  await createGame(gameId, challenger.uid, CHALLENGER.username, recipientUid, RECIPIENT.username, {
    phase: "setting",
    currentTurn: challenger.uid,
    currentSetter: challenger.uid,
  });

  // Wait for the recipient's lobby to surface the game (the listener in
  // App.tsx only fires when `game.games.find(...)` resolves — so we must
  // wait for the games snapshot before dispatching).
  // The challenger holds the turn, so the recipient's card lives behind the
  // collapsed "N waiting on them" disclosure — expand it to prove the game
  // reached this client's snapshot.
  await revealActiveGameInLobby(page, CHALLENGER.username);

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

test("deep-link event for an unknown game id stays on the lobby", async ({ page }) => {
  // A stale push for a game the recipient is no longer party to must not
  // throw or yank them off the lobby. useGameDeepLink reads the game, the
  // rules refuse it, and the user stays on (or is sent back to) the lobby.
  await signUpAndSetupProfile(page, RECIPIENT.email, RECIPIENT.password, RECIPIENT.username);

  await expectOnLobby(page);
  const urlBefore = page.url();

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("skatehubba:open-game", { detail: { gameId: "no-such-game" } }));
  });

  // Give any micro-task / state flush a beat to settle, then re-check the URL.
  await expectOnLobby(page);
  expect(page.url()).toBe(urlBefore);
});

/**
 * The web push tap target itself: https://skatehubba.com/?game=<id> opened as
 * a fresh page load (fcmOptions.link, click_action, or the service worker's
 * openWindow when no tab is open). It used to land on /lobby.
 */
async function seedGameFor(recipientUid: string, gameId: string): Promise<void> {
  const challenger = await createUser(CHALLENGER.email, CHALLENGER.password);
  await createProfile(challenger.uid, CHALLENGER.username, CHALLENGER.email, true);
  await createGame(gameId, challenger.uid, CHALLENGER.username, recipientUid, RECIPIENT.username, {
    phase: "setting",
    currentTurn: challenger.uid,
    currentSetter: challenger.uid,
  });
}

test("cold load of /?game=<id> opens that game and strips the param", async ({ page }) => {
  const recipient = await createUser(RECIPIENT.email, RECIPIENT.password);
  await createProfile(recipient.uid, RECIPIENT.username, RECIPIENT.email, true);
  const gameId = "pushTapColdLoad";
  await seedGameFor(recipient.uid, gameId);

  // Signed in (session persisted), then the tap opens a brand-new page load.
  await signInViaUI(page, RECIPIENT.email, RECIPIENT.password);
  await page.goto(`/?game=${gameId}`);

  await page.waitForURL((url) => url.pathname === "/game", { timeout: 15_000 });
  await expect(page.getByText(new RegExp(`Waiting on @${CHALLENGER.username}`, "i"))).toBeVisible({
    timeout: 10_000,
  });
  // Stripped: a refresh must not re-open it.
  expect(new URL(page.url()).searchParams.has("game")).toBe(false);
});

test("a signed-out /?game=<id> tap survives sign-in and then opens the game", async ({ page }) => {
  const recipient = await createUser(RECIPIENT.email, RECIPIENT.password);
  await createProfile(recipient.uid, RECIPIENT.username, RECIPIENT.email, true);
  const gameId = "pushTapSignedOut";
  await seedGameFor(recipient.uid, gameId);

  await page.addInitScript(CONSENT_ANSWERED_SCRIPT);
  await page.goto(`/?game=${gameId}`);
  // Parked and stripped before anything (the boot landing's buttons) can drop it.
  await expect.poll(() => new URL(page.url()).searchParams.has("game")).toBe(false);

  await page.getByRole("button", { name: "Account", exact: true }).click();
  await waitForAuthForm(page);
  await page.getByPlaceholder("you@email.com").fill(RECIPIENT.email);
  await page.getByPlaceholder("••••••••").fill(RECIPIENT.password);
  await page.getByRole("button", { name: "Sign In" }).click();

  await page.waitForURL((url) => url.pathname === "/game", { timeout: 15_000 });
  await expect(page.getByText(new RegExp(`Waiting on @${CHALLENGER.username}`, "i"))).toBeVisible({
    timeout: 10_000,
  });
});

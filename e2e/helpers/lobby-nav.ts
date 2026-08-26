/**
 * Lobby + bottom-nav UI helpers for Playwright e2e specs.
 *
 * The lobby redesign removed the two anchors nearly every spec leaned on:
 * the `<h1>Your Games</h1>` heading and the in-lobby "Challenge Someone"
 * button. What replaced them is structural rather than textual, so the
 * queries live here instead of being re-inlined per spec:
 *
 *  - "am I on the lobby?" is now the Home tab of the persistent bottom nav
 *    carrying `aria-current="page"`. The nav only renders once a profile is
 *    loaded (`App.tsx`: `{auth.activeProfile && <BottomNav />}`) and only
 *    claims `page` on the lobby screen, so it is exactly as strong a
 *    precondition as the old heading — the lobby's own headings ("YOUR
 *    TURN", "Ready to S.K.A.T.E.?") are content-dependent and therefore
 *    unusable as a generic "we got there" gate.
 *  - challenging starts from the Challenge tab, not from a lobby button.
 *  - active games waiting on the OPPONENT are not in the DOM until the
 *    "N waiting on them" disclosure is expanded.
 *  - finished games are no longer cards in the lobby at all; they collapse
 *    to a "N finished · W–L" roll-up that opens the viewer's own profile,
 *    where the game history card exposes "View Full Recap".
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** The persistent bottom tab bar (`aria-label="Primary navigation"`). */
function primaryNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Primary navigation" });
}

/**
 * Assert the viewer is on the lobby: the URL is /lobby AND the Home tab
 * reports itself as the current page. Both halves matter — the URL alone
 * would pass while the profile is still loading (no nav, no lobby).
 */
export async function expectOnLobby(page: Page, timeout = 15_000): Promise<void> {
  await expect(page).toHaveURL(/\/lobby/, { timeout });
  await expect(primaryNav(page).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page", {
    timeout,
  });
}

/**
 * The bottom nav's Challenge tab. Always enabled — the email-verification
 * gate lives on the /challenge route, not on this control.
 */
export function challengeTab(page: Page): Locator {
  return primaryNav(page).getByRole("link", { name: "Challenge" });
}

/**
 * Open the challenge form from the bottom nav's Challenge tab and wait for
 * the ChallengeScreen heading. Replaces the deleted lobby "Challenge
 * Someone" button.
 */
export async function openChallengeForm(page: Page): Promise<void> {
  await challengeTab(page).click();
  await expect(page.getByRole("heading", { name: "Challenge", exact: true })).toBeVisible({ timeout: 10_000 });
}

/**
 * Open the clips feed from the bottom nav's Clips tab. The lobby no longer
 * embeds <ClipsFeed> — it lives on its own /feed route.
 */
export async function openClipsFeed(page: Page): Promise<void> {
  await primaryNav(page).getByRole("link", { name: "Clips" }).click();
  await page.waitForURL("**/feed**", { timeout: 10_000 });
}

/** The lobby card for an active game against `opponentHandle` ("vs @handle"). */
function activeGameCard(page: Page, opponentHandle: string): Locator {
  return page.getByRole("button").filter({ hasText: `vs @${opponentHandle}` });
}

/**
 * Wait until an active game against `opponentHandle` is on screen, expanding
 * the "N waiting on them" disclosure if that is where it lives.
 *
 * Games awaiting the viewer sit in the "YOUR TURN" stack and render as soon
 * as the snapshot arrives; games awaiting the opponent are not in the DOM at
 * all until the collapsed disclosure is expanded. Waiting for whichever of
 * the two appears first covers both without a fixed sleep.
 *
 * Returns the card locator so callers can assert on it.
 */
export async function revealActiveGameInLobby(page: Page, opponentHandle: string): Promise<Locator> {
  const card = activeGameCard(page, opponentHandle);
  const disclosure = page.getByRole("button", { name: /waiting on them/ });

  await expect(card.or(disclosure).first()).toBeVisible({ timeout: 15_000 });
  if (!(await card.isVisible())) {
    await disclosure.click();
  }

  await expect(card).toBeVisible({ timeout: 10_000 });
  return card;
}

/** Open an active game from the lobby by opponent handle. */
export async function openActiveGameFromLobby(page: Page, opponentHandle: string): Promise<void> {
  const card = await revealActiveGameInLobby(page, opponentHandle);
  await card.click();
}

/**
 * Open a FINISHED game's recap from the lobby.
 *
 * Completed games left the lobby entirely: the "N finished · W–L" roll-up
 * opens the viewer's own profile (/me), whose game history card expands to
 * a "View Full Recap" action that routes to the game-over screen — the same
 * destination the old completed-game lobby card had.
 */
export async function openFinishedGameFromLobby(page: Page, opponentHandle: string): Promise<void> {
  await page.getByRole("button", { name: /finished ·/ }).click();
  await page.waitForURL("**/me**", { timeout: 10_000 });

  await page.getByRole("button").filter({ hasText: `vs @${opponentHandle}` }).click();
  await page.getByRole("button", { name: "View Full Recap" }).click();
}

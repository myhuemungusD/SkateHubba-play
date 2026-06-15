/**
 * E2E for the community clips feed embedded in the lobby (the <ClipsFeed>
 * spotlight surface).
 *
 * clip-voting.spec.ts already covers the upvote write + own-clip suppression.
 * This spec covers the two remaining critical-path behaviours the feed exists
 * for: (1) it loads and renders the seeded clip pool — author, trick name,
 * role badge, and the position pill — and (2) the viewer can page through the
 * pool with NEXT TRICK and tap into a clip's author to reach their profile.
 *
 * Clips are seeded via the emulator REST helper `createClip` with the same
 * deterministic id (`${gameId}_${turn}_${role}`) the production transaction
 * writes, and distinct `upvoteCount` values so the default "Top" sort
 * (upvoteCount desc) yields a stable order under test.
 *
 * The seeded video is a 4-byte data URL that never fires a real `ended` event,
 * so the spec dispatches `ended` on the <video> element to surface the
 * REPLAY / NEXT TRICK overlay — exercising the real `handleNext` index advance
 * rather than depending on media decoding in headless Chromium.
 */
import { test, expect, type Page } from "@playwright/test";
import { clearAll, createClip, createProfile, createUser } from "./helpers/emulator";
import { signUpAndSetupProfile } from "./helpers/auth-flow";

const VIEWER = { email: "feedviewer@test.com", password: "password123", username: "feedfan" };
const TOP_AUTHOR = { email: "topauthor@test.com", password: "password123", username: "topdog" };
const NEXT_AUTHOR = { email: "nextauthor@test.com", password: "password123", username: "nextup" };

test.beforeEach(async () => {
  await clearAll();
});

/** Fire a synthetic `ended` event on the spotlight video so the REPLAY /
 *  NEXT TRICK overlay renders (the 4-byte seeded clip never ends on its own). */
async function endSpotlightVideo(page: Page): Promise<void> {
  await page.evaluate(() => {
    const video = document.querySelector("article[aria-label='Current clip'] video");
    if (video) video.dispatchEvent(new Event("ended"));
  });
}

/**
 * Seed two authored clips with distinct upvote counts (so the default "Top"
 * sort is deterministic: "360 Flip" ranks above "Backside Smith"), then sign
 * the viewer up through the UI and land them on the lobby's embedded feed.
 * Returns the NEXT-clip author's uid for the profile-navigation assertion.
 */
async function seedTwoClipFeedAndSignIn(page: Page): Promise<{ nextAuthorUid: string }> {
  const top = await createUser(TOP_AUTHOR.email, TOP_AUTHOR.password);
  await createProfile(top.uid, TOP_AUTHOR.username, TOP_AUTHOR.email, true);
  const next = await createUser(NEXT_AUTHOR.email, NEXT_AUTHOR.password);
  await createProfile(next.uid, NEXT_AUTHOR.username, NEXT_AUTHOR.email, true);

  await createClip("feed-game-a", 1, "set", top.uid, TOP_AUTHOR.username, {
    trickName: "360 Flip",
    upvoteCount: 7,
  });
  await createClip("feed-game-b", 1, "set", next.uid, NEXT_AUTHOR.username, {
    trickName: "Backside Smith",
    upvoteCount: 2,
  });

  await signUpAndSetupProfile(page, VIEWER.email, VIEWER.password, VIEWER.username);
  return { nextAuthorUid: next.uid };
}

test("feed loads and renders the top seeded clip with author, trick name, and position", async ({ page }) => {
  await seedTwoClipFeedAndSignIn(page);

  // Spotlight hydrates with the top-ranked clip: author chip, trick name (h2),
  // SET role badge, and the position pill showing 1 of 2.
  const spotlight = page.getByRole("article", { name: "Current clip" });
  await expect(spotlight).toBeVisible({ timeout: 15_000 });
  await expect(spotlight.getByRole("heading", { name: "360 Flip" })).toBeVisible();
  await expect(spotlight.getByText(`@${TOP_AUTHOR.username}`)).toBeVisible();
  await expect(spotlight.getByLabel("Setter's landed trick")).toBeVisible();
  // Position pill ("1/2") lives in the feed header.
  await expect(page.getByText("1/2")).toBeVisible();
});

test("viewer pages to the next clip then taps the author into their profile", async ({ page }) => {
  const { nextAuthorUid } = await seedTwoClipFeedAndSignIn(page);

  const spotlight = page.getByRole("article", { name: "Current clip" });
  await expect(spotlight.getByRole("heading", { name: "360 Flip" })).toBeVisible({ timeout: 15_000 });

  // End the current clip → NEXT TRICK overlay appears → advance to clip 2.
  await endSpotlightVideo(page);
  await page.getByRole("button", { name: "Next trick" }).click();

  // The spotlight now shows the second-ranked clip and the pill flips to 2/2.
  await expect(spotlight.getByRole("heading", { name: "Backside Smith" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("2/2")).toBeVisible();

  // Tap the author chip → navigate into the clip author's public profile.
  await spotlight.getByText(`@${NEXT_AUTHOR.username}`).click();
  await page.waitForURL(new RegExp(`/player/${nextAuthorUid}`), { timeout: 15_000 });
  await expect(page.getByText(`@${NEXT_AUTHOR.username}`).first()).toBeVisible({ timeout: 15_000 });
});

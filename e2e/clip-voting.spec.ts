/**
 * E2E for the community clips spotlight upvote flow (audit F8).
 *
 * The lobby embeds <ClipsFeed> which fetches the top-ranked landed-trick
 * clip and lets a viewer tap the flame button to upvote it. The optimistic
 * UI flips `aria-pressed=true` and increments the count immediately, then
 * the transactional `upvoteClip` write reconciles the authoritative count
 * from Firestore.
 *
 * Seeds run via the emulator REST helpers so we don't need a second
 * verified user to land a real trick first — the clip's deterministic id
 * mirrors what `writeLandedClipsInTransaction` would have written.
 */
import { test, expect } from "@playwright/test";
import { clearAll, createUser, createProfile, createClip } from "./helpers/emulator";
import { signUpAndSetupProfile } from "./helpers/auth-flow";

const VIEWER = { email: "viewer@test.com", password: "password123", username: "viewer1" };
const AUTHOR = { email: "author@test.com", password: "password123", username: "tricklord" };

test.beforeEach(async () => {
  await clearAll();
});

test("viewer upvotes another player's clip → button flips to pressed and count increments", async ({ page }) => {
  // Seed the clip author (no UI signup needed for the non-viewer).
  const author = await createUser(AUTHOR.email, AUTHOR.password);
  await createProfile(author.uid, AUTHOR.username, AUTHOR.email, true);

  // One landed-trick clip authored by AUTHOR — visible to any signed-in viewer.
  await createClip("seeded-game-id", 1, "set", author.uid, AUTHOR.username);

  // Viewer signs up through the UI and lands on the lobby (which mounts ClipsFeed).
  await signUpAndSetupProfile(page, VIEWER.email, VIEWER.password, VIEWER.username);

  // Wait for the spotlight card to hydrate. The upvote button's aria-label
  // is `Upvote clip by @<username> · current count <n>` when not yet voted.
  const upvoteBtn = page.getByRole("button", { name: new RegExp(`Upvote clip by @${AUTHOR.username}`, "i") });
  await expect(upvoteBtn).toBeVisible({ timeout: 15_000 });
  await expect(upvoteBtn).toHaveAttribute("aria-pressed", "false");

  await upvoteBtn.click();

  // After upvoting the button's accessible name flips to "Upvoted · <count>",
  // so requery by aria-pressed=true on the same flame button.
  const upvotedBtn = page.locator('button[aria-pressed="true"]').filter({ hasText: "1" });
  await expect(upvotedBtn).toBeVisible({ timeout: 10_000 });
  // The same button is now disabled so a double-tap can't re-bump the count.
  await expect(upvotedBtn).toBeDisabled();
});

test("clip viewer cannot upvote their own clip — upvote button not rendered", async ({ page }) => {
  // Sign up viewer first so we know their uid via the auth-flow helper, then
  // seed a clip authored by that same uid.
  await signUpAndSetupProfile(page, VIEWER.email, VIEWER.password, VIEWER.username);

  const uid = await page.evaluate(() => {
    type E2EAuth = { currentUser?: { uid?: string } };
    const auth = (globalThis as Record<string, E2EAuth | undefined>).__e2eFirebaseAuth;
    return auth?.currentUser?.uid ?? null;
  });
  expect(uid).toBeTruthy();

  await createClip("own-clip-game", 1, "set", uid as string, VIEWER.username);

  // Reload so the freshly-seeded clip appears in the feed pool.
  await page.reload();

  // The author chip is still rendered so we can wait on it as a hydration
  // anchor — but the flame upvote control is omitted entirely (ClipActions
  // skips both upvote and challenge buttons when `isOwnClip` is true).
  await expect(page.getByText(`@${VIEWER.username}`).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Upvote clip by/i })).toHaveCount(0);
});

/**
 * E2E for the community clips spotlight upvote flow (audit F8).
 *
 * The Clips tab (/feed) renders <ClipsFeed>, which fetches the top-ranked
 * landed-trick clip and lets a viewer tap the flame button to upvote it. The optimistic
 * UI flips `aria-pressed=true` and increments the count immediately, then
 * the transactional `upvoteClip` write reconciles the authoritative count
 * from Firestore.
 *
 * Seeds run via the emulator REST helpers so we don't need a second
 * verified user to land a real trick first — the clip's deterministic id
 * mirrors what `writeLandedClipsInTransaction` would have written.
 */
import { test, expect } from "@playwright/test";
import { clearAll, createUser, createProfile, createClip, verifyEmail, forceTokenRefresh } from "./helpers/emulator";
import { signUpAndSetupProfile } from "./helpers/auth-flow";
import { openClipsFeed } from "./helpers/lobby-nav";

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

  // Viewer signs up through the UI, then opens the Clips tab — the feed moved
  // off the lobby onto its own /feed route.
  // Both `clipVotes` create and the `clips.upvoteCount` increment require
  // `email_verified == true` in firestore.rules — without verifyEmail +
  // forceTokenRefresh the upvote transaction would be permission-denied.
  await signUpAndSetupProfile(page, VIEWER.email, VIEWER.password, VIEWER.username);
  await verifyEmail(VIEWER.email);
  await page.reload();
  await forceTokenRefresh(page);
  await openClipsFeed(page);

  // Wait for the spotlight card to hydrate. The thumbs-up button's aria-label
  // is `Thumbs up clip by @<username> · current count <n>` before voting.
  const upvoteBtn = page.getByRole("button", { name: new RegExp(`Thumbs up clip by @${AUTHOR.username}`, "i") });
  await expect(upvoteBtn).toBeVisible({ timeout: 15_000 });
  await expect(upvoteBtn).toHaveAttribute("aria-pressed", "false");

  await upvoteBtn.click();

  // After upvoting the same control's accessible name flips to the withdraw
  // wording and carries the new count. Querying by that name keeps us on the
  // public contract — no CSS / DOM-structure coupling — and disambiguates
  // from any other aria-pressed toggle that might render the count "1".
  const upvotedBtn = page.getByRole("button", {
    name: new RegExp(`Remove your thumbs up on @${AUTHOR.username}'s clip · 1`, "i"),
  });
  await expect(upvotedBtn).toBeVisible({ timeout: 10_000 });
  await expect(upvotedBtn).toHaveAttribute("aria-pressed", "true");

  // A second tap withdraws the vote rather than re-bumping the tally: the
  // count returns to 0 and the control unpresses. One viewer, one vote.
  await upvotedBtn.click();
  await expect(upvoteBtn).toHaveAttribute("aria-pressed", "false", { timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: new RegExp(`Thumbs up clip by @${AUTHOR.username} · current count 0`, "i") }),
  ).toBeVisible();
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

  // Reload so the freshly-seeded clip appears in the feed pool, then open the
  // Clips tab where <ClipsFeed> is mounted.
  await page.reload();
  await openClipsFeed(page);

  // The author chip is the hydration anchor. Both thumbs still render on your
  // own clip — the counts are the point of looking — but they are disabled and
  // relabelled, so there is no control that would let the author vote on
  // themselves (ClipActions' `isOwnClip` branch).
  await expect(page.getByText(`@${VIEWER.username}`).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Thumbs (up|down) clip by/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Thumbs up · 0 — you can't vote on your own clip/i })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Thumbs down · 0 — you can't vote on your own clip/i })).toBeDisabled();
});

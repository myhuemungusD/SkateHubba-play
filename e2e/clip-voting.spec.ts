/**
 * E2E for the community clips spotlight upvote flow (audit F8).
 *
 * The Clips tab (/feed) renders <ClipsFeed>, which fetches the top-ranked
 * landed-trick clip and lets a viewer tap the flame button to upvote it. The
 * feed used to be embedded in the lobby; the redesign moved it onto its own
 * route behind the bottom nav's Clips tab, so these tests navigate there the
 * way a user does. The optimistic
 * UI flips `aria-pressed=true` and increments the count immediately, then
 * the transactional `upvoteClip` write reconciles the authoritative count
 * from Firestore.
 *
 * Seeds run via the emulator REST helpers so we don't need a second
 * verified user to land a real trick first — the clip's deterministic id
 * mirrors what `writeLandedClipsInTransaction` would have written.
 */
import { test, expect } from "@playwright/test";
import {
  clearAll,
  createUser,
  createProfile,
  createClip,
  verifyEmail,
  forceTokenRefresh,
  getSignedInUid,
} from "./helpers/emulator";
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

  // Viewer signs up through the UI and lands on the lobby.
  // Both `clipVotes` create and the `clips.upvoteCount` increment require
  // `email_verified == true` in firestore.rules — without verifyEmail +
  // forceTokenRefresh the upvote transaction would be permission-denied.
  await signUpAndSetupProfile(page, VIEWER.email, VIEWER.password, VIEWER.username);
  await verifyEmail(VIEWER.email);
  await page.reload();
  await forceTokenRefresh(page);

  // The feed is no longer on the lobby — open the Clips tab.
  await openClipsFeed(page);

  // Wait for the spotlight card to hydrate. The control is labelled
  // `Thumbs up clip by @<username> · current count <n>` when not yet voted —
  // it was renamed from "Upvote" in ClipActions, and this spec was still
  // asking for the old name.
  const upvoteBtn = page.getByRole("button", { name: new RegExp(`Thumbs up clip by @${AUTHOR.username}`, "i") });
  await expect(upvoteBtn).toBeVisible({ timeout: 15_000 });
  await expect(upvoteBtn).toHaveAttribute("aria-pressed", "false");

  await upvoteBtn.click();

  // Once cast, the same button becomes the withdraw affordance:
  // `Remove your thumbs up on @<username>'s clip · <count>`. Querying by that
  // accessible name keeps us on the public contract — no CSS / DOM-structure
  // coupling. It stays ENABLED: the vote is a toggle now, not a one-shot, so
  // asserting it goes disabled would be asserting the old behaviour.
  const upvotedBtn = page.getByRole("button", {
    name: new RegExp(`Remove your thumbs up on @${AUTHOR.username}'s clip · 1`, "i"),
  });
  await expect(upvotedBtn).toBeVisible({ timeout: 10_000 });
  await expect(upvotedBtn).toHaveAttribute("aria-pressed", "true");
});

test("clip viewer cannot upvote their own clip — the control renders disabled", async ({ page }) => {
  // Sign up viewer first so we know their uid via the auth-flow helper, then
  // seed a clip authored by that same uid.
  await signUpAndSetupProfile(page, VIEWER.email, VIEWER.password, VIEWER.username);

  const uid = await getSignedInUid(page);

  await createClip("own-clip-game", 1, "set", uid, VIEWER.username);

  // Open the Clips tab. The navigation is what pulls the freshly-seeded clip
  // into the feed pool — ClipsFeed queries on mount — so no reload is needed.
  await openClipsFeed(page);

  // The author chip is the hydration anchor. ClipActions does NOT omit the
  // control on your own clip — it renders it disabled and says why. The old
  // assertion here counted buttons named /Upvote clip by/ and expected zero,
  // which the rename to "Thumbs up" made vacuously true: this test passed
  // while asserting nothing.
  await expect(page.getByText(`@${VIEWER.username}`).first()).toBeVisible({ timeout: 15_000 });
  const ownUpvote = page.getByRole("button", { name: /Thumbs up · \d+ — you can't vote on your own clip/i });
  await expect(ownUpvote).toBeVisible({ timeout: 10_000 });
  await expect(ownUpvote).toBeDisabled();
});

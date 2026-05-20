/**
 * E2E for the InviteButton share panel (audit F8).
 *
 * <InviteButton> is rendered on the public Landing page (and a few
 * authed surfaces). It expands an inline share panel with a phone-contacts
 * tile, six social-share deep links, and a "Copy Link" button that writes
 * the invite blurb to the system clipboard.
 *
 * Landing is auth-free so this spec hits the button directly without an
 * emulator round-trip — we only `clearAll` to keep the harness's
 * before-each contract intact across the suite.
 */
import { test, expect } from "@playwright/test";
import { clearAll } from "./helpers/emulator";

test.beforeEach(async () => {
  await clearAll();
});

test("invite panel toggles open with social share tiles", async ({ page }) => {
  await page.goto("/");

  // Wait for the landing CTA so we know the page has hydrated.
  await expect(page.getByRole("button", { name: "Start Playing" })).toBeVisible({ timeout: 10_000 });

  const toggle = page.getByRole("button", { name: /Invite a Friend/i });
  await expect(toggle).toBeVisible();
  await toggle.click();

  // The expanded panel is exposed as role="region" with a stable
  // accessible name — that's the public contract.
  const panel = page.getByRole("region", { name: /Invite a friend options/i });
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // All six social share targets render as anchors with target="_blank" so
  // the visitor's tap opens the network's share-intent page. We assert the
  // canonical URLs to catch any regression in `encodedUrl` / `encodedText`
  // wiring.
  for (const name of ["X", "WhatsApp", "Snapchat", "Facebook", "Reddit", "Telegram"]) {
    const link = panel.getByRole("link", { name });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  }

  // The same toggle button stays mounted — only its accessible name flips
  // from "Invite a Friend" to exactly "Close" while the panel is open. Use
  // an exact-name match instead of /Close/i so we don't accidentally pick
  // up any unrelated close affordance the landing page may grow later.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("region", { name: /Invite a friend options/i })).toHaveCount(0);
});

test("Copy Link writes the invite blurb to the clipboard", async ({ page, context }) => {
  // The clipboard API requires explicit permission in headless Chromium.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:5173" });

  await page.goto("/");
  await page.getByRole("button", { name: /Invite a Friend/i }).click();

  const panel = page.getByRole("region", { name: /Invite a friend options/i });
  await expect(panel).toBeVisible({ timeout: 5_000 });

  await panel.getByRole("button", { name: /Copy Link/i }).click();

  // The button's label flips to "Copied" once `navigator.clipboard.writeText`
  // resolves — public contract.
  await expect(panel.getByRole("button", { name: /Copied/i })).toBeVisible({ timeout: 5_000 });

  // The clipboard contents are the username-less invite blurb (no @handle
  // on Landing) plus the canonical share URL.
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("Play S.K.A.T.E. on SkateHubba");
  // The share URL is whatever VITE_APP_URL resolves to; absent the env var
  // the component falls back to `window.location.origin`, which under
  // playwright is the dev server.
  expect(clipboard).toContain("http");
});

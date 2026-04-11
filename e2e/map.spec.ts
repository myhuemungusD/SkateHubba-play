/**
 * E2E for the map → S.K.A.T.E. challenge wiring.
 *
 * Deliberately auth-agnostic: the /map route is listed in PUBLIC_SCREENS
 * (see src/context/NavigationContext.tsx), so we can exercise the full
 * map → marker → preview card → "Challenge from here" flow without
 * going through Firebase Auth sign-up. That keeps the test fast, stable,
 * and immune to auth-emulator flakiness.
 *
 * Two assertions cover the two halves of the P0 #3 wire-up:
 *   1. Clicking "Challenge from here" navigates to /challenge?spot=<uuid>.
 *      This is captured via a `framenavigated` listener because the auth
 *      router will immediately bounce an unauthenticated user back to /,
 *      so the post-click URL is only momentarily at /challenge.
 *   2. Before the bounce, the spot id is stashed in sessionStorage under
 *      `skate.pendingChallengeSpot` so a post-login restore can reapply
 *      it. This is the auth-bounce polish added on top of the P0.
 *
 * The bounds endpoint is stubbed via page.route so the test has no
 * dependency on a live Neon Postgres or the apps/api server.
 */

import { test, expect, type Page } from "@playwright/test";
import { clearAll } from "./helpers/emulator";

const FIXTURE_SPOT = {
  id: "11111111-2222-3333-4444-555555555555",
  createdBy: "seed",
  name: "Test Ledge",
  description: null,
  latitude: 34.0522,
  longitude: -118.2437,
  gnarRating: 3,
  bustRisk: 2,
  obstacles: ["ledge"],
  photoUrls: [],
  isVerified: false,
  isActive: true,
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z",
};

const FIXTURE_FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [FIXTURE_SPOT.longitude, FIXTURE_SPOT.latitude] },
      properties: FIXTURE_SPOT,
    },
  ],
};

/**
 * Minimal Mapbox style + source stubs so GL JS initializes without needing
 * live network access to api.mapbox.com / *.tiles.mapbox.com. We return an
 * empty style with no layers — the map won't render any basemap, but the
 * Map container + marker element overlays still work, which is all the
 * wiring test needs to exercise the click flow.
 */
const EMPTY_STYLE = {
  version: 8,
  name: "e2e-stub",
  sources: {},
  layers: [],
  sprite: "https://stub.invalid/sprite",
  glyphs: "https://stub.invalid/{fontstack}/{range}.pbf",
};

/** Stub every endpoint the map layer would otherwise hit over the network. */
async function stubBounds(page: Page): Promise<void> {
  // Mapbox style — returns a minimal valid style doc.
  await page.route(/api\.mapbox\.com\/styles\//, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPTY_STYLE),
    });
  });
  // Mapbox telemetry / events / sprites / glyphs — swallow with 204.
  await page.route(/api\.mapbox\.com\/(events|v4|fonts|sprites)/, async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route(/\.tiles\.mapbox\.com/, async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  // The app's bounds endpoint — returns a single fixture spot.
  await page.route("**/api/spots/bounds*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FIXTURE_FEATURE_COLLECTION),
    });
  });
  // Singular spot endpoint so the ChallengeScreen chip's fetchSpotName call
  // doesn't 404 in a follow-up navigation.
  await page.route(`**/api/spots/${FIXTURE_SPOT.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: FIXTURE_SPOT.id, name: FIXTURE_SPOT.name }),
    });
  });
}

test.beforeEach(async () => {
  await clearAll();
});

test.describe("Map → challenge wiring", () => {
  test("Challenge from here forwards the spot id and stashes it across auth", async ({ page }) => {
    await stubBounds(page);

    // Surface uncaught page errors + browser console warnings/errors if the
    // test fails. The MapErrorBoundary otherwise swallows mapbox-gl crashes,
    // making CI failures opaque — this keeps them actionable.
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning" || msg.type() === "error") {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      consoleMessages.push(`[pageerror] ${err.message}`);
    });

    // Collect every URL the frame navigates to — the auth router will bounce
    // an unauthenticated user off /challenge, but we still want to prove the
    // intermediate URL had the spot param. This matches how a real shared
    // link from a logged-out user would behave.
    const navigatedUrls: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigatedUrls.push(frame.url());
    });

    await page.goto("/map");

    // The spot marker is rendered as an HTMLDivElement with a test id set in
    // SpotMap.createMarkerEl. Wait for it to appear — the map has to load its
    // style and fire the first bounds fetch before markers are added.
    const marker = page.locator(`[data-testid="spot-marker-${FIXTURE_SPOT.id}"]`);
    try {
      await expect(marker).toBeVisible({ timeout: 15_000 });
    } catch (e) {
      // Surface captured console output to make sandbox failures actionable
      // (e.g. missing WebGL in headless chromium).
      console.error("[e2e] Captured browser console output:\n" + consoleMessages.join("\n"));
      throw e;
    }

    // Tap the marker to open the preview card.
    await marker.click();
    await expect(page.getByRole("dialog", { name: `Spot: ${FIXTURE_SPOT.name}` })).toBeVisible();

    // "Challenge from here" is the primary (orange) button on the card.
    await page.getByRole("button", { name: "Challenge from here" }).click();

    // At least one intermediate navigation must have included the spot param.
    // Poll the captured list so we don't race the auth router's bounce.
    await expect
      .poll(() => navigatedUrls.some((u) => u.includes(`/challenge?spot=${FIXTURE_SPOT.id}`)), {
        timeout: 5_000,
      })
      .toBe(true);

    // The auth-bounce polish stashes the spot in sessionStorage so a
    // post-login restore can reapply it. Verify the stash survived the
    // bounce — this is what makes shared /challenge?spot= links work for
    // logged-out recipients.
    const stashed = await page.evaluate(() => window.sessionStorage.getItem("skate.pendingChallengeSpot"));
    expect(stashed).toBe(FIXTURE_SPOT.id);
  });
});

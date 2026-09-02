/**
 * E2E for the map → S.K.A.T.E. challenge wiring.
 *
 * Charter-compliant: this test seeds the spot data directly into the
 * Firestore emulator (via the named "skatehubba" database) instead of
 * stubbing an HTTP API. There is no apps/api server — the map talks
 * to Firestore exclusively, and so does this test.
 *
 * SIGNED IN, deliberately. This spec used to open /map cold and assert the
 * signed-out auth-bounce stash, on the premise that /map was public. It is
 * not, and cannot be: `firestore.rules` gates spot reads behind
 * `isSignedIn()` to close anonymous enumeration of the spot graph, so a
 * signed-out /map has no markers to click even with the route guard opened
 * up. The signed-out share surface is /spots/:id, whose bounce is what
 * stashes `skate.pendingChallengeSpot`; that belongs to a spot-link spec,
 * not to the map.
 */

import { test, expect, type Page } from "@playwright/test";
import { clearAll, createSpot, getSignedInUid } from "./helpers/emulator";
import { signUpAndSetupProfile } from "./helpers/auth-flow";

const SPOT_ID = "11111111-2222-3333-4444-555555555555";

// Mirrors src/services/onboarding.ts — localDismissedKey(uid) at the current
// TUTORIAL_VERSION. A version bump shows up here as a focused diff, same as
// the pinned constants in onboarding.spec.ts.
const TOUR_DISMISSED_KEY_PREFIX = "skatehubba.onboarding.dismissed.v2.";
const SPOT_NAME = "Test Ledge";

test.beforeEach(async () => {
  await clearAll();
  // Seed one spot in the LA viewport so the SpotMap bounds query finds
  // exactly one marker. The default lat/lng in createSpot match the map's
  // initial center (34.0522, -118.2437).
  await createSpot(SPOT_ID, "seed-user", { name: SPOT_NAME });
});

/**
 * Stub Mapbox network endpoints so GL JS can initialize without reaching
 * api.mapbox.com / *.tiles.mapbox.com. The map renders an empty basemap;
 * markers still mount as DOM overlays so the click flow works.
 */
/**
 * Strip the meta-tag CSP from the served HTML so headless Chromium can
 * reach the localhost emulators (port 8080 etc) from the page's context.
 * The production CSP blocks `http://localhost:*` because `'self'` is
 * strict same-origin (5173 ≠ 8080), and there's no dev-time relaxation.
 *
 * Test-only — production builds keep the full CSP unchanged.
 */
async function relaxCspForEmulators(page: Page): Promise<void> {
  // Vite serves index.html for any unknown SPA route. Intercept the exact
  // /map navigation (and any other top-level page request) and strip the
  // CSP meta tag from the body before it reaches the document.
  await page.route(
    /http:\/\/localhost:5173\/(map|spots|challenge|lobby|profile|game|gameover|player|auth|privacy|terms|data-deletion|404|$)/,
    async (route) => {
      const response = await route.fetch();
      const contentType = response.headers()["content-type"] ?? "";
      if (!contentType.includes("text/html")) {
        await route.fulfill({ response });
        return;
      }
      const body = await response.text();
      const stripped = body.replace(/<meta http-equiv="Content-Security-Policy"[^>]*\/>/i, "");
      await route.fulfill({
        response,
        body: stripped,
      });
    },
  );
}

async function stubMapbox(page: Page, capturedStyleUrls?: string[]): Promise<void> {
  // The sprite/glyph URLs MUST point at api.mapbox.com because the CSP
  // (vercel.json) only allows api.mapbox.com / *.tiles.mapbox.com /
  // events.mapbox.com for connect-src. Anything else is blocked at the
  // browser level before page.route can intercept it.
  const emptyStyle = {
    version: 8,
    name: "e2e-stub",
    sources: {},
    layers: [],
    sprite: "https://api.mapbox.com/sprite",
    glyphs: "https://api.mapbox.com/fonts/{fontstack}/{range}.pbf",
  };
  await page.route(/api\.mapbox\.com\/styles\//, (route) => {
    capturedStyleUrls?.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyStyle) });
  });
  // Catch the sprite + glyph URLs the empty style references plus any
  // ancillary GET to api.mapbox.com that GL JS makes during init.
  await page.route(/api\.mapbox\.com\/(events|v4|fonts|sprites|sprite)/, (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route(/api\.mapbox\.com\/sprite/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route(/\.tiles\.mapbox\.com/, (route) => route.fulfill({ status: 204, body: "" }));
}

test.describe("Map → challenge wiring", () => {
  test("Challenge from here forwards the spot id to the challenge screen", async ({ page }) => {
    // Surface page errors / browser console for actionable CI failures —
    // the MapErrorBoundary otherwise swallows mapbox-gl crashes silently.
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning" || msg.type() === "error") {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      consoleMessages.push(`[pageerror] ${err.message}`);
    });

    // Sign in BEFORE the route interception goes on. /map needs a session
    // (spot reads are auth-gated), and running the signup through
    // relaxCspForEmulators' rewritten document responses hung it at the
    // post-"Create Account" navigation — every other spec signs up against
    // unintercepted pages, and this one now does too.
    // The consent banner (fixed, bottom, z-50) swallowed the "Challenge from
    // here" click exactly as it did the recorder controls in the recording
    // specs. It is pre-answered before the first navigation by
    // signUpAndSetupProfile → signUpViaUI (helpers/auth-flow.ts), so there is
    // nothing to do here beyond signing up.
    const unique = Date.now();
    await signUpAndSetupProfile(page, `mapper${unique}@example.com`, "sk8pass123", `mapper${unique}`);

    // Dismiss the onboarding tour before it can cover the map UI. A fresh
    // account arms the tour, its mascot bubble renders over /map too, and the
    // "Challenge from here" click below dies inside Playwright's
    // actionability retries ("mascot-bubble … intercepts pointer events").
    // The dismissed flag is per-uid, so it can only be seeded after signup;
    // the /map navigation below reloads the app, which re-reads it.
    const uid = await getSignedInUid(page);
    await page.evaluate((key) => window.localStorage.setItem(key, "1"), TOUR_DISMISSED_KEY_PREFIX + uid);

    await relaxCspForEmulators(page);
    // Capture the style URL mapbox-gl actually requests so we can assert
    // the env-var → lib/mapbox → SpotMap → mapbox-gl wiring at the network
    // boundary, not just at the JS module level.
    const capturedStyleUrls: string[] = [];
    await stubMapbox(page, capturedStyleUrls);

    await page.goto("/map");

    // Wait for the seeded spot's marker to appear. The marker carries a
    // data-testid attached in SpotMap.createMarkerEl.
    const marker = page.locator(`[data-testid="spot-marker-${SPOT_ID}"]`);
    try {
      await expect(marker).toBeVisible({ timeout: 15_000 });
    } catch (e) {
      console.error("[e2e] Captured browser console output:\n" + consoleMessages.join("\n"));
      throw e;
    }

    // Tap the marker to open the SpotPreviewCard.
    await marker.click();
    await expect(page.getByRole("dialog", { name: `Spot: ${SPOT_NAME}` })).toBeVisible();

    // "Challenge from here" is the primary (orange) button on the card.
    await page.getByRole("button", { name: "Challenge from here" }).click();

    // A signed-in user is not bounced: the spot id rides the query param
    // straight onto the challenge screen, which is the contract
    // ChallengeScreen reads.
    await page.waitForURL(`**/challenge?spot=${SPOT_ID}`, { timeout: 10_000 });

    // Wiring guard: with VITE_MAPBOX_STYLE_URL unset (the e2e default),
    // mapbox-gl must request the dark-v11 style. This is the network-level
    // proof of the env-var → lib/mapbox → SpotMap → mapbox-gl path. If
    // someone breaks the import chain or the resolver default, the
    // captured request URL will diverge and this assertion will fire.
    expect(capturedStyleUrls.length).toBeGreaterThan(0);
    expect(capturedStyleUrls.some((u) => u.includes("/styles/v1/mapbox/dark-v11"))).toBe(true);
  });
});

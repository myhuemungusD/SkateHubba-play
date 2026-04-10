/**
 * E2E for the map → S.K.A.T.E. challenge wiring.
 *
 * Verifies the MVP wire-up added in the audit P0 #3 fix:
 *   1. User signs in and navigates to /map
 *   2. The map renders a spot marker (fetched from a stubbed /api/spots/bounds)
 *   3. Tapping the marker opens the SpotPreviewCard
 *   4. "Challenge from here" navigates to /challenge?spot=<uuid>
 *
 * The bounds endpoint is intentionally stubbed via page.route so this test
 * does not need a live Neon Postgres / apps/api server — the Playwright
 * config only boots Firebase emulators and the Vite dev server.
 */

import { test, expect, type Page } from "@playwright/test";
import { clearAll } from "./helpers/emulator";

const U1 = { email: "mapuser@test.com", password: "password123", username: "mapskater" };

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

async function passAgeGate(page: Page) {
  await expect(page.getByLabel("Birth month")).toBeVisible({ timeout: 5_000 });
  await page.getByLabel("Birth month").fill("01");
  await page.getByLabel("Birth day").fill("15");
  await page.getByLabel("Birth year").fill("2000");
  await page.getByRole("button", { name: "Continue" }).click();
}

async function signUpAndSetupProfile(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await fetch("http://localhost:9099/", { mode: "no-cors" }).catch(() => {});
    await fetch("http://localhost:8080/", { mode: "no-cors" }).catch(() => {});
  });
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await passAgeGate(page);
  await expect(page.getByPlaceholder("you@email.com")).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("you@email.com").fill(U1.email);
  const pwFields = page.getByPlaceholder("••••••••");
  await pwFields.nth(0).fill(U1.password);
  await pwFields.nth(1).fill(U1.password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await page.waitForURL(/\/(profile|lobby)/, { timeout: 15_000 });

  await expect(page.getByText("Pick your handle")).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder("sk8legend").fill(U1.username);
  await expect(page.getByText(`@${U1.username} is available ✓`)).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Lock It In" }).click();
  await expect(page.getByRole("heading", { name: "Your Games" })).toBeVisible({ timeout: 10_000 });
}

test.beforeEach(async () => {
  await clearAll();
});

test.describe("Map → challenge wiring", () => {
  test("Challenge from here carries the spotId into /challenge?spot=…", async ({ page }) => {
    // Stub the bounds endpoint before any navigation so every call returns our fixture.
    await page.route("**/api/spots/bounds*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FIXTURE_FEATURE_COLLECTION),
      });
    });

    await signUpAndSetupProfile(page);

    // Navigate to the map route
    await page.goto("/map");

    // The spot marker is rendered as an HTMLDivElement with a test id we
    // attached in SpotMap.createMarkerEl. Wait for it to appear — the map
    // has to load its style and fire the first bounds fetch before markers
    // are added.
    const marker = page.locator(`[data-testid="spot-marker-${FIXTURE_SPOT.id}"]`);
    await expect(marker).toBeVisible({ timeout: 15_000 });

    // Tap the marker to open the preview card
    await marker.click();
    await expect(page.getByRole("dialog", { name: `Spot: ${FIXTURE_SPOT.name}` })).toBeVisible();

    // "Challenge from here" navigates to /challenge with ?spot=<uuid>
    await page.getByRole("button", { name: "Challenge from here" }).click();
    await page.waitForURL(new RegExp(`/challenge\\?spot=${FIXTURE_SPOT.id}`), { timeout: 5_000 });
    expect(page.url()).toContain(`/challenge?spot=${FIXTURE_SPOT.id}`);
  });
});

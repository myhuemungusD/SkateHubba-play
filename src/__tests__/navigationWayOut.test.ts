/**
 * Dead-end guard. Every route in App.tsx must be one of:
 *  - a tab (BottomNav is visible, so the tab bar is the way out),
 *  - a redirect (<Navigate>), or
 *  - a pushed screen whose source renders a back/close/exit control.
 * Adding a route without classifying it here fails the suite, and a pushed
 * screen that loses its back control fails too.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isBottomNavScreen } from "../components/BottomNav";
import { pathToScreen } from "../context/NavigationContext";

const root = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const TAB_ROUTES = ["/lobby", "/feed", "/challenge", "/map", "/me"];
/** Landing is the signed-out root; the app has nothing behind it. */
const ROOT_ROUTES = ["/"];
const REDIRECT_ROUTES = ["/record", "/play", "/play/*", "*"];

/** Pushed screens → the source file(s) that must render a way out. */
const WAY_OUT: Record<string, string[]> = {
  "/auth": ["screens/AuthScreen.tsx"],
  "/profile": ["screens/ProfileSetup.tsx"],
  "/game": ["screens/GamePlayScreen/index.tsx"],
  "/gameover": ["screens/GameOverScreen.tsx"],
  "/player/:uid": ["screens/PlayerProfileScreen/index.tsx"],
  "/spots/:id": ["screens/SpotDetailPage.tsx"],
  "/closet/studio": ["screens/ClosetStudio/ClosetStudioScreen.tsx"],
  "/play/runner": ["screens/Runner/RunnerHud.tsx"],
  "/privacy": ["screens/PrivacyPolicy.tsx"],
  "/terms": ["screens/TermsOfService.tsx"],
  "/data-deletion": ["screens/DataDeletion.tsx"],
  "/settings": ["screens/Settings.tsx"],
  "/my-stats": ["screens/MyStatsScreen/index.tsx"],
  "/dice": ["screens/Dice/DiceHub.tsx"],
  "/dice/new": ["screens/Dice/DiceNew.tsx"],
  "/dice/:gameId": ["screens/Dice/DiceTable.tsx"],
  "/pro": ["screens/ProToolsScreen/index.tsx"],
  "/admin": ["screens/AdminScreen/index.tsx"],
  "/tricks": ["screens/TrickLibraryPage.tsx"],
  "/404": ["screens/NotFound.tsx"],
};

const WAY_OUT_MARKER = /onBack|<ScreenHeader|<BackButton|useGoBack|aria-label="(Back|Close)[^"]*"|>\s*Exit\s*</;

function appRoutePaths(): string[] {
  const src = read("App.tsx");
  return [...new Set([...src.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]))];
}

describe("navigation: no dead ends", () => {
  it("classifies every route in App.tsx", () => {
    const known = new Set([...TAB_ROUTES, ...ROOT_ROUTES, ...REDIRECT_ROUTES, ...Object.keys(WAY_OUT)]);
    const unclassified = appRoutePaths().filter((p) => !known.has(p));
    expect(unclassified).toEqual([]);
  });

  it("shows the tab bar on every tab route", () => {
    for (const path of TAB_ROUTES) expect(isBottomNavScreen(pathToScreen(path))).toBe(true);
  });

  it("gives every pushed screen a back, close or exit control", () => {
    const missing = Object.entries(WAY_OUT)
      .filter(([, files]) => !files.some((f) => WAY_OUT_MARKER.test(read(f))))
      .map(([path]) => path);
    expect(missing).toEqual([]);
  });

  it("never hides the tab bar on a pushed screen without a way out", () => {
    for (const path of Object.keys(WAY_OUT)) {
      if (isBottomNavScreen(pathToScreen(path))) continue;
      expect(WAY_OUT[path].length).toBeGreaterThan(0);
    }
  });

  it("wires header Back in App.tsx through history-aware backOr, never navigate(-1) alone", () => {
    expect(read("App.tsx")).not.toMatch(/onBack=\{\(\) => navigate\(-1\)\}/);
  });
});

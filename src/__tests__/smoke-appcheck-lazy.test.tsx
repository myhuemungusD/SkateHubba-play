import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createMockHelpers, renderApp } from "./smoke-helpers";

/*
 * Web App Check is closet-only (docs/APPCHECK_ROLLOUT.md). Nothing outside a
 * closet action may pull in firebase/app-check or the reCAPTCHA script, or
 * every page load starts paying for reCAPTCHA again.
 */
const { auth, authSvc, users, games, storage, fcm, firebase, analytics, blocking, onboarding, sentry } =
  await vi.hoisted(async () => (await import("./harness/mockServices")).createAllSmokeMocks());

const appCheckLoaded = vi.hoisted(() => vi.fn());

vi.mock("../hooks/useAuth", () => auth.module);
vi.mock("../services/auth", () => authSvc.module);
vi.mock("../services/users", () => users.module);
vi.mock("../services/games", () => games.module);
vi.mock("../services/storage", () => storage.module);
vi.mock("../services/fcm", () => fcm.module);
vi.mock("../firebase", () => firebase.module);
vi.mock("../services/analytics", () => analytics.module);
vi.mock("@sentry/react", () => sentry.module);
vi.mock("../services/blocking", () => blocking.module);
vi.mock("../services/onboarding", () => onboarding.module);
vi.mock("firebase/app-check", () => {
  appCheckLoaded();
  return { initializeAppCheck: vi.fn(), ReCaptchaV3Provider: vi.fn(), getLimitedUseToken: vi.fn() };
});

beforeEach(() => vi.clearAllMocks());

const { renderLobby } = createMockHelpers({
  mockUseAuth: auth.refs.useAuth,
  mockSubscribeToMyGames: games.refs.subscribeToMyGames,
  mockSubscribeToGame: games.refs.subscribeToGame,
});

function recaptchaOnPage(): boolean {
  return Array.from(document.querySelectorAll("script")).some((s) => /recaptcha/i.test(s.src));
}

describe("Smoke: App Check stays closet-only on web", () => {
  it("landing page loads neither firebase/app-check nor reCAPTCHA", async () => {
    auth.refs.useAuth.mockReturnValue({ loading: false, user: null, profile: null, refreshProfile: vi.fn() });
    await renderApp();
    expect(await screen.findByText("QUIT SCROLLING.")).toBeInTheDocument();
    expect(appCheckLoaded).not.toHaveBeenCalled();
    expect(recaptchaOnPage()).toBe(false);
  });

  it("lobby loads neither firebase/app-check nor reCAPTCHA", async () => {
    await renderLobby([]);
    expect(await screen.findByText(/Ready to S\.K\.A\.T\.E\.\?/i)).toBeInTheDocument();
    expect(appCheckLoaded).not.toHaveBeenCalled();
    expect(recaptchaOnPage()).toBe(false);
  });

  it("only firebase.ts (sitewide switch) and closetAppCheck.ts may import firebase/app-check", () => {
    const root = join(__dirname, "..");
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "__tests__" && name !== "__mocks__") walk(path);
        } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          if (/["']firebase\/app-check["']|recaptcha\/(api|enterprise)\.js/.test(readFileSync(path, "utf8"))) {
            hits.push(relative(root, path));
          }
        }
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(["firebase.ts", "services/closetAppCheck.ts"]);
  });
});

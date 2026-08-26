import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { BottomNav } from "../BottomNav";
import type { Screen } from "../../context/NavigationContext";

let mockScreen: Screen = "lobby";
let mockUnreadCount = 0;

vi.mock("../../context/NotificationContext", () => ({
  useNotifications: () => ({ unreadCount: mockUnreadCount }),
}));

vi.mock("../../context/NavigationContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/NavigationContext")>(
    "../../context/NavigationContext",
  );
  return {
    ...actual,
    useNavigationContext: () => ({
      screen: mockScreen,
      setScreen: vi.fn(),
      navigateToPlayer: vi.fn(),
      authMode: "signin" as const,
      setAuthMode: vi.fn(),
      ageGateDob: null,
      ageGateParentalConsent: false,
      setAgeGateResult: vi.fn(),
    }),
  };
});

/** Probe that surfaces the current pathname so tests can assert navigation. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderNav(initialPath = "/lobby") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BottomNav />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockScreen = "lobby";
  mockUnreadCount = 0;
});

describe("BottomNav", () => {
  it("renders all five primary tabs on the lobby screen", () => {
    renderNav("/lobby");
    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeInTheDocument();
    for (const label of ["Home", "Clips", "Challenge", "Map", "Me"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("points each tab at its canonical screen path", () => {
    renderNav("/lobby");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/lobby");
    expect(screen.getByRole("link", { name: "Clips" })).toHaveAttribute("href", "/feed");
    expect(screen.getByRole("link", { name: "Challenge" })).toHaveAttribute("href", "/challenge");
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("href", "/map");
    expect(screen.getByRole("link", { name: "Me" })).toHaveAttribute("href", "/me");
  });

  it("orders the tabs Home, Clips, Challenge, Map, Me — Challenge is the centre action", () => {
    renderNav("/lobby");
    const labels = screen.getAllByRole("link").map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual(["Home", "Clips", "Challenge", "Map", "Me"]);
  });

  it("marks the current screen as the active tab", () => {
    mockScreen = "map";
    renderNav("/map");
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("marks the Challenge tab active on the challenge screen", () => {
    mockScreen = "challenge";
    renderNav("/challenge");
    expect(screen.getByRole("link", { name: "Challenge" })).toHaveAttribute("aria-current", "page");
  });

  it("marks the Clips tab active on the feed screen", () => {
    mockScreen = "feed";
    renderNav("/feed");
    expect(screen.getByRole("link", { name: "Clips" })).toHaveAttribute("aria-current", "page");
  });

  // /player/:uid is someone else's profile — a pushed detail screen, not a tab
  // destination. It used to light up "Me", which made one tab stand for both
  // your own record and any other skater's profile.
  it("claims no tab on another player's profile, and hides the bar there", () => {
    mockScreen = "player";
    renderNav("/player/u42");
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();
  });

  it.each([
    ["Map", "/map"],
    ["Home", "/lobby"],
    ["Clips", "/feed"],
    ["Challenge", "/challenge"],
    ["Me", "/me"],
  ])("navigates to %s's path when tapped", async (label, path) => {
    mockScreen = label === "Home" ? "map" : "lobby";
    renderNav(mockScreen === "map" ? "/map" : "/lobby");
    await userEvent.click(screen.getByRole("link", { name: label }));
    expect(screen.getByTestId("location")).toHaveTextContent(path);
  });

  it("hides itself on focus-mode screens (game)", () => {
    mockScreen = "game";
    renderNav("/game");
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();
  });

  it("hides itself on auth screens", () => {
    mockScreen = "auth";
    renderNav("/auth");
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();
  });

  it("hides itself on the landing screen", () => {
    mockScreen = "landing";
    renderNav("/");
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();
  });

  it.each<Screen>(["lobby", "feed", "challenge", "map", "me"])("is visible on the %s screen", (s) => {
    mockScreen = s;
    renderNav();
    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeInTheDocument();
  });

  it("badges the Home tab with the unread count while the user is elsewhere", () => {
    mockScreen = "map";
    mockUnreadCount = 3;
    renderNav("/map");
    const home = screen.getByRole("link", { name: "Home (3 unread)" });
    expect(home).toHaveTextContent("3");
  });

  it("caps the badge at 9+", () => {
    mockScreen = "map";
    mockUnreadCount = 12;
    renderNav("/map");
    expect(screen.getByRole("link", { name: "Home (12 unread)" })).toHaveTextContent("9+");
  });

  it("renders no badge when there is nothing unread", () => {
    mockScreen = "map";
    renderNav("/map");
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  });

  it("drops the badge on the Home tab itself — the lobby bell carries the count there", () => {
    mockScreen = "lobby";
    mockUnreadCount = 4;
    renderNav("/lobby");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveTextContent("4");
  });

  it("never badges any tab but Home", () => {
    mockScreen = "map";
    mockUnreadCount = 5;
    renderNav("/map");
    for (const label of ["Clips", "Challenge", "Map", "Me"]) {
      expect(screen.getByRole("link", { name: label })).not.toHaveTextContent("5");
    }
  });

  // The tour anchors two steps by data-tutorial id and silently auto-skips a
  // step whose anchor is missing, so a stale id degrades the tour without
  // failing anything. Both steps run on the lobby screen, where the nav shows.
  it("carries the onboarding tour's anchors on the Me and Challenge tabs", () => {
    renderNav("/lobby");
    expect(screen.getByRole("link", { name: "Me" })).toHaveAttribute("data-tutorial", "record-button");
    expect(screen.getByRole("link", { name: "Challenge" })).toHaveAttribute("data-tutorial", "challenge-cta");
  });
});

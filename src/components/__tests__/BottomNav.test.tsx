import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { BottomNav } from "../BottomNav";
import type { Screen } from "../../context/NavigationContext";

let mockScreen: Screen = "lobby";

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
});

describe("BottomNav", () => {
  it("renders all three primary tabs on the lobby screen", () => {
    renderNav("/lobby");
    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Me" })).toBeInTheDocument();
  });

  it("points each tab at its canonical screen path", () => {
    renderNav("/lobby");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/lobby");
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("href", "/map");
    expect(screen.getByRole("link", { name: "Me" })).toHaveAttribute("href", "/record");
  });

  it("marks the current screen as the active tab", () => {
    mockScreen = "map";
    renderNav("/map");
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("marks the Me tab active on /player/:uid routes", () => {
    mockScreen = "player";
    renderNav("/player/u42");
    expect(screen.getByRole("link", { name: "Me" })).toHaveAttribute("aria-current", "page");
  });

  it("navigates to /map when the Map tab is tapped", async () => {
    renderNav("/lobby");
    await userEvent.click(screen.getByRole("link", { name: "Map" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/map");
  });

  it("navigates to /lobby when the Home tab is tapped", async () => {
    mockScreen = "map";
    renderNav("/map");
    await userEvent.click(screen.getByRole("link", { name: "Home" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/lobby");
  });

  it("navigates to /record when the Me tab is tapped", async () => {
    renderNav("/lobby");
    await userEvent.click(screen.getByRole("link", { name: "Me" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/record");
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

  it("is visible on the map screen", () => {
    mockScreen = "map";
    renderNav("/map");
    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeInTheDocument();
  });

  it("is visible on the record screen", () => {
    mockScreen = "record";
    renderNav("/record");
    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { BottomNav } from "../BottomNav";
import type { Screen } from "../../context/NavigationContext";

const setScreenMock = vi.fn();
let mockScreen: Screen = "lobby";

vi.mock("../../context/NavigationContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/NavigationContext")>(
    "../../context/NavigationContext",
  );
  return {
    ...actual,
    useNavigationContext: () => ({
      screen: mockScreen,
      setScreen: setScreenMock,
      navigateToPlayer: vi.fn(),
      authMode: "signin" as const,
      setAuthMode: vi.fn(),
      ageGateDob: null,
      ageGateParentalConsent: false,
      setAgeGateResult: vi.fn(),
    }),
  };
});

function renderNav(initialPath = "/lobby") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BottomNav />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setScreenMock.mockClear();
  mockScreen = "lobby";
});

describe("BottomNav", () => {
  it("renders all three primary tabs on the lobby screen", () => {
    renderNav("/lobby");
    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Me" })).toBeInTheDocument();
  });

  it("marks the current screen as the active tab", () => {
    mockScreen = "map";
    renderNav("/map");
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("marks the Me tab active on /player/:uid routes", () => {
    mockScreen = "player";
    renderNav("/player/u42");
    expect(screen.getByRole("button", { name: "Me" })).toHaveAttribute("aria-current", "page");
  });

  it("navigates to the map screen when the Map tab is tapped", async () => {
    renderNav("/lobby");
    await userEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(setScreenMock).toHaveBeenCalledWith("map");
  });

  it("navigates to the lobby when the Home tab is tapped", async () => {
    mockScreen = "map";
    renderNav("/map");
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(setScreenMock).toHaveBeenCalledWith("lobby");
  });

  it("navigates to the record (self profile) when the Me tab is tapped", async () => {
    renderNav("/lobby");
    await userEvent.click(screen.getByRole("button", { name: "Me" }));
    expect(setScreenMock).toHaveBeenCalledWith("record");
  });

  it("hides itself on focus-mode screens (game)", () => {
    mockScreen = "game";
    const { container } = renderNav("/game");
    expect(container).toBeEmptyDOMElement();
  });

  it("hides itself on auth screens", () => {
    mockScreen = "auth";
    const { container } = renderNav("/auth");
    expect(container).toBeEmptyDOMElement();
  });

  it("hides itself on the landing screen", () => {
    mockScreen = "landing";
    const { container } = renderNav("/");
    expect(container).toBeEmptyDOMElement();
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

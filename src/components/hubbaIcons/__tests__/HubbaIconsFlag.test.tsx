import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { BellGlyph } from "../../NotificationBellIcons";
import { BottomNav } from "../../BottomNav";
import { LobbyHeader } from "../../../screens/Lobby/components/LobbyHeader";
import type { UserProfile } from "../../../services/users";

vi.mock("../../../context/NotificationContext", () => ({
  useNotifications: () => ({
    unreadCount: 0,
    notifications: [],
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    dismiss: vi.fn(),
    soundEnabled: false,
    toggleSound: vi.fn(),
  }),
}));

vi.mock("../../../context/NavigationContext", async () => {
  const actual = await vi.importActual<typeof import("../../../context/NavigationContext")>(
    "../../../context/NavigationContext",
  );
  return { ...actual, useNavigationContext: () => ({ screen: "lobby" }) };
});

const profile = { uid: "u1", username: "sk8er" } as unknown as UserProfile;

function renderHeader() {
  return render(
    <MemoryRouter>
      <LobbyHeader
        profile={profile}
        games={[]}
        onViewRecord={vi.fn()}
        onOpenGame={vi.fn()}
        onOpenSettings={vi.fn()}
        onSignOut={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("HubbaIcons flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("off (default)", () => {
    it("bell keeps the legacy glyph", () => {
      const { container } = render(<BellGlyph size="16" />);
      expect(container.querySelector(".hb-icon")).toBeNull();
      expect(container.querySelector("svg")).not.toBeNull();
    });

    it("tab bar and settings button keep the legacy icons", () => {
      render(
        <MemoryRouter>
          <BottomNav />
        </MemoryRouter>,
      );
      expect(document.querySelector(".hb-icon")).toBeNull();
      renderHeader();
      expect(screen.getByRole("button", { name: "Settings" }).querySelector(".hb-icon")).toBeNull();
    });
  });

  describe("on", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_FEATURE_HUBBA_ICONS", "true");
    });

    it("bell renders the HubbaIcons glyph", () => {
      const { container } = render(<BellGlyph size="20" />);
      expect(container.querySelector(".hb-icon")).not.toBeNull();
    });

    it("tab bar and settings button render HubbaIcons", () => {
      render(
        <MemoryRouter>
          <BottomNav />
        </MemoryRouter>,
      );
      expect(screen.getByRole("link", { name: "Home" }).querySelector(".hb-icon")).not.toBeNull();
      renderHeader();
      expect(screen.getByRole("button", { name: "Settings" }).querySelector(".hb-icon")).not.toBeNull();
    });
  });
});

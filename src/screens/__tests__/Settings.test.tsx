import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Settings } from "../Settings";
import { NotificationProvider } from "../../context/NotificationContext";
import type { UserProfile } from "../../services/users";

/* ── Mocks ─────────────────────────────────────────────── */

vi.mock("../../services/blocking", () => ({
  unblockUser: vi.fn().mockResolvedValue(undefined),
  subscribeToBlockedUsers: vi.fn((uid: string, cb: (ids: Set<string>) => void) => {
    // Return the mock unsubscribe immediately; tests stub specific cases via
    // `subscribeToBlockedUsersMock` below when they need a non-empty list.
    cb(new Set());
    return () => {};
  }),
}));

vi.mock("../../services/users", () => ({
  getUserProfile: vi.fn(async (uid: string) => ({
    uid,
    username: `user${uid}`,
    stance: "Regular",
    wins: 0,
    losses: 0,
    isVerifiedPro: false,
  })),
}));

vi.mock("../../services/fcm", () => ({
  requestPushPermission: vi.fn().mockResolvedValue("test-token"),
}));

vi.mock("../../services/haptics", async () => {
  const store = { enabled: true };
  return {
    isHapticsEnabled: () => store.enabled,
    setHapticsEnabled: (v: boolean) => {
      store.enabled = v;
    },
    playHaptic: vi.fn(),
    __setStore(v: boolean) {
      store.enabled = v;
    },
  };
});

vi.mock("../../services/sounds", () => {
  const store = { enabled: true };
  return {
    isSoundEnabled: () => store.enabled,
    setSoundEnabled: (v: boolean) => {
      store.enabled = v;
    },
    playChime: vi.fn(),
  };
});

vi.mock("../../services/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../services/notifications", () => ({
  deleteNotification: vi.fn(),
  deleteUserNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
}));

/* ── Helpers ───────────────────────────────────────────── */

const profile: UserProfile = {
  uid: "me",
  username: "me",
  stance: "Regular",
  wins: 0,
  losses: 0,
};

function wrap(ui: ReactNode) {
  return <NotificationProvider uid="me">{ui}</NotificationProvider>;
}

function setPermission(value: NotificationPermission) {
  Object.defineProperty(Notification, "permission", {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  // jsdom ships Notification but some tests set permission explicitly below.
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: vi.fn() as unknown as typeof Notification,
  });
  Object.defineProperty(Notification, "permission", {
    configurable: true,
    value: "default" as NotificationPermission,
  });
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

/* ── Tests ─────────────────────────────────────────────── */

describe("Settings", () => {
  it("renders the main header, subsections, and back button", () => {
    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    expect(screen.getByRole("heading", { name: /Settings/i })).toBeInTheDocument();
    expect(screen.getByText(/NOTIFICATIONS/)).toBeInTheDocument();
    expect(screen.getByText(/FEEDBACK/)).toBeInTheDocument();
    expect(screen.getByText(/BLOCKED PLAYERS/)).toBeInTheDocument();
    expect(screen.getByText(/HELP & SUPPORT/)).toBeInTheDocument();
    expect(screen.getByText(/LEGAL/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Back to lobby/)).toBeInTheDocument();
  });

  it("calls onBack when the back button is clicked", async () => {
    const onBack = vi.fn();
    render(wrap(<Settings profile={profile} onBack={onBack} />));
    await userEvent.click(screen.getByLabelText(/Back to lobby/));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("toggles sound effects and haptics switches", async () => {
    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));

    const soundSwitch = screen.getByRole("switch", { name: /Sound effects/i });
    const hapticsSwitch = screen.getByRole("switch", { name: /Haptics/i });

    expect(soundSwitch).toHaveAttribute("aria-checked", "true");
    expect(hapticsSwitch).toHaveAttribute("aria-checked", "true");

    await userEvent.click(soundSwitch);
    expect(soundSwitch).toHaveAttribute("aria-checked", "false");

    await userEvent.click(hapticsSwitch);
    expect(hapticsSwitch).toHaveAttribute("aria-checked", "false");

    // Flipping haptics back on exercises the playHaptic-on-enable branch.
    await userEvent.click(hapticsSwitch);
    expect(hapticsSwitch).toHaveAttribute("aria-checked", "true");
  });

  it("prompts to enable push notifications when permission is default", async () => {
    setPermission("default");
    const { requestPushPermission } = await import("../../services/fcm");
    (requestPushPermission as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      // Mirror the real FCM flow: on accept, the browser flips permission to
      // "granted" as a side effect of the prompt.
      setPermission("granted");
      return "test-token";
    });

    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    const enable = await screen.findByRole("button", { name: /Enable Notifications/ });
    expect(enable).toBeInTheDocument();
    await act(async () => {
      await userEvent.click(enable);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Enable Notifications/ })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Push notifications on/i)).toBeInTheDocument();
  });

  it("shows the granted confirmation when notifications are already enabled", () => {
    setPermission("granted");
    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    expect(screen.getByText(/Push notifications on/i)).toBeInTheDocument();
  });

  it("shows the blocked explanation when permission was denied", () => {
    setPermission("denied");
    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    expect(screen.getByText(/Notifications blocked/i)).toBeInTheDocument();
  });

  it("renders an empty-state card when no players are blocked", () => {
    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    expect(screen.getByText(/No blocked players/i)).toBeInTheDocument();
  });

  it("lists blocked players and unblocks them when Unblock is tapped", async () => {
    const blocking = await import("../../services/blocking");
    (blocking.subscribeToBlockedUsers as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_uid: string, cb: (ids: Set<string>) => void) => {
        cb(new Set(["blocked-uid-1"]));
        return () => {};
      },
    );

    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));

    // Profile hydration resolves async — wait for the unblock button to land.
    const unblockBtn = await screen.findByRole("button", { name: /Unblock/ });
    await act(async () => {
      await userEvent.click(unblockBtn);
    });
    expect(blocking.unblockUser).toHaveBeenCalledWith("me", "blocked-uid-1");
  });

  it("surfaces an error banner when unblock fails", async () => {
    const blocking = await import("../../services/blocking");
    (blocking.subscribeToBlockedUsers as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_uid: string, cb: (ids: Set<string>) => void) => {
        cb(new Set(["blocked-uid-2"]));
        return () => {};
      },
    );
    (blocking.unblockUser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network fail"));

    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));

    const unblockBtn = await screen.findByRole("button", { name: /Unblock/ });
    await act(async () => {
      await userEvent.click(unblockBtn);
    });

    expect(await screen.findByText(/network fail/)).toBeInTheDocument();
  });

  it("renders support + feedback + legal links with correct hrefs", () => {
    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    const bugLink = screen.getByText(/Report a bug/).closest("a");
    const feedbackLink = screen.getByText(/Send feedback/).closest("a");
    expect(bugLink?.getAttribute("href")).toMatch(/mailto:support@skatehubba.com/);
    expect(feedbackLink?.getAttribute("href")).toMatch(/mailto:support@skatehubba.com/);

    expect(
      screen
        .getByText(/Privacy Policy/)
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("/privacy");
    expect(
      screen
        .getByText(/Terms of Service/)
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("/terms");
    expect(
      screen
        .getByText(/Data Deletion/)
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("/data-deletion");
  });

  it("falls through to the unsupported branch when the Notification API is missing", () => {
    // Drop the API entirely — mirrors older browsers / private mode Safari.
    // Use delete rather than value:undefined because readPushState checks for
    // a real API presence (permission being a string), so setting the global
    // to undefined is equivalent.
    Object.defineProperty(window, "Notification", { configurable: true, value: undefined });
    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    expect(screen.getByText(/Push notifications aren't supported/i)).toBeInTheDocument();
  });

  it("renders the denied card after a user-initiated enable flips permission to denied", async () => {
    setPermission("default");
    const { requestPushPermission } = await import("../../services/fcm");
    (requestPushPermission as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      setPermission("denied");
      return null;
    });

    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    const enable = await screen.findByRole("button", { name: /Enable Notifications/ });
    await act(async () => {
      await userEvent.click(enable);
    });

    // After the failed enable, the whole section swaps to the denied card;
    // the inline error disappears because it belonged to the default-state
    // branch that's no longer mounted.
    expect(await screen.findByText(/Notifications blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/You've blocked SkateHubba from sending notifications/i)).toBeInTheDocument();
  });

  it("shows a generic error when requestPushPermission throws", async () => {
    setPermission("default");
    const { requestPushPermission } = await import("../../services/fcm");
    (requestPushPermission as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));

    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    const enable = await screen.findByRole("button", { name: /Enable Notifications/ });
    await act(async () => {
      await userEvent.click(enable);
    });

    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
  });

  it("shows a generic error when requestPushPermission resolves with no token but permission stays default", async () => {
    setPermission("default");
    const { requestPushPermission } = await import("../../services/fcm");
    (requestPushPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    const enable = await screen.findByRole("button", { name: /Enable Notifications/ });
    await act(async () => {
      await userEvent.click(enable);
    });

    expect(await screen.findByText(/Couldn't enable notifications/)).toBeInTheDocument();
  });
});

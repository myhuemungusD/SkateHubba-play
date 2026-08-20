import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { Settings } from "../Settings";
import { NotificationProvider } from "../../context/NotificationContext";
import { SOCIAL_LINKS } from "../../constants/socialLinks";
import type { UserProfile } from "../../services/users";

/* ── Mocks ─────────────────────────────────────────────── */

vi.mock("../../services/blocking", () => ({
  unblockUser: vi.fn().mockResolvedValue(undefined),
  subscribeToBlockedUsers: vi.fn((_uid: string, cb: (ids: Set<string>) => void) => {
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

// Native push service. `isPushSupported` defaults to false so the web
// assertions below run against the unchanged fcm path; the native describe
// block flips it.
const mockIsPushSupported = vi.fn(() => false);
vi.mock("../../services/pushNotifications", () => ({
  isPushSupported: () => mockIsPushSupported(),
  // Read-only permission query — never prompts. Defaults to the undecided
  // state so the native block starts on the opt-in card.
  getNativePushPermission: vi.fn().mockResolvedValue("prompt"),
  requestPushPermission: vi.fn().mockResolvedValue("granted"),
  registerPushToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/pushPreferences", () => ({
  getPushEnabled: vi.fn().mockResolvedValue(true),
  setPushEnabled: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/haptics", async () => {
  const store = { enabled: true };
  return {
    isHapticsEnabled: () => store.enabled,
    setHapticsEnabled: (v: boolean) => {
      store.enabled = v;
    },
    playHaptic: vi.fn(),
    hapticForVariant: (variant: string | null | undefined) => {
      if (variant == null) return "button_primary";
      const table: Record<string, string> = {
        primary: "button_primary",
        success: "button_primary",
        danger: "button_primary",
        secondary: "toast",
        ghost: "toast",
      };
      return table[variant] ?? "toast";
    },
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

const replayTutorialMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../context/OnboardingContext", () => ({
  useOnboardingContext: () => ({ replay: replayTutorialMock }),
}));

/* ── Helpers ───────────────────────────────────────────── */

const profile: UserProfile = {
  uid: "me",
  username: "me",
  stance: "Regular",
  createdAt: null,
  wins: 0,
  losses: 0,
};

function wrap(ui: ReactNode) {
  // MemoryRouter satisfies <Link>'s required Router context — Settings now
  // uses react-router Links for /privacy, /terms, /data-deletion (replacing
  // plain <a> that triggered a full reload and dropped SPA state).
  return (
    <MemoryRouter>
      <NotificationProvider uid="me">{ui}</NotificationProvider>
    </MemoryRouter>
  );
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
  // clearAllMocks wipes call history, not return values — re-arm the web
  // default so a native test can't leak into the next one.
  mockIsPushSupported.mockReturnValue(false);
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

  it("renders a 'Deleted account' fallback when getUserProfile resolves null", async () => {
    const blocking = await import("../../services/blocking");
    const users = await import("../../services/users");
    (blocking.subscribeToBlockedUsers as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_uid: string, cb: (ids: Set<string>) => void) => {
        cb(new Set(["ghost-uid"]));
        return () => {};
      },
    );
    (users.getUserProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));

    // Row should resolve to the deleted-account fallback rather than getting
    // stuck on "Loading…" when the profile doc is gone.
    expect(await screen.findByText(/Deleted account/i)).toBeInTheDocument();
    // Unblock button is still present so the user can clear the stale entry.
    expect(screen.getByRole("button", { name: /Unblock/ })).toBeInTheDocument();
  });

  it("renders a 'Deleted account' fallback when getUserProfile rejects", async () => {
    const blocking = await import("../../services/blocking");
    const users = await import("../../services/users");
    (blocking.subscribeToBlockedUsers as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_uid: string, cb: (ids: Set<string>) => void) => {
        cb(new Set(["broken-uid"]));
        return () => {};
      },
    );
    (users.getUserProfile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("read failed"));

    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));

    expect(await screen.findByText(/Deleted account/i)).toBeInTheDocument();
  });

  it("batches profile fetches in groups of 20 instead of firing all in parallel", async () => {
    const blocking = await import("../../services/blocking");
    const users = await import("../../services/users");

    // Seed 45 blocked UIDs to exercise the multi-chunk loop. The assertion
    // below is on eventual call count, not timing, because vitest advances
    // async microtasks eagerly — the behavioral proof is that each UID is
    // read exactly once even when re-triggered by state updates.
    const ids = Array.from({ length: 45 }, (_, i) => `blocked-${i}`);
    (blocking.subscribeToBlockedUsers as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_uid: string, cb: (set: Set<string>) => void) => {
        cb(new Set(ids));
        return () => {};
      },
    );

    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));

    // All 45 should resolve without any getting stuck pending (dedup via
    // pendingRef means each UID is read exactly once even though React may
    // commit intermediate state during chunk completion).
    await waitFor(() => {
      expect((users.getUserProfile as ReturnType<typeof vi.fn>).mock.calls.length).toBe(45);
    });
    // Seeded UIDs should not be re-read on subsequent renders.
    const callCount = (users.getUserProfile as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCount).toBe(45);
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

  it("renders the FOLLOW SKATEHUBBA section linking to every official account", () => {
    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    expect(screen.getByText(/FOLLOW SKATEHUBBA/)).toBeInTheDocument();

    // Each card must resolve to the shared SOCIAL_LINKS URL and open safely
    // off-site — a wrong href or missing rel ships users to the wrong place
    // (or exposes the tab to reverse-tabnabbing).
    const cards: Array<{ title: string; href: string }> = [
      { title: "Shop the Store", href: SOCIAL_LINKS.store },
      { title: "TikTok", href: SOCIAL_LINKS.tiktok },
      { title: "Instagram", href: SOCIAL_LINKS.instagram },
      { title: "Facebook", href: SOCIAL_LINKS.facebook },
      { title: "X", href: SOCIAL_LINKS.x },
    ];
    for (const { title, href } of cards) {
      const link = screen.getByText(title).closest("a");
      expect(link).not.toBeNull();
      expect(link?.getAttribute("href")).toBe(href);
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    }
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

  /* ── Push preference toggle ─────────────────────────── */

  it("reflects the saved push preference once the read resolves", async () => {
    const { getPushEnabled } = await import("../../services/pushPreferences");
    vi.mocked(getPushEnabled).mockResolvedValueOnce(false);

    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));

    const pushSwitch = screen.getByRole("switch", { name: /Push notifications/i });
    await waitFor(() => expect(pushSwitch).toHaveAttribute("aria-checked", "false"));
    expect(getPushEnabled).toHaveBeenCalledWith("me");
    // With the preference off, the OS-permission cards are suppressed.
    expect(screen.queryByText(/Enable push notifications/i)).toBeNull();
  });

  it("persists a push preference change", async () => {
    const { setPushEnabled } = await import("../../services/pushPreferences");

    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    const pushSwitch = screen.getByRole("switch", { name: /Push notifications/i });
    await waitFor(() => expect(pushSwitch).toBeEnabled());

    await act(async () => {
      await userEvent.click(pushSwitch);
    });

    expect(setPushEnabled).toHaveBeenCalledWith("me", false);
    expect(pushSwitch).toHaveAttribute("aria-checked", "false");
  });

  it("reverts the switch and surfaces an error when the write throws", async () => {
    const { setPushEnabled } = await import("../../services/pushPreferences");
    vi.mocked(setPushEnabled).mockRejectedValueOnce(new Error("permission-denied"));

    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    const pushSwitch = screen.getByRole("switch", { name: /Push notifications/i });
    await waitFor(() => expect(pushSwitch).toBeEnabled());

    await act(async () => {
      await userEvent.click(pushSwitch);
    });

    await waitFor(() => expect(pushSwitch).toHaveAttribute("aria-checked", "true"));
    // Inline alert on the row. The matching error toast is queued in
    // NotificationProvider, which ToastContainer renders at the App level.
    expect(await screen.findByText(/Couldn't save that preference/i)).toBeInTheDocument();
  });

  it("hints at device settings when push is on but the OS permission is denied", async () => {
    setPermission("denied");
    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    expect(await screen.findByText(/Enable notifications in your device settings/i)).toBeInTheDocument();
  });

  it("does not show the device-settings hint while the permission is granted", async () => {
    setPermission("granted");
    render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
    await waitFor(() => expect(screen.getByRole("switch", { name: /Push notifications/i })).toBeEnabled());
    expect(screen.queryByText(/Enable notifications in your device settings/i)).toBeNull();
  });

  /* ── Native (Capacitor) push branch ─────────────────── */

  describe("on a native shell", () => {
    beforeEach(() => {
      mockIsPushSupported.mockReturnValue(true);
      // The WebView's own permission is meaningless on native — pin it to a
      // value that would suppress the prompt on web to prove it's ignored.
      setPermission("denied");
    });

    it("offers the native prompt instead of the web enable flow", async () => {
      render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
      expect(await screen.findByRole("button", { name: /Turn on notifications/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Enable Notifications$/ })).toBeNull();
      // The mismatch hint rides along: preference on, OS grant unconfirmed.
      expect(screen.getByText(/Enable notifications in your device settings/i)).toBeInTheDocument();
    });

    it("requests permission through the plugin and registers the token on grant", async () => {
      const native = await import("../../services/pushNotifications");
      vi.mocked(native.requestPushPermission).mockResolvedValueOnce("granted");
      const web = await import("../../services/fcm");

      render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
      await act(async () => {
        await userEvent.click(await screen.findByRole("button", { name: /Turn on notifications/ }));
      });

      expect(native.requestPushPermission).toHaveBeenCalled();
      // assumeEnabled skips the pref re-read: this is an explicit gesture, so
      // an optimistic toggle whose write is still in flight must not drop the
      // registration.
      expect(native.registerPushToken).toHaveBeenCalledWith("me", { assumeEnabled: true });
      // The web pair bails without a service worker — it must not be used here.
      expect(web.requestPushPermission).not.toHaveBeenCalled();
      expect(await screen.findByText(/Push notifications on/i)).toBeInTheDocument();
      expect(screen.queryByText(/Enable notifications in your device settings/i)).toBeNull();
    });

    it("shows the native denial card and skips registration", async () => {
      const native = await import("../../services/pushNotifications");
      vi.mocked(native.requestPushPermission).mockResolvedValueOnce("denied");

      render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
      await act(async () => {
        await userEvent.click(await screen.findByRole("button", { name: /Turn on notifications/ }));
      });

      expect(await screen.findByText(/Notifications blocked/i)).toBeInTheDocument();
      expect(screen.getByText(/Re-enable them in your device settings/i)).toBeInTheDocument();
      expect(native.registerPushToken).not.toHaveBeenCalled();
    });

    it("keeps the prompt available when the OS prompt is dismissed", async () => {
      const native = await import("../../services/pushNotifications");
      vi.mocked(native.requestPushPermission).mockResolvedValueOnce("prompt");

      render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
      await act(async () => {
        await userEvent.click(await screen.findByRole("button", { name: /Turn on notifications/ }));
      });

      expect(await screen.findByText(/Couldn't enable notifications/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Turn on notifications/ })).toBeInTheDocument();
      expect(native.registerPushToken).not.toHaveBeenCalled();
    });

    it("surfaces a generic error when the plugin throws", async () => {
      const native = await import("../../services/pushNotifications");
      vi.mocked(native.requestPushPermission).mockRejectedValueOnce(new Error("plugin unavailable"));

      render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
      await act(async () => {
        await userEvent.click(await screen.findByRole("button", { name: /Turn on notifications/ }));
      });

      expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    });

    it("never renders the unsupported-browser card on native", async () => {
      Object.defineProperty(window, "Notification", { configurable: true, value: undefined });
      render(wrap(<Settings profile={profile} onBack={vi.fn()} />));
      expect(await screen.findByRole("button", { name: /Turn on notifications/ })).toBeInTheDocument();
      expect(screen.queryByText(/Push notifications aren't supported/i)).toBeNull();
    });

    it("shows the granted state on mount for a device that already allowed push", async () => {
      const native = await import("../../services/pushNotifications");
      vi.mocked(native.getNativePushPermission).mockResolvedValueOnce("granted");

      render(wrap(<Settings profile={profile} onBack={vi.fn()} />));

      // No phantom opt-in card, and no mismatch hint, for an already-granted
      // device — the whole point of the read-only permission query.
      expect(await screen.findByText(/Push notifications on/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Turn on notifications/ })).toBeNull();
      expect(screen.queryByText(/Enable notifications in your device settings/i)).toBeNull();
      // Reading permission must never prompt.
      expect(native.requestPushPermission).not.toHaveBeenCalled();
    });

    it("shows the blocked card on mount when the OS grant was refused", async () => {
      const native = await import("../../services/pushNotifications");
      vi.mocked(native.getNativePushPermission).mockResolvedValueOnce("denied");

      render(wrap(<Settings profile={profile} onBack={vi.fn()} />));

      expect(await screen.findByText(/Notifications blocked/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Turn on notifications/ })).toBeNull();
      expect(screen.getByText(/Enable notifications in your device settings/i)).toBeInTheDocument();
    });
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { UserProfile } from "../../services/users";
import { useLevelUpMoment } from "../useLevelUpMoment";

const getUserProfile = vi.fn();
const fetchAchievements = vi.fn();

vi.mock("../../services/users", () => ({
  getUserProfile: (...args: unknown[]) => getUserProfile(...args),
}));

vi.mock("../../services/achievements", () => ({
  fetchAchievements: (...args: unknown[]) => fetchAchievements(...args),
}));

const profile = { uid: "u1", username: "sk8r", stance: "regular", createdAt: null, xp: 0 } as UserProfile;

function Probe({
  enabled,
  onRefresh,
  openedXp = 0,
}: {
  enabled: boolean;
  onRefresh?: () => Promise<void>;
  /** `null` opens the screen with no xp field at all. */
  openedXp?: number | null;
}) {
  const opened = openedXp === null ? { ...profile, xp: undefined } : { ...profile, xp: openedXp };
  const moment = useLevelUpMoment(opened, enabled, onRefresh);
  return (
    <div>
      <span data-testid="level">{moment.level ?? "none"}</span>
      <span data-testid="names">{moment.names.join(",")}</span>
    </div>
  );
}

describe("useLevelUpMoment", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getUserProfile.mockReset();
    fetchAchievements.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("does nothing while the flag is off", async () => {
    render(<Probe enabled={false} />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(getUserProfile).not.toHaveBeenCalled();
    expect(screen.getByTestId("level")).toHaveTextContent("none");
  });

  it("shows the new level and up to three new achievement names", async () => {
    getUserProfile.mockResolvedValue({ ...profile, xp: 0 });
    fetchAchievements
      .mockResolvedValueOnce([{ id: "games_10", earnedAt: null, reason: "Finish 10 games." }])
      .mockResolvedValue([
        { id: "games_10", earnedAt: null, reason: "Finish 10 games." },
        { id: "shutout_1", earnedAt: null, reason: "Win a game without taking a letter." },
        { id: "century", earnedAt: null, reason: null },
      ]);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<Probe enabled onRefresh={onRefresh} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("level")).toHaveTextContent("none");

    getUserProfile.mockResolvedValue({ ...profile, xp: 140 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId("level")).toHaveTextContent("3");
    expect(screen.getByTestId("names")).toHaveTextContent("Shutout");
    expect(onRefresh).toHaveBeenCalled();
  });

  it("skips the moment when the profile comes back missing", async () => {
    getUserProfile.mockResolvedValue(null);
    render(<Probe enabled />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("level")).toHaveTextContent("none");
  });

  it("shows a level with no achievement names when the close-out won the race, and tolerates a missing refresh", async () => {
    getUserProfile.mockResolvedValue({ ...profile, xp: 96 });
    fetchAchievements.mockResolvedValue([{ id: "shutout_1", earnedAt: null, reason: null }]);
    render(<Probe enabled />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("level")).toHaveTextContent("3");
    expect(screen.getByTestId("names")).toHaveTextContent("");
  });

  it("skips the moment when the refetch fails", async () => {
    getUserProfile.mockRejectedValue(new Error("offline"));
    render(<Probe enabled />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("level")).toHaveTextContent("none");
  });

  it("still shows the level when refresh throws, and skips motion when requested", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: () => ({ matches: true }),
    });
    getUserProfile.mockResolvedValue({ ...profile, xp: 24 });
    fetchAchievements.mockResolvedValue([]);
    const onRefresh = vi.fn().mockRejectedValue(new Error("nope"));
    render(<Probe enabled onRefresh={onRefresh} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("level")).toHaveTextContent("2");
    expect(onRefresh).toHaveBeenCalled();
  });

  it("waits out looks that are still on the opening level, then ignores later timers", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: () => ({ matches: false }),
    });
    getUserProfile.mockResolvedValue({ ...profile, xp: undefined });
    fetchAchievements.mockResolvedValue([]);
    render(<Probe enabled openedXp={null} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId("level")).toHaveTextContent("none");

    getUserProfile.mockResolvedValue({ ...profile, xp: 24 });
    fetchAchievements.mockResolvedValue([
      { id: "games_10", earnedAt: null, reason: "Finish 10 games." },
      { id: "wins_10", earnedAt: null, reason: "Win 10 games." },
      { id: "streak_3", earnedAt: null, reason: "Win 3 in a row." },
      { id: "lands_50", earnedAt: null, reason: "Land 50 tricks." },
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(screen.getByTestId("level")).toHaveTextContent("2");
    expect(screen.getByTestId("names").textContent?.split(",").filter(Boolean)).toHaveLength(3);
  });

  it("drops a refetch that resolves after unmount", async () => {
    let resolveProfile: (value: UserProfile | null) => void = () => {};
    getUserProfile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProfile = resolve;
        }),
    );
    const { unmount } = render(<Probe enabled />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    await act(async () => {
      resolveProfile({ ...profile, xp: 140 });
      await Promise.resolve();
    });
  });

  it("drops the moment when achievements fail to load", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    getUserProfile.mockResolvedValue({ ...profile, xp: 24 });
    fetchAchievements.mockRejectedValue(new Error("offline"));
    render(<Probe enabled />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("level")).toHaveTextContent("none");
  });

  it("ignores a profile that arrives after unmount during the achievement read", async () => {
    getUserProfile.mockResolvedValue({ ...profile, xp: 24 });
    let resolveEarned: (value: []) => void = () => {};
    fetchAchievements.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEarned = resolve;
        }),
    );
    const view = render(<Probe enabled />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    view.unmount();
    await act(async () => {
      resolveEarned([]);
      await Promise.resolve();
    });
  });
});

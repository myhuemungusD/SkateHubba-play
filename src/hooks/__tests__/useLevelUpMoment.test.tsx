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

function Probe({ enabled, onRefresh }: { enabled: boolean; onRefresh?: () => Promise<void> }) {
  const moment = useLevelUpMoment(profile, enabled, onRefresh);
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
    fetchAchievements.mockResolvedValueOnce([]).mockResolvedValue([
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
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
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
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LobbyTimer } from "../LobbyTimer";

describe("LobbyTimer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when deadline is 0", () => {
    const { container } = render(<LobbyTimer deadline={0} isMyTurn={true} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows time remaining with hours and minutes", () => {
    const deadline = Date.now() + 5 * 3_600_000; // 5 hours
    render(<LobbyTimer deadline={deadline} isMyTurn={true} />);
    expect(screen.getByLabelText(/Time remaining/)).toBeInTheDocument();
  });

  it("shows Expired when deadline has passed", () => {
    const deadline = Date.now() - 1000;
    // deadline > 0 but already passed: the effect should set "Expired"
    render(<LobbyTimer deadline={deadline} isMyTurn={true} />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  // Fake clock + interval so the 1s tick runs on every run. Before this, the
  // interval body was only covered when some other lobby test happened to
  // stay mounted past one real second, so coverage flipped between runs.
  it("ticks every second under an hour, then stops at Expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
    render(<LobbyTimer deadline={Date.now() + 61_000} isMyTurn={false} />);
    expect(screen.getByLabelText("Time remaining: 1m 1s")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByLabelText("Time remaining: 1m 0s")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Expired")).toBeInTheDocument();
    // The interval clears itself once the deadline passes.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the interval on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<LobbyTimer deadline={Date.now() + 61_000} isMyTurn={true} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

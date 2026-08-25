import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PlayerProfileScreen } from "../PlayerProfileScreen";
import { buildBaseProps, fetchedState } from "./playerProfile.test-helpers";
// Cross-directory on purpose: the locker fixture is owned by the component
// suite that asserts its rendering, and this spec only needs "a valid item".
import { buildLockerItem } from "../../components/__tests__/economy.test-helpers";

/**
 * Failure coverage for the controller's Economy Phase A reads (badges +
 * locker).
 *
 * These are cosmetics fetches layered onto a profile that must render without
 * them, so the controller settles the two promises independently. The
 * contracts asserted here are the ones a `Promise.all` would silently break:
 *
 *   - one section failing must not blank the other,
 *   - neither failure may surface the screen's error state or wedge `loading`,
 *   - every rejection reaches `logger.warn` (Sentry breadcrumb) rather than
 *     being swallowed, carrying the parsed reason.
 *
 * `utils/helpers` is deliberately NOT mocked here — the catch path runs the
 * real `parseFirebaseError`, which is the thing that turns a bare Firebase
 * error object into the logged string.
 */

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
  analytics: { profileViewed: vi.fn(), profileStatTileTapped: vi.fn() },
}));

vi.mock("../../services/blocking", () => ({
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
}));

vi.mock("../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockFetchAchievements = vi.fn();
const mockFetchLockerItems = vi.fn();
vi.mock("../../services/achievements", () => ({
  fetchAchievements: (...args: unknown[]) => mockFetchAchievements(...args),
}));
vi.mock("../../services/locker", () => ({
  fetchLockerItems: (...args: unknown[]) => mockFetchLockerItems(...args),
}));

vi.mock("../../hooks/usePlayerProfile", () => ({
  usePlayerProfile: () => fetchedState(),
}));

import { logger } from "../../services/logger";
const loggerMock = vi.mocked(logger);

const ownProfileProps = buildBaseProps();

/** A granted badge the BadgesRow knows how to render. */
const centuryBadge = { id: "century", earnedAt: null, reason: null };

/** A single locker item, enough to prove the grid populated. */
const deck = buildLockerItem({ id: "d1" });

describe("PlayerProfileScreen — Economy Phase A fetch failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the badges row when only the locker read is rejected", async () => {
    mockFetchAchievements.mockResolvedValue([centuryBadge]);
    mockFetchLockerItems.mockRejectedValue({ code: "permission-denied", message: "Missing permissions" });

    render(<PlayerProfileScreen {...ownProfileProps} />);

    expect(await screen.findByTestId("badges-row")).toBeInTheDocument();
    expect(screen.getByText("CENTURY")).toBeInTheDocument();
    // Own empty locker still shows its hint card — the failure reads as
    // "nothing earned yet", not as a broken section.
    expect(screen.getByTestId("locker-empty-hint")).toBeInTheDocument();
    expect(loggerMock.warn).toHaveBeenCalledWith("profile_locker_load_failed", { error: "Missing permissions" });
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
  });

  it("keeps the locker when only the achievements read is rejected", async () => {
    mockFetchAchievements.mockRejectedValue(new Error("backend unavailable"));
    mockFetchLockerItems.mockResolvedValue([deck]);

    render(<PlayerProfileScreen {...ownProfileProps} />);

    expect(await screen.findByTestId("locker-item-d1")).toBeInTheDocument();
    expect(screen.getByText("Ledge Deck")).toBeInTheDocument();
    expect(screen.queryByTestId("badges-row")).not.toBeInTheDocument();
    expect(loggerMock.warn).toHaveBeenCalledWith("profile_achievements_load_failed", { error: "backend unavailable" });
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
  });

  it("still renders the profile when both reads are rejected", async () => {
    mockFetchAchievements.mockRejectedValue(new Error("nope"));
    mockFetchLockerItems.mockRejectedValue(new Error("also nope"));

    render(<PlayerProfileScreen {...ownProfileProps} />);

    // The record and stats are what the screen exists for — they paint even
    // though both cosmetics reads failed, and no error state is shown.
    expect(screen.getByText("@viewer")).toBeInTheDocument();
    expect(screen.getByText("Lifetime Wins")).toBeInTheDocument();
    expect(screen.getByLabelText("Best win streak: 0")).toBeInTheDocument();
    expect(screen.queryByText("Player not found")).not.toBeInTheDocument();

    await waitFor(() => expect(loggerMock.warn).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("badges-row")).not.toBeInTheDocument();
    expect(screen.getByTestId("locker-empty-hint")).toBeInTheDocument();
  });

  it("logs nothing and renders both sections when the reads succeed", async () => {
    mockFetchAchievements.mockResolvedValue([centuryBadge]);
    mockFetchLockerItems.mockResolvedValue([deck]);

    render(<PlayerProfileScreen {...ownProfileProps} />);

    expect(await screen.findByTestId("badges-row")).toBeInTheDocument();
    expect(screen.getByTestId("locker-item-d1")).toBeInTheDocument();
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it("drops a late resolution after unmount instead of setting state", async () => {
    let resolveAchievements: (v: unknown[]) => void = () => undefined;
    mockFetchAchievements.mockReturnValue(
      new Promise((resolve) => {
        resolveAchievements = resolve;
      }),
    );
    mockFetchLockerItems.mockResolvedValue([]);

    const { unmount } = render(<PlayerProfileScreen {...ownProfileProps} />);
    unmount();
    resolveAchievements([centuryBadge]);

    await waitFor(() => expect(mockFetchAchievements).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("badges-row")).not.toBeInTheDocument();
  });
});

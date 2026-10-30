import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { GameDoc } from "../../../../services/games";
import { buildCompletedGame } from "../../../__tests__/playerProfile.test-helpers";

const m = vi.hoisted(() => ({ shareText: vi.fn(), copyText: vi.fn(), trackEvent: vi.fn() }));

vi.mock("../../../../services/nativeBridge", () => ({ shareText: m.shareText, copyText: m.copyText }));
vi.mock("../../../../services/analytics", () => ({ trackEvent: m.trackEvent }));
vi.mock("../../../../components/TurnHistoryViewer", () => ({ TurnHistoryViewer: () => <div data-testid="turns" /> }));
vi.mock("../../../../components/GameReplay", () => ({ GameReplay: () => <div data-testid="replay" /> }));

import { GameHistoryCard } from "../GameHistoryCard";

function renderCard(game: GameDoc) {
  return render(<GameHistoryCard game={game} profileUid="me" expanded onToggle={vi.fn()} onOpenGame={vi.fn()} />);
}

beforeEach(() => {
  m.shareText.mockResolvedValue("clipboard");
  m.copyText.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("GameHistoryCard edges", () => {
  it("omits the date when the timestamp has no clock", () => {
    // Control: with a clock, the card shows a short "Mon D" date that the pattern matches.
    const { unmount } = renderCard(
      buildCompletedGame({ updatedAt: { toMillis: () => Date.UTC(2026, 3, 15, 12) } as GameDoc["updatedAt"] }),
    );
    expect(screen.getByText(/^[A-Z][a-z]{2} \d{1,2}$/)).toHaveTextContent("Apr 15");
    unmount();
    renderCard(buildCompletedGame({ updatedAt: {} as GameDoc["updatedAt"] }));
    expect(screen.queryByText(/^[A-Z][a-z]{2} \d{1,2}$/)).toBeNull();
  });

  it("says no clips were recorded for a finished game without turns", () => {
    renderCard(buildCompletedGame({ turnHistory: [] }));
    expect(screen.getByText("No clips available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share Game" })).toBeNull();
  });

  it("treats a forfeit doc with no turn history field as clipless", () => {
    renderCard(buildCompletedGame({ status: "forfeit", turnHistory: undefined }));
    expect(screen.getByText("Game ended by forfeit — no clips recorded")).toBeInTheDocument();
  });

  it("spells both players' letters in the copied recap and resets the label", async () => {
    vi.useFakeTimers();
    renderCard(buildCompletedGame({ p1Letters: 2, p2Letters: 5 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share Game" }));
    });
    const text = m.copyText.mock.calls[0][0] as string;
    expect(text).toContain("Final: @viewer S.K. | @sk8rboi S.K.A.T.E.");
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("button", { name: "Share Game" })).toBeInTheDocument();
  });

  it("shows Copy failed when the clipboard rejects, then recovers", async () => {
    vi.useFakeTimers();
    m.copyText.mockRejectedValue(new Error("denied"));
    renderCard(buildCompletedGame());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share Game" }));
    });
    expect(screen.getByRole("button", { name: "Copy failed" })).toBeInTheDocument();
    expect(m.trackEvent).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("button", { name: "Share Game" })).toBeInTheDocument();
  });

  it("clears a pending label timer on unmount", async () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = renderCard(buildCompletedGame());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share Game" }));
    });
    clear.mockClear();
    unmount();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

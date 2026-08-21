import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationRow } from "../NotificationRow";
import type { AppNotification } from "../../context/NotificationContext";

vi.mock("../../lib/notificationMeta", () => ({
  notificationIcon: { game_event: "🎮", success: "✅", error: "❌", info: "ℹ️" },
  notificationAccentText: {
    game_event: "text-orange",
    success: "text-green",
    error: "text-red",
    info: "text-blue",
  },
}));

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "n1",
    type: "game_event",
    title: "Your Turn",
    message: "Match kickflip",
    timestamp: Date.now(),
    read: false,
    ...overrides,
  };
}

function renderRow(props: Partial<React.ComponentProps<typeof NotificationRow>> = {}) {
  return render(
    <NotificationRow
      notification={makeNotification()}
      clickable
      loading={false}
      missing={false}
      onActivate={vi.fn()}
      onDismiss={vi.fn()}
      {...props}
    />,
  );
}

describe("NotificationRow timestamps", () => {
  it("renders 'just now' for a fresh notification", () => {
    renderRow();
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("renders minutes for an event under an hour old", () => {
    renderRow({ notification: makeNotification({ timestamp: Date.now() - 5 * 60_000 }) });
    expect(screen.getByText("5m ago")).toBeInTheDocument();
  });

  it("renders hours for an event under a day old", () => {
    renderRow({ notification: makeNotification({ timestamp: Date.now() - 3 * 3_600_000 }) });
    expect(screen.getByText("3h ago")).toBeInTheDocument();
  });

  it("renders days for anything older", () => {
    renderRow({ notification: makeNotification({ timestamp: Date.now() - 2 * 86_400_000 }) });
    expect(screen.getByText("2d ago")).toBeInTheDocument();
  });

  it("clamps a future timestamp to 'just now' instead of a negative age", () => {
    renderRow({ notification: makeNotification({ timestamp: Date.now() + 60_000 }) });
    expect(screen.getByText("just now")).toBeInTheDocument();
  });
});

describe("NotificationRow states", () => {
  it("swaps the timestamp for a loading label while the game is being fetched", () => {
    renderRow({ loading: true });
    expect(screen.getByText("Opening…")).toBeInTheDocument();
    expect(screen.getByText("Opening…").closest('[role="button"]')).toHaveAttribute("aria-busy", "true");
  });

  it("shows the unavailable alert when the game could not be resolved", () => {
    renderRow({ missing: true });
    expect(screen.getByRole("alert")).toHaveTextContent("That game is no longer available");
  });

  it("dismisses without activating the row", async () => {
    const onActivate = vi.fn();
    const onDismiss = vi.fn();
    renderRow({ onActivate, onDismiss });

    await userEvent.click(screen.getByLabelText("Delete notification"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });
});

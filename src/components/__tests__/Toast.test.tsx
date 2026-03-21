import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toast } from "../Toast";

vi.mock("../../lib/notificationMeta", () => ({
  notificationIcon: { game_event: "🎮", success: "✅", error: "❌", info: "ℹ️" },
  notificationAccentBg: { game_event: "bg-orange", success: "bg-green", error: "bg-red", info: "bg-blue" },
  notificationAccentText: { game_event: "text-orange", success: "text-green", error: "text-red", info: "text-blue" },
}));

const notification = {
  id: "n1",
  type: "game_event" as const,
  title: "Your Turn!",
  message: "Match the kickflip",
  timestamp: Date.now(),
  read: false,
};

describe("Toast", () => {
  it("renders title and message", () => {
    render(<Toast notification={notification} onDismiss={vi.fn()} />);
    expect(screen.getByText("Your Turn!")).toBeInTheDocument();
    expect(screen.getByText("Match the kickflip")).toBeInTheDocument();
  });

  it("renders with status role", () => {
    render(<Toast notification={notification} onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has a dismiss button", () => {
    render(<Toast notification={notification} onDismiss={vi.fn()} />);
    expect(screen.getByLabelText("Dismiss notification")).toBeInTheDocument();
  });
});

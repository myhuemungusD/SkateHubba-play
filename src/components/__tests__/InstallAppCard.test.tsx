import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallAppCard } from "../InstallAppCard";

const warn = vi.fn();
vi.mock("../../services/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: (...args: unknown[]) => warn(...args), error: vi.fn() },
}));

describe("InstallAppCard", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("confirms an existing install", () => {
    render(<InstallAppCard status="installed" onInstall={vi.fn()} />);
    expect(screen.getByText(/Installed on this device/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows Safari Share → Add to Home Screen steps on iOS", () => {
    render(<InstallAppCard status="ios" onInstall={vi.fn()} />);
    expect(screen.getByText("Add to Home Screen")).toBeInTheDocument();
    expect(screen.getByText(/tap the Share button/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("points at the browser menu when no prompt is available", () => {
    render(<InstallAppCard status="manual" onInstall={vi.fn()} />);
    expect(screen.getByText(/Open your browser's menu/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens the install dialog on tap and shows the pending hint while it is open", async () => {
    let resolveChoice: (outcome: "accepted") => void = () => {};
    const onInstall = vi.fn(
      () =>
        new Promise<"accepted">((resolve) => {
          resolveChoice = resolve;
        }),
    );
    render(<InstallAppCard status="prompt" onInstall={onInstall} />);

    const button = screen.getByRole("button", { name: /Install SkateHubba/ });
    await userEvent.click(button);
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(/Confirm in your browser/)).toBeInTheDocument();

    // A second tap while the dialog is open must not re-prompt.
    await userEvent.click(button);
    expect(onInstall).toHaveBeenCalledTimes(1);

    resolveChoice("accepted");
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByText(/Add it to your home screen/)).toBeInTheDocument();
  });

  it("logs and recovers when the browser refuses to open the dialog", async () => {
    const onInstall = vi.fn().mockRejectedValue(new Error("stale event"));
    render(<InstallAppCard status="prompt" onInstall={onInstall} />);
    await userEvent.click(screen.getByRole("button", { name: /Install SkateHubba/ }));
    await waitFor(() => expect(warn).toHaveBeenCalledWith("install_prompt_failed", { error: "Error: stale event" }));
    expect(screen.getByRole("button", { name: /Install SkateHubba/ })).toBeEnabled();
  });
});

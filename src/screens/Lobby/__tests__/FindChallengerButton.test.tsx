import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const svc = vi.hoisted(() => ({ getPlayerDirectory: vi.fn(), getBlockedUserIds: vi.fn() }));
vi.mock("../../../services/users", () => ({ getPlayerDirectory: svc.getPlayerDirectory }));
vi.mock("../../../services/blocking", () => ({ getBlockedUserIds: svc.getBlockedUserIds }));

import { FindChallengerButton } from "../components/FindChallengerButton";

const p = (uid: string) => ({ uid, username: `sk_${uid}` });

function setup(excludeUids: ReadonlySet<string> = new Set(), disabled = false) {
  const onChallengeUser = vi.fn();
  const onFallback = vi.fn();
  render(
    <FindChallengerButton
      viewerUid="me"
      excludeUids={excludeUids}
      disabled={disabled}
      onChallengeUser={onChallengeUser}
      onFallback={onFallback}
    />,
  );
  return { onChallengeUser, onFallback, button: screen.getByTestId("find-challenger") };
}

describe("FindChallengerButton", () => {
  beforeEach(() => {
    svc.getBlockedUserIds.mockResolvedValue(new Set(["blocked"]));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("picks a random skater, skipping self, blocked and current opponents", async () => {
    svc.getPlayerDirectory.mockResolvedValue([p("me"), p("blocked"), p("busy"), p("a"), p("b")]);
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const { onChallengeUser, onFallback, button } = setup(new Set(["busy"]));
    expect(button).toHaveTextContent("Find me a challenger");
    await userEvent.click(button);
    expect(svc.getBlockedUserIds).toHaveBeenCalledWith("me");
    expect(onChallengeUser).toHaveBeenCalledWith("sk_b");
    expect(onFallback).not.toHaveBeenCalled();
    expect(button).not.toBeDisabled();
  });

  it("shows progress while it looks", async () => {
    let resolve!: (v: unknown) => void;
    svc.getPlayerDirectory.mockReturnValue(new Promise((r) => (resolve = r)));
    const { button } = setup();
    await userEvent.click(button);
    expect(button).toHaveTextContent("Finding a challenger…");
    expect(button).toBeDisabled();
    resolve([]);
    expect(await screen.findByText("Find me a challenger")).toBeInTheDocument();
  });

  it("falls back to the challenge form when nobody is available", async () => {
    svc.getPlayerDirectory.mockResolvedValue([p("me"), p("blocked")]);
    const { onChallengeUser, onFallback, button } = setup();
    await userEvent.click(button);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onChallengeUser).not.toHaveBeenCalled();
  });

  it("falls back to the challenge form when the read fails", async () => {
    svc.getPlayerDirectory.mockRejectedValue(new Error("offline"));
    const { onFallback, button } = setup();
    await userEvent.click(button);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("is disabled for a viewer who can't challenge", () => {
    expect(setup(new Set(), true).button).toBeDisabled();
  });
});

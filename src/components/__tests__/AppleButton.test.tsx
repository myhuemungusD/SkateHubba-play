import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppleButton } from "../AppleButton";

describe("AppleButton", () => {
  it("calls onClick", async () => {
    const onClick = vi.fn();
    render(<AppleButton onClick={onClick} loading={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Apple" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows a busy label and ignores clicks while loading", async () => {
    const onClick = vi.fn();
    render(<AppleButton onClick={onClick} loading />);
    const button = screen.getByRole("button", { name: /Signing in/ });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("can be disabled while another sign-in is in progress", () => {
    render(<AppleButton onClick={vi.fn()} loading={false} disabled />);
    expect(screen.getByRole("button", { name: "Continue with Apple" })).toBeDisabled();
  });
});

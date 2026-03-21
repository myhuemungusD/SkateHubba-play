import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBanner } from "../ErrorBanner";

describe("ErrorBanner", () => {
  it("returns null when message is empty", () => {
    const { container } = render(<ErrorBanner message="" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders message with alert role", () => {
    render(<ErrorBanner message="Something went wrong" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows dismiss button when onDismiss is provided", async () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner message="Error" onDismiss={onDismiss} />);
    await userEvent.click(screen.getByLabelText("Dismiss error"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("hides dismiss button when onDismiss is not provided", () => {
    render(<ErrorBanner message="Error" />);
    expect(screen.queryByLabelText("Dismiss error")).not.toBeInTheDocument();
  });
});

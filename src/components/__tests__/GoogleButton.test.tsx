import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoogleButton } from "../GoogleButton";

describe("GoogleButton", () => {
  it("renders with default text", () => {
    render(<GoogleButton onClick={vi.fn()} loading={false} />);
    expect(screen.getByText("Continue with Google")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<GoogleButton onClick={vi.fn()} loading={true} />);
    expect(screen.getByText("Signing in…")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<GoogleButton onClick={onClick} loading={false} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

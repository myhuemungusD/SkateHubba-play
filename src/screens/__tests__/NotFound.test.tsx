import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotFound } from "../NotFound";

describe("NotFound", () => {
  it("renders BAIL! heading and brand name", () => {
    render(<NotFound onBack={vi.fn()} />);
    expect(screen.getByText("BAIL!")).toBeInTheDocument();
    expect(screen.getByAltText("SkateHubba")).toBeInTheDocument();
  });

  it("calls onBack when button is clicked", async () => {
    const onBack = vi.fn();
    render(<NotFound onBack={onBack} />);
    await userEvent.click(screen.getByText("Back to Lobby"));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

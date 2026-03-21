import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataDeletion } from "../DataDeletion";

describe("DataDeletion", () => {
  it("renders heading and brand name", () => {
    render(<DataDeletion onBack={vi.fn()} />);
    expect(screen.getByText("Data Deletion")).toBeInTheDocument();
    expect(screen.getByText("SKATEHUBBA™")).toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    render(<DataDeletion onBack={onBack} />);
    await userEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

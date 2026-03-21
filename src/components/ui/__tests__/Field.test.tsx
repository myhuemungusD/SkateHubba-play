import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Field } from "../Field";

describe("Field", () => {
  it("renders input with placeholder", () => {
    render(<Field value="" onChange={vi.fn()} placeholder="Enter text" />);
    expect(screen.getByPlaceholderText("Enter text")).toBeInTheDocument();
  });

  it("renders label linked to input", () => {
    render(<Field label="Username" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
  });

  it("calls onChange with input value", async () => {
    const onChange = vi.fn();
    render(<Field value="" onChange={onChange} placeholder="type" />);
    await userEvent.type(screen.getByPlaceholderText("type"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("renders note text when provided", () => {
    render(<Field value="" onChange={vi.fn()} note="Helper text" />);
    expect(screen.getByText("Helper text")).toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    const { container } = render(<Field value="" onChange={vi.fn()} icon="@" />);
    expect(container.querySelector("[aria-hidden]")?.textContent).toBe("@");
  });

  it("disables input when disabled prop is true", () => {
    render(<Field value="" onChange={vi.fn()} placeholder="test" disabled />);
    expect(screen.getByPlaceholderText("test")).toBeDisabled();
  });
});

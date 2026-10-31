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

  it("keeps the classic shape by default (rounded-xl, py-3.5, shadow, orange focus)", () => {
    render(<GoogleButton onClick={vi.fn()} loading={false} />);
    const cls = screen.getByRole("button").className.split(/\s+/);
    expect(cls).toEqual(
      expect.arrayContaining(["rounded-xl", "text-sm", "py-3.5", "focus-visible:outline-brand-orange"]),
    );
    expect(cls.some((c) => c.startsWith("shadow-["))).toBe(true);
    expect(cls).not.toContain("rounded-ct");
    expect(cls).not.toContain("h-[52px]");
  });

  it("renders the flat Landing v2 shape without a shadow", () => {
    render(<GoogleButton onClick={vi.fn()} loading={false} shape="flat" />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("rounded-ct");
    expect(btn.className).not.toContain("shadow");
  });
});

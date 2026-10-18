import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const svc = vi.hoisted(() => ({ list: vi.fn(), getPublic: vi.fn(), setPublic: vi.fn() }));
vi.mock("../../services/mapCheckins", () => ({
  listPassport: svc.list,
  getPassportPublic: svc.getPublic,
  setPassportPublic: svc.setPublic,
}));

import { SpotPassport } from "../SpotPassport";

const stamp = (over: Record<string, unknown>) => ({
  id: "a",
  spotId: "a",
  scope: "public",
  spotName: "El Toro",
  legendary: false,
  count: 1,
  firstAt: new Date("2026-10-01T12:00:00Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  svc.getPublic.mockResolvedValue(false);
  svc.setPublic.mockResolvedValue(undefined);
});

describe("SpotPassport", () => {
  it("shows the owner's stamps, legendary count, and private marker", async () => {
    svc.list.mockResolvedValueOnce([
      stamp({ legendary: true, count: 3 }),
      stamp({ id: "p_b", scope: "private", spotName: "Secret", firstAt: null }),
    ]);
    render(<SpotPassport uid="u1" isOwner />);
    await waitFor(() => expect(screen.getByTestId("spot-passport")).toBeInTheDocument());
    expect(screen.getByText(/2 spots · 1 legendary/)).toBeInTheDocument();
    expect(screen.getByLabelText("Legendary")).toBeInTheDocument();
    expect(screen.getByText("(private)")).toBeInTheDocument();
    expect(screen.getByText(/3×/)).toBeInTheDocument();
  });

  it("invites an owner with no stamps and toggles public, rolling back on failure", async () => {
    svc.list.mockResolvedValueOnce([]);
    render(<SpotPassport uid="u1" isOwner />);
    await waitFor(() => expect(screen.getByText(/first stamp/)).toBeInTheDocument());
    expect(screen.getByText(/0 spots/)).toBeInTheDocument();
    const box = screen.getByRole("checkbox");
    await userEvent.click(box);
    expect(svc.setPublic).toHaveBeenCalledWith("u1", true);
    expect(box).toBeChecked();
    svc.setPublic.mockRejectedValueOnce(new Error("no"));
    await userEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
  });

  it("shows one public stamp to a visitor without a toggle", async () => {
    svc.list.mockResolvedValueOnce([stamp({})]);
    render(<SpotPassport uid="u2" isOwner={false} />);
    await waitFor(() => expect(screen.getByText(/1 spot$/)).toBeInTheDocument());
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(svc.getPublic).not.toHaveBeenCalled();
  });

  it("renders nothing for a visitor when empty or denied", async () => {
    svc.list.mockResolvedValueOnce([]);
    const { container, unmount } = render(<SpotPassport uid="u2" isOwner={false} />);
    await waitFor(() => expect(svc.list).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();
    svc.list.mockRejectedValueOnce(new Error("denied"));
    const second = render(<SpotPassport uid="u2" isOwner={false} />);
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
    expect(second.container).toBeEmptyDOMElement();
  });

  it("ignores results after unmount", async () => {
    let resolve: (v: unknown) => void = () => {};
    svc.list.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { unmount } = render(<SpotPassport uid="u1" isOwner={false} />);
    unmount();
    resolve([stamp({})]);
    let reject: (e: unknown) => void = () => {};
    svc.list.mockReturnValueOnce(new Promise((_r, j) => (reject = j)));
    const again = render(<SpotPassport uid="u1" isOwner={false} />);
    again.unmount();
    reject(new Error("late"));
    await Promise.resolve();
  });
});

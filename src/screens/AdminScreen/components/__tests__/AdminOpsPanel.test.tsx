import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ list: vi.fn(), rule: vi.fn(), hide: vi.fn(), audit: vi.fn() }));
vi.mock("../../../../services/admin.disputes", () => ({ listDisputeQueue: h.list, ruleDispute: h.rule }));
vi.mock("../../../../services/admin", () => ({ hideDispute: h.hide }));
vi.mock("../../../../services/admin.audit", () => ({ listAdminAudit: h.audit }));

import { AdminOpsPanel } from "../AdminOpsPanel";

const dispute = (o: Record<string, unknown> = {}) => ({
  id: "d1",
  trickName: "kickflip",
  matcherUsername: "m",
  setterUsername: "s",
  matchVideoUrl: "v",
  landVotes: 2,
  bailVotes: 1,
  moderationStatus: "active",
  adminRuling: null,
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.list.mockResolvedValue([]);
  h.audit.mockResolvedValue([]);
});

describe("AdminOpsPanel", () => {
  it("rules, hides and shows rulings", async () => {
    h.list
      .mockResolvedValueOnce([
        dispute(),
        dispute({ id: "d2", moderationStatus: "hidden" }),
        dispute({ id: "d3", adminRuling: "land" }),
      ])
      .mockResolvedValue([]);
    h.rule.mockResolvedValue(undefined);
    render(<AdminOpsPanel />);
    expect(await screen.findByText("Ruled: LAND")).toBeInTheDocument();
    expect(screen.getByText(/1 bail · hidden/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "HIDE" })).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { name: "RULE BAIL" })[0]);
    expect(await screen.findByText("No open disputes.")).toBeInTheDocument();
    expect(h.rule).toHaveBeenCalledWith("d1", "bail");
  });

  it("hides and rules land, and reports failures", async () => {
    h.list.mockResolvedValue([dispute()]);
    h.hide.mockRejectedValueOnce(new Error("x"));
    h.rule.mockRejectedValueOnce(new Error("x"));
    render(<AdminOpsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "HIDE" }));
    expect(await screen.findByText("Couldn't hide that dispute.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "RULE LAND" }));
    expect(await screen.findByText("Couldn't save that ruling.")).toBeInTheDocument();
  });

  it("shows load errors", async () => {
    h.list.mockRejectedValue(new Error("x"));
    h.audit.mockRejectedValue(new Error("x"));
    render(<AdminOpsPanel />);
    expect(await screen.findByText("Couldn't load disputes.")).toBeInTheDocument();
    expect(await screen.findByText("Couldn't load the audit log.")).toBeInTheDocument();
  });

  it("lists audit entries", async () => {
    h.audit.mockResolvedValue([
      { id: "e1", adminUid: "a", action: "ban", targetId: "u", detail: "spam", atMs: 1 },
      { id: "e2", adminUid: "a", action: "custom", targetId: "t", detail: "", atMs: null },
    ]);
    render(<AdminOpsPanel />);
    expect(await screen.findByText(/a Banned u \(spam\)/)).toBeInTheDocument();
    expect(screen.getByText(/just now/)).toBeInTheDocument();
    expect(screen.getByText(/a custom t/)).toBeInTheDocument();
  });

  it("shows an empty audit log and ignores late results", async () => {
    render(<AdminOpsPanel />);
    expect(await screen.findByText("No admin actions recorded yet.")).toBeInTheDocument();
    let ok: (v: unknown) => void = () => {};
    let bad: (e: unknown) => void = () => {};
    h.audit.mockReturnValueOnce(new Promise((r) => (ok = r))).mockReturnValueOnce(new Promise((_, j) => (bad = j)));
    render(<AdminOpsPanel />).unmount();
    render(<AdminOpsPanel />).unmount();
    ok([]);
    bad(new Error("x"));
    await Promise.resolve();
  });
});

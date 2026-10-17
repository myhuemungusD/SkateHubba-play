import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WalletDisplay } from "../WalletDisplay";
import { Avatar2D } from "../Avatar2D";
import { DesignerCredit } from "../DesignerCredit";
import { MIKE_WHITE_DESIGNER_CREDIT } from "../../lib/closet/mikeWhiteCollection";
import type { LockerItem } from "../../services/locker";

const gear = (id: string, type: string, imageUrl: string | null): LockerItem => ({
  id,
  type,
  brand: "",
  name: id,
  imageUrl,
  rarity: "common",
  acquiredAt: null,
  provenanceReason: null,
  equipped: true,
  itemDefId: null,
});

describe("WalletDisplay", () => {
  it("shows the balance without a breakdown by default", () => {
    render(<WalletDisplay balance={{ balance: 1200, earnedBal: 1000, boughtBal: 200 }} />);
    expect(screen.getByTestId("wallet-balance")).toHaveTextContent("1,200");
    expect(screen.queryByTestId("wallet-breakdown")).not.toBeInTheDocument();
  });

  it("breaks down earned and bought Bucks when asked", () => {
    const { rerender } = render(
      <WalletDisplay balance={{ balance: 1200, earnedBal: 1000, boughtBal: 200 }} showBreakdown size="sm" />,
    );
    expect(screen.getByTestId("wallet-breakdown")).toHaveTextContent("1,000 earned · 200 bought");
    rerender(<WalletDisplay balance={{ balance: 50, earnedBal: 50, boughtBal: 0 }} showBreakdown size="lg" />);
    expect(screen.getByTestId("wallet-breakdown")).toHaveTextContent(/^50 earned$/);
    rerender(<WalletDisplay balance={{ balance: 5, earnedBal: 0, boughtBal: 5 }} showBreakdown />);
    expect(screen.getByTestId("wallet-breakdown")).toHaveTextContent(/^5 bought$/);
    rerender(<WalletDisplay balance={{ balance: 0, earnedBal: 0, boughtBal: 0 }} showBreakdown />);
    expect(screen.queryByTestId("wallet-breakdown")).not.toBeInTheDocument();
  });
});

describe("Avatar2D", () => {
  it("shows the empty body when nothing equipped has art", () => {
    const { rerender } = render(<Avatar2D equippedItems={[]} size="sm" />);
    expect(screen.getByTestId("avatar-empty")).toBeInTheDocument();
    rerender(<Avatar2D equippedItems={[gear("a", "deck", null)]} />);
    expect(screen.getByTestId("avatar-empty")).toBeInTheDocument();
    rerender(<Avatar2D equippedItems={[]} size="lg" />);
    expect(screen.getByTestId("avatar-empty")).toBeInTheDocument();
  });

  it("stacks layers back to front by slot, unknown slots last", () => {
    const { container } = render(
      <Avatar2D
        equippedItems={[
          gear("hat", "head", "/h.png"),
          gear("mystery", "cape", "/c.png"),
          gear("kicks", "shoes", "/s.png"),
          gear("blank", "top", null),
          gear("board", "deck", "/d.png"),
        ]}
      />,
    );
    const srcs = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(srcs).toEqual(["/d.png", "/s.png", "/h.png", "/c.png"]);
  });
});

describe("DesignerCredit", () => {
  it("renders the credit, signature and collection in both sizes", () => {
    const { rerender } = render(<DesignerCredit credit={MIKE_WHITE_DESIGNER_CREDIT} />);
    expect(screen.getByText("Designed by Mike White")).toBeInTheDocument();
    expect(screen.getByAltText("Mike White signature")).toHaveClass("h-6");
    rerender(<DesignerCredit credit={MIKE_WHITE_DESIGNER_CREDIT} compact />);
    expect(screen.getByAltText("Mike White signature")).toHaveClass("h-4");
    expect(screen.getByText("Mike White Signature collection")).toBeInTheDocument();
  });
});

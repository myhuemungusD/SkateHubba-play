import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LockerShowcase } from "../LockerShowcase";
import { buildLockerItem as item } from "./economy.test-helpers";

describe("LockerShowcase", () => {
  it("renders nothing on another player's empty locker", () => {
    const { container } = render(<LockerShowcase items={[]} isOwnProfile={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a single hint card on your own empty locker", () => {
    render(<LockerShowcase items={[]} isOwnProfile />);
    expect(screen.getByTestId("locker-empty-hint")).toHaveTextContent(
      "Your locker is empty — earned gear will show up here",
    );
  });

  it("renders the section heading and a card per item", () => {
    render(
      <LockerShowcase
        items={[item(), item({ id: "i2", name: "Cruiser Wheels", brand: "Spitfire", type: "wheels" })]}
        isOwnProfile={false}
      />,
    );
    expect(screen.getByRole("region", { name: "Hubba Locker" })).toBeInTheDocument();
    expect(screen.getByText("HUBBA LOCKER")).toBeInTheDocument();
    expect(screen.getByText("Ledge Deck")).toBeInTheDocument();
    expect(screen.getByText("Spitfire")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders a lazy-loaded image when the item has one", () => {
    render(<LockerShowcase items={[item({ imageUrl: "https://cdn.example.com/deck.png" })]} isOwnProfile />);
    const img = screen.getByTestId("locker-image-i1");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/deck.png");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(screen.queryByTestId("locker-icon-i1")).not.toBeInTheDocument();
  });

  it("falls back to a type icon when the item has no image", () => {
    render(<LockerShowcase items={[item()]} isOwnProfile />);
    expect(screen.getByTestId("locker-icon-i1")).toBeInTheDocument();
    expect(screen.queryByTestId("locker-image-i1")).not.toBeInTheDocument();
  });

  it("tints the card by rarity", () => {
    render(<LockerShowcase items={[item({ id: "r1", rarity: "rare" })]} isOwnProfile />);
    expect(screen.getByTestId("locker-item-r1").className).toContain("border-blue-500/50");
    expect(screen.getByText("RARE")).toBeInTheDocument();
  });

  it("falls back to common styling for an unknown rarity", () => {
    render(<LockerShowcase items={[item({ id: "x1", rarity: "mythic" })]} isOwnProfile />);
    expect(screen.getByTestId("locker-item-x1").className).toContain("border-zinc-700/70");
  });

  it("falls back to a generic icon for an unknown gear type", () => {
    render(<LockerShowcase items={[item({ id: "t1", type: "hoverboard" })]} isOwnProfile />);
    expect(screen.getByTestId("locker-icon-t1")).toBeInTheDocument();
  });

  it("surfaces the provenance reason as the card title and in its accessible label", () => {
    render(<LockerShowcase items={[item({ provenanceReason: "Won the 2026 opener" })]} isOwnProfile />);
    const card = screen.getByTestId("locker-item-i1");
    expect(card).toHaveAttribute("title", "Won the 2026 opener");
    expect(card).toHaveAttribute("aria-label", "Ledge Deck by Hubba, common. Won the 2026 opener");
  });

  it("omits the brand clause when the service defaulted brand to an empty string", () => {
    render(<LockerShowcase items={[item({ brand: "" })]} isOwnProfile />);
    const card = screen.getByTestId("locker-item-i1");
    expect(card).toHaveAttribute("aria-label", "Ledge Deck, common");
    // The empty brand line is dropped entirely rather than rendering a blank row.
    expect(card.textContent).not.toContain("by");
  });

  it("omits the provenance clause when the item has none", () => {
    render(<LockerShowcase items={[item()]} isOwnProfile />);
    const card = screen.getByTestId("locker-item-i1");
    expect(card).toHaveAttribute("aria-label", "Ledge Deck by Hubba, common");
    expect(card).not.toHaveAttribute("title");
  });
});

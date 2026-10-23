import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClosetGrid, sortClosetItems } from "../ClosetGrid";
import { closetItem as item } from "./closetFixtures.test-helpers";

describe("ClosetGrid", () => {
  it("shows the closet grid when items exist", () => {
    const items = [item({ id: "d1" }), item({ id: "w1", type: "wheels" }), item({ id: "s1", type: "shoes" })];
    render(<ClosetGrid items={items} />);
    expect(document.querySelectorAll("[data-testid^=closet-item-]")).toHaveLength(3);
  });

  it("renders an image when imageUrl is present", () => {
    render(<ClosetGrid items={[item({ imageUrl: "https://cdn.example.com/deck.png" })]} />);
    expect(document.querySelector("[data-testid=closet-image-d1]")).toBeInTheDocument();
  });

  it("renders a fallback icon when imageUrl is missing", () => {
    render(<ClosetGrid items={[item()]} />);
    expect(document.querySelector("[data-testid=closet-icon-d1]")).toBeInTheDocument();
  });

  it("applies rarity-specific styling", () => {
    render(<ClosetGrid items={[item({ id: "r1", rarity: "rare" })]} />);
    expect(document.querySelector("[data-testid=closet-item-r1]")?.className).toMatch(/border-blue-500/);
  });

  it("falls back to common styling for unknown rarities", () => {
    render(<ClosetGrid items={[item({ id: "x1", rarity: "mythic" })]} />);
    expect(document.querySelector("[data-testid=closet-item-x1]")?.className).toMatch(/border-zinc-700/);
  });

  it("falls back to a generic icon for unknown types", () => {
    render(<ClosetGrid items={[item({ id: "t1", type: "hoverboard" })]} />);
    expect(document.querySelector("[data-testid=closet-icon-t1]")).toBeInTheDocument();
  });

  it("shows provenance in the title attribute", () => {
    render(<ClosetGrid items={[item({ provenanceReason: "Won the 2026 opener" })]} />);
    expect(document.querySelector("[data-testid=closet-item-d1]")?.getAttribute("title")).toBe("Won the 2026 opener");
  });

  it("renders the brand when present", () => {
    render(<ClosetGrid items={[item()]} />);
    const card = document.querySelector("[data-testid=closet-item-d1]");
    expect(card?.textContent).toContain("Test Brand");
  });

  it("omits the brand line when brand is empty", () => {
    render(<ClosetGrid items={[item({ brand: "" })]} />);
    const card = document.querySelector("[data-testid=closet-item-d1]");
    expect(card?.textContent).not.toMatch(/TEST BRAND/);
  });

  it("sorts items by acquisition date (newest first)", () => {
    const old = item({ id: "old", acquiredAt: new Date("2026-01-01") });
    const newer = item({ id: "newer", acquiredAt: new Date("2026-06-01") });
    render(<ClosetGrid items={[old, newer]} />);
    const cards = document.querySelectorAll("[data-testid^=closet-item-]");
    expect(cards[0]).toHaveAttribute("data-testid", "closet-item-newer");
    expect(cards[1]).toHaveAttribute("data-testid", "closet-item-old");
  });

  it("credits Mike White with his signature and collection on his designs", () => {
    render(
      <ClosetGrid
        items={[
          item({ id: "m1", type: "shoes", brand: "Mike White", name: "Teeth", itemDefId: "mike_white_teeth_fire" }),
        ]}
      />,
    );
    const card = document.querySelector("[data-testid=closet-item-m1]") as HTMLElement;
    expect(card).toHaveTextContent("Designed by Mike White");
    expect(card).toHaveTextContent("Mike White Signature collection");
    expect(card.querySelector("img[alt='Mike White signature']")).toBeInTheDocument();
    expect(card.getAttribute("aria-label")).toContain("Designed by Mike White");
  });

  it("shows no designer credit on uncredited gear", () => {
    render(<ClosetGrid items={[item()]} />);
    expect(document.querySelector("[data-testid=designer-credit]")).not.toBeInTheDocument();
  });

  it("sortClosetItems puts the newest first without mutating the input", () => {
    const a = item({ id: "a", acquiredAt: new Date("2026-01-01") });
    const b = item({ id: "b", acquiredAt: new Date("2026-06-01") });
    const input = [a, b];
    expect(sortClosetItems(input).map((i) => i.id)).toEqual(["b", "a"]);
    expect(input.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("ClosetGrid signature detail", () => {
  it("shows the polished card and opens the detail sheet for a credited shoe", () => {
    render(
      <ClosetGrid
        items={[
          item({ id: "m1", type: "shoes", name: "Teeth", imageUrl: "/old.webp", itemDefId: "mike_white_teeth_fire" }),
        ]}
      />,
    );
    expect(document.querySelector("[data-testid=closet-image-m1]")).toHaveAttribute(
      "src",
      "/assets/closet/mike-white/card/teeth-fire.webp",
    );
    fireEvent.click(document.querySelector("[data-testid=closet-view-m1]")!);
    expect(document.querySelector("[data-testid=shoe-detail]")).toHaveTextContent("Designed by Mike White");
    fireEvent.click(document.querySelector("[aria-label=Close]")!);
    expect(document.querySelector("[data-testid=shoe-detail]")).toBeNull();
  });

  it("has no detail button for uncredited items", () => {
    render(<ClosetGrid items={[item()]} />);
    expect(document.querySelector("[data-testid=closet-view-d1]")).toBeNull();
  });
});

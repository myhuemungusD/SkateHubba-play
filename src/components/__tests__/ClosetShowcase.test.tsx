import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClosetShowcase } from "../ClosetShowcase";

function item(overrides?: Partial<Parameters<typeof ClosetShowcase>[0]["items"][0]>) {
  return {
    id: "d1",
    type: "deck",
    brand: "Test Brand",
    name: "Test Deck",
    imageUrl: null,
    rarity: "common",
    acquiredAt: new Date(),
    provenanceReason: null,
    equipped: false,
    itemDefId: null as string | null,
    ...overrides,
  };
}

describe("ClosetShowcase", () => {
  it("renders nothing for another player's empty closet", () => {
    const { container } = render(<ClosetShowcase items={[]} isOwnProfile={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an empty-state hint for the owner's empty closet", () => {
    render(<ClosetShowcase items={[]} isOwnProfile />);
    expect(document.querySelector("[data-testid=closet-empty-hint]")).toBeInTheDocument();
  });

  it("shows the closet grid when items exist", () => {
    const items = [item({ id: "d1" }), item({ id: "w1", type: "wheels" }), item({ id: "s1", type: "shoes" })];
    render(<ClosetShowcase items={items} isOwnProfile />);
    expect(document.querySelectorAll("[data-testid^=closet-item-]")).toHaveLength(3);
  });

  it("renders an image when imageUrl is present", () => {
    render(<ClosetShowcase items={[item({ imageUrl: "https://cdn.example.com/deck.png" })]} isOwnProfile />);
    expect(document.querySelector("[data-testid=closet-image-d1]")).toBeInTheDocument();
  });

  it("renders a fallback icon when imageUrl is missing", () => {
    render(<ClosetShowcase items={[item()]} isOwnProfile />);
    expect(document.querySelector("[data-testid=closet-icon-d1]")).toBeInTheDocument();
  });

  it("applies rarity-specific styling", () => {
    render(<ClosetShowcase items={[item({ id: "r1", rarity: "rare" })]} isOwnProfile />);
    expect(document.querySelector("[data-testid=closet-item-r1]")?.className).toMatch(/border-blue-500/);
  });

  it("falls back to common styling for unknown rarities", () => {
    render(<ClosetShowcase items={[item({ id: "x1", rarity: "mythic" })]} isOwnProfile />);
    expect(document.querySelector("[data-testid=closet-item-x1]")?.className).toMatch(/border-zinc-700/);
  });

  it("falls back to a generic icon for unknown types", () => {
    render(<ClosetShowcase items={[item({ id: "t1", type: "hoverboard" })]} isOwnProfile />);
    expect(document.querySelector("[data-testid=closet-icon-t1]")).toBeInTheDocument();
  });

  it("shows provenance in the title attribute", () => {
    render(<ClosetShowcase items={[item({ provenanceReason: "Won the 2026 opener" })]} isOwnProfile />);
    expect(document.querySelector("[data-testid=closet-item-d1]")?.getAttribute("title")).toBe("Won the 2026 opener");
  });

  it("renders the brand when present", () => {
    render(<ClosetShowcase items={[item()]} isOwnProfile />);
    const card = document.querySelector("[data-testid=closet-item-d1]");
    expect(card?.textContent).toContain("Test Brand");
  });

  it("omits the brand line when brand is empty", () => {
    render(<ClosetShowcase items={[item({ brand: "" })]} isOwnProfile />);
    const card = document.querySelector("[data-testid=closet-item-d1]");
    expect(card?.textContent).not.toMatch(/TEST BRAND/);
  });

  it("sorts items by acquisition date (newest first)", () => {
    const old = item({ id: "old", acquiredAt: new Date("2026-01-01") });
    const newer = item({ id: "newer", acquiredAt: new Date("2026-06-01") });
    render(<ClosetShowcase items={[old, newer]} isOwnProfile />);
    const cards = document.querySelectorAll("[data-testid^=closet-item-]");
    expect(cards[0]).toHaveAttribute("data-testid", "closet-item-newer");
    expect(cards[1]).toHaveAttribute("data-testid", "closet-item-old");
  });

  it("credits Mike White with his signature and collection on his designs", () => {
    render(
      <ClosetShowcase
        items={[
          item({ id: "m1", type: "shoes", brand: "Mike White", name: "Teeth", itemDefId: "mike_white_teeth_fire" }),
        ]}
        isOwnProfile
      />,
    );
    const card = document.querySelector("[data-testid=closet-item-m1]") as HTMLElement;
    expect(card).toHaveTextContent("Designed by Mike White");
    expect(card).toHaveTextContent("Mike White Signature collection");
    expect(card.querySelector("img[alt='Mike White signature']")).toBeInTheDocument();
    expect(card.getAttribute("aria-label")).toContain("Designed by Mike White");
  });

  it("shows no designer credit on uncredited gear", () => {
    render(<ClosetShowcase items={[item()]} isOwnProfile />);
    expect(document.querySelector("[data-testid=designer-credit]")).not.toBeInTheDocument();
  });

  it("links the owner to Closet Studio only when the studio flag is on", () => {
    const { queryByTestId, rerender } = render(<ClosetShowcase items={[]} isOwnProfile />);
    expect(queryByTestId("open-closet-studio")).toBeNull();
    vi.stubEnv("VITE_FEATURE_CLOSET_STUDIO", "true");
    try {
      rerender(<ClosetShowcase items={[item()]} isOwnProfile />);
      expect(queryByTestId("open-closet-studio")).toHaveAttribute("href", "/closet/studio");
      rerender(<ClosetShowcase items={[item()]} isOwnProfile={false} />);
      expect(queryByTestId("open-closet-studio")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("ClosetShowcase signature detail", () => {
  it("shows the polished card and opens the detail sheet for a credited shoe", () => {
    render(
      <ClosetShowcase
        items={[
          item({ id: "m1", type: "shoes", name: "Teeth", imageUrl: "/old.webp", itemDefId: "mike_white_teeth_fire" }),
        ]}
        isOwnProfile
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
    render(<ClosetShowcase items={[item()]} isOwnProfile />);
    expect(document.querySelector("[data-testid=closet-view-d1]")).toBeNull();
  });
});

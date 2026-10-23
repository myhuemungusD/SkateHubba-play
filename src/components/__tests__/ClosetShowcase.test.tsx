import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CLOSET_PREVIEW_COUNT, ClosetShowcase } from "../ClosetShowcase";
import { closetItem as item } from "./closetFixtures.test-helpers";

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => item({ id: `i${i}`, acquiredAt: new Date(2026, 0, i + 1) }));

describe("ClosetShowcase (profile row)", () => {
  it("renders nothing for another player's empty closet", () => {
    const { container } = render(<ClosetShowcase items={[]} isOwnProfile={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an empty-state hint for the owner's empty closet", () => {
    render(<ClosetShowcase items={[]} isOwnProfile />);
    expect(screen.getByTestId("closet-empty-hint")).toBeInTheDocument();
    expect(screen.queryByTestId("closet-see-all")).toBeNull();
  });

  it("no longer renders the full grid on the profile", () => {
    render(<ClosetShowcase items={many(9)} isOwnProfile onSeeAll={() => {}} />);
    expect(document.querySelectorAll("[data-testid^=closet-item-]")).toHaveLength(0);
    expect(screen.queryByTestId("closet-grid")).toBeNull();
  });

  it("previews at most one row of thumbnails, newest first", () => {
    render(<ClosetShowcase items={many(9)} isOwnProfile />);
    const thumbs = screen.getByTestId("closet-preview").querySelectorAll("[data-testid^=closet-thumb-]");
    expect(thumbs).toHaveLength(CLOSET_PREVIEW_COUNT);
    expect(thumbs[0]).toHaveAttribute("data-testid", "closet-thumb-i8");
  });

  it("shows every item when there are fewer than a row", () => {
    render(<ClosetShowcase items={many(2)} isOwnProfile={false} />);
    expect(screen.getByTestId("closet-preview").children).toHaveLength(2);
  });

  it("shows the item count, singular and plural", () => {
    const { rerender } = render(<ClosetShowcase items={many(1)} isOwnProfile />);
    expect(screen.getByTestId("closet-count")).toHaveTextContent("1 item");
    rerender(<ClosetShowcase items={many(7)} isOwnProfile />);
    expect(screen.getByTestId("closet-count")).toHaveTextContent("7 items");
  });

  it("thumbnails show the image when there is one, else the type icon", () => {
    render(
      <ClosetShowcase
        items={[item({ id: "a", imageUrl: "https://cdn.example.com/deck.png" }), item({ id: "b", type: "hoverboard" })]}
        isOwnProfile
      />,
    );
    expect(screen.getByTestId("closet-thumb-a").querySelector("img")).toBeInTheDocument();
    expect(screen.getByTestId("closet-thumb-b").querySelector("svg")).toBeInTheDocument();
  });

  it("See all opens the Closet screen, on own and other profiles", () => {
    const onSeeAll = vi.fn();
    const { rerender } = render(<ClosetShowcase items={many(5)} isOwnProfile onSeeAll={onSeeAll} />);
    fireEvent.click(screen.getByRole("button", { name: "See all 5 items in the closet" }));
    rerender(<ClosetShowcase items={many(5)} isOwnProfile={false} onSeeAll={onSeeAll} />);
    fireEvent.click(screen.getByTestId("closet-see-all"));
    expect(onSeeAll).toHaveBeenCalledTimes(2);
  });

  it("has no See all link when no Closet screen is wired", () => {
    render(<ClosetShowcase items={many(5)} isOwnProfile />);
    expect(screen.queryByTestId("closet-see-all")).toBeNull();
    expect(screen.getByTestId("closet-count")).toHaveTextContent("5 items");
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

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Spot } from "../../../types/spot";
import {
  SpotFilterBar,
  applySpotFilters,
  countActiveFilters,
  DEFAULT_SPOT_FILTERS,
  type SpotFilters,
} from "../SpotFilterBar";

/**
 * Host that owns the filter state so controlled-component tests actually
 * reflect each keystroke back into the bar (mirrors the SpotMap container).
 */
function ControlledHost({
  initial = DEFAULT_SPOT_FILTERS,
  totalCount = 10,
  matchCount = 10,
  onChangeSpy,
}: {
  initial?: SpotFilters;
  totalCount?: number;
  matchCount?: number;
  onChangeSpy?: (next: SpotFilters) => void;
}) {
  const [f, setF] = useState<SpotFilters>(initial);
  return (
    <SpotFilterBar
      filters={f}
      onChange={(next) => {
        setF(next);
        onChangeSpy?.(next);
      }}
      totalCount={totalCount}
      matchCount={matchCount}
    />
  );
}

function makeSpot(overrides: Partial<Spot> = {}): Spot {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    createdBy: "u",
    name: "Hollenbeck Hubba",
    description: null,
    latitude: 34.05,
    longitude: -118.25,
    gnarRating: 3,
    bustRisk: 2,
    obstacles: ["ledge", "hubba"],
    photoUrls: [],
    isVerified: false,
    isActive: true,
    createdAt: "2026-04-10T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("applySpotFilters", () => {
  const spots: Spot[] = [
    makeSpot({
      id: "00000000-0000-0000-0000-000000000001",
      name: "Hollenbeck Hubba",
      gnarRating: 3,
      isVerified: false,
      obstacles: ["ledge", "hubba"],
    }),
    makeSpot({
      id: "00000000-0000-0000-0000-000000000002",
      name: "Wallenberg Four",
      gnarRating: 5,
      isVerified: true,
      obstacles: ["stairs", "gap"],
    }),
    makeSpot({
      id: "00000000-0000-0000-0000-000000000003",
      name: "Courthouse Bank",
      gnarRating: 2,
      isVerified: false,
      obstacles: ["bank"],
    }),
  ];

  it("returns every spot when filters are empty", () => {
    expect(applySpotFilters(spots, DEFAULT_SPOT_FILTERS)).toEqual(spots);
  });

  it("filters by case-insensitive name substring", () => {
    const out = applySpotFilters(spots, { ...DEFAULT_SPOT_FILTERS, query: "hubba" });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Hollenbeck Hubba");
  });

  it("trims the query before comparing", () => {
    const out = applySpotFilters(spots, { ...DEFAULT_SPOT_FILTERS, query: "  wallen  " });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Wallenberg Four");
  });

  it("filters by verifiedOnly", () => {
    const out = applySpotFilters(spots, { ...DEFAULT_SPOT_FILTERS, verifiedOnly: true });
    expect(out).toHaveLength(1);
    expect(out[0].isVerified).toBe(true);
  });

  it("filters by minGnar threshold", () => {
    const out = applySpotFilters(spots, { ...DEFAULT_SPOT_FILTERS, minGnar: 4 });
    expect(out.map((s) => s.gnarRating)).toEqual([5]);
  });

  it("treats minGnar=0 as no threshold (keeps low-gnar spots)", () => {
    const out = applySpotFilters(spots, { ...DEFAULT_SPOT_FILTERS, minGnar: 0 });
    expect(out).toHaveLength(3);
  });

  it("filters by obstacle OR-match", () => {
    const out = applySpotFilters(spots, { ...DEFAULT_SPOT_FILTERS, obstacles: ["bank", "stairs"] });
    expect(out.map((s) => s.name).sort()).toEqual(["Courthouse Bank", "Wallenberg Four"]);
  });

  it("combines multiple filters with AND", () => {
    const out = applySpotFilters(spots, {
      ...DEFAULT_SPOT_FILTERS,
      verifiedOnly: true,
      minGnar: 4,
      obstacles: ["stairs"],
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Wallenberg Four");
  });

  it("returns empty when filters match nothing", () => {
    const out = applySpotFilters(spots, { ...DEFAULT_SPOT_FILTERS, query: "not-a-spot" });
    expect(out).toEqual([]);
  });
});

describe("countActiveFilters", () => {
  it("counts 0 on defaults", () => {
    expect(countActiveFilters(DEFAULT_SPOT_FILTERS)).toBe(0);
  });

  it("does NOT count the query — only chip-style filters", () => {
    expect(countActiveFilters({ ...DEFAULT_SPOT_FILTERS, query: "hi" })).toBe(0);
  });

  it("counts each non-default facet separately", () => {
    expect(countActiveFilters({ query: "", obstacles: ["ledge"], verifiedOnly: true, minGnar: 4 })).toBe(3);
  });
});

describe("SpotFilterBar", () => {
  it("types into the search field and reports via onChange", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    await userEvent.type(screen.getByRole("searchbox", { name: /search spots/i }), "hubba");
    const last = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(last.query).toBe("hubba");
  });

  it("shows a clear button only when the query is non-empty", async () => {
    // Empty query → no clear button.
    const { unmount } = render(
      <SpotFilterBar filters={DEFAULT_SPOT_FILTERS} onChange={vi.fn()} totalCount={10} matchCount={10} />,
    );
    expect(screen.queryByLabelText(/clear search/i)).toBeNull();
    unmount();

    // Non-empty query → clear appears; clicking it emits onChange with ''.
    const onChange = vi.fn();
    render(
      <SpotFilterBar
        filters={{ ...DEFAULT_SPOT_FILTERS, query: "hubba" }}
        onChange={onChange}
        totalCount={10}
        matchCount={1}
      />,
    );
    await userEvent.click(screen.getByLabelText(/clear search/i));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ query: "" }));
  });

  it("toggles the filter panel and its obstacle chips", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    // Panel hidden by default
    expect(screen.queryByRole("region", { name: /spot filters/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    expect(screen.getByRole("region", { name: /spot filters/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "ledge" }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ obstacles: ["ledge"] }));
  });

  it("shows the result counter only when a filter or query is active", () => {
    // Defaults: no counter.
    const { unmount } = render(
      <SpotFilterBar filters={DEFAULT_SPOT_FILTERS} onChange={vi.fn()} totalCount={10} matchCount={10} />,
    );
    expect(screen.queryByTestId("filter-result-count")).toBeNull();
    unmount();

    // A chip filter turns the counter on.
    render(
      <SpotFilterBar
        filters={{ ...DEFAULT_SPOT_FILTERS, verifiedOnly: true }}
        onChange={vi.fn()}
        totalCount={10}
        matchCount={3}
      />,
    );
    const counter = screen.getByTestId("filter-result-count");
    expect(counter.textContent).toMatch(/3 of 10 spots/);
  });

  it("renders the active-filter badge count on the toggle button", () => {
    render(
      <SpotFilterBar
        filters={{ query: "", obstacles: ["ledge"], verifiedOnly: true, minGnar: 4 }}
        onChange={vi.fn()}
        totalCount={5}
        matchCount={1}
      />,
    );
    expect(screen.getByTestId("filter-count").textContent).toBe("3");
  });

  it("Clear button on the counter resets chip filters (not the query)", async () => {
    const onChange = vi.fn();
    render(
      <SpotFilterBar
        filters={{ query: "hubba", obstacles: ["ledge"], verifiedOnly: true, minGnar: 4 }}
        onChange={onChange}
        totalCount={5}
        matchCount={0}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /clear all filters/i }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_SPOT_FILTERS);
  });

  it("closes the panel when the user taps outside", async () => {
    render(
      <div>
        <SpotFilterBar filters={DEFAULT_SPOT_FILTERS} onChange={vi.fn()} totalCount={5} matchCount={5} />
        <div data-testid="outside">outside</div>
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: /filters/i }));
    expect(screen.getByRole("region", { name: /spot filters/i })).toBeInTheDocument();

    // Use fireEvent because the outside listener is attached at the capture phase.
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("region", { name: /spot filters/i })).toBeNull();
  });
});

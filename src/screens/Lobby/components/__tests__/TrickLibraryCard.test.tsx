import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { TrickLibraryCard } from "../TrickLibraryCard";

describe("TrickLibraryCard", () => {
  it("links to /tricks", () => {
    render(
      <MemoryRouter>
        <TrickLibraryCard />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("trick-library-card")).toHaveAttribute("href", "/tricks");
  });
});

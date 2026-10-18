import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SignatureShowcase } from "../PlayerProfileScreen/components/custom/SignatureShowcase";
import { buildLockerItem } from "../../components/__tests__/economy.test-helpers";

describe("SignatureShowcase", () => {
  it("leads with a 360 hero for a skinned shoe and polished cards for the rest", () => {
    render(
      <SignatureShowcase
        accent="#f60"
        items={[
          buildLockerItem({ id: "a", itemDefId: "mike_white_og_gum", name: "OG Gum" }),
          buildLockerItem({ id: "b", itemDefId: "mike_white_teeth_fire", name: "Teeth" }),
          buildLockerItem({ id: "c", itemDefId: null }),
        ]}
      />,
    );
    const hero = screen.getByTestId("signature-hero");
    expect(hero).toHaveTextContent("Teeth");
    expect(hero).toHaveTextContent("Designed by Mike White");
    expect(screen.getByAltText("OG Gum")).toHaveAttribute("src", "/assets/closet/mike-white/card/og-gum.webp");
  });

  it("skips the hero when no owned piece has a skin", () => {
    render(<SignatureShowcase accent="#f60" items={[buildLockerItem({ id: "a", itemDefId: "mike_white_og_gum" })]} />);
    expect(screen.queryByTestId("signature-hero")).toBeNull();
    expect(screen.getByTestId("signature-showcase")).toBeInTheDocument();
  });

  it("renders nothing without credited pieces", () => {
    const { container } = render(<SignatureShowcase accent="#f60" items={[buildLockerItem({ itemDefId: null })]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

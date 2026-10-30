import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../components/pro/ProReelAndSpots", () => ({
  ProReelAndSpots: (p: { uid: string; displayName: string; isOwn: boolean }) => (
    <div data-testid="reel">{`${p.uid}|${p.displayName}|${String(p.isOwn)}`}</div>
  ),
}));
vi.mock("../../../../components/pro/ProProfileEditor", () => ({ ProProfileEditor: () => null }));

import { ProShowcase } from "../ProShowcase";

const content = { displayName: "Test Pro", signatureTricks: ["Hardflip"] };
const full = {
  content,
  username: "testpro",
  stance: "regular",
  wins: 0,
  losses: 0,
  reviewMode: false,
  editableUid: "pro1",
  tagline: "Skate or die",
  hometown: "Torrance",
  sponsors: ["Deck Co"],
  bio: "Rips.",
  signatureTricks: ["Hardflip"],
};

const prompt = () => screen.getByTestId("pro-profile-prompt").firstChild?.textContent;

afterEach(() => vi.unstubAllEnvs());

describe("ProShowcase owner prompts", () => {
  it.each([
    ["hometown", { hometown: "  " }, "Add your hometown"],
    ["sponsors", { sponsors: [" "] }, "Add your sponsors"],
    ["bio", { bio: "" }, "Add your bio"],
    ["signature tricks", { signatureTricks: [] }, "Pick your signature tricks"],
  ])("asks for the missing %s first", (_name, gap, text) => {
    render(<ProShowcase {...full} {...gap} />);
    expect(prompt()).toBe(text);
    expect(screen.queryByTestId("edit-pro-profile")).toBeNull();
  });

  it("offers a plain edit button once everything is filled in", () => {
    render(<ProShowcase {...full} />);
    expect(screen.queryByTestId("pro-profile-prompt")).toBeNull();
    expect(screen.getByTestId("edit-pro-profile")).toBeInTheDocument();
  });
});

describe("ProShowcase reel", () => {
  it("loads the clip reel and spots for the pro when the showcase flag is on", () => {
    vi.stubEnv("VITE_FEATURE_PRO_SHOWCASE", "true");
    render(<ProShowcase {...full} uid="pro1" isOwn />);
    expect(screen.getByTestId("reel")).toHaveTextContent("pro1|Test Pro|true");
  });

  it("needs the pro's uid to load the reel", () => {
    vi.stubEnv("VITE_FEATURE_PRO_SHOWCASE", "true");
    render(<ProShowcase {...full} />);
    expect(screen.queryByTestId("reel")).toBeNull();
  });

  it("stays hidden with the flag off", () => {
    render(<ProShowcase {...full} uid="pro1" />);
    expect(screen.queryByTestId("reel")).toBeNull();
  });
});

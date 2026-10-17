import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateDoc = vi.fn();
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...path: string[]) => path.join("/"),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}));
vi.mock("../../firebase", () => ({ requireDb: () => ({}) }));

import { saveProProfile } from "../proProfile";

describe("saveProProfile", () => {
  beforeEach(() => mockUpdateDoc.mockReset().mockResolvedValue(undefined));

  it("writes only proBio and proSignatureTricks, trimmed, capped and catalog-filtered", async () => {
    const out = await saveProProfile("u1", {
      bio: `  ${"x".repeat(300)}  `,
      signatureTricks: ["Hardflip", "Made Up Flip", "Hardflip", "Kickflip", "Heelflip", "Ollie"],
      tagline: `  ${"t".repeat(90)} `,
      hometown: "  Los   Angeles ",
      sponsors: [" A ", "", "A", "B", "C", "D"],
    });
    expect(out.tagline).toHaveLength(80);
    expect(out.hometown).toBe("Los Angeles");
    expect(out.sponsors).toEqual(["A", "B", "C"]);
    expect(out.bio).toHaveLength(280);
    expect(out.signatureTricks).toEqual(["Hardflip", "Kickflip", "Heelflip"]);
    expect(mockUpdateDoc).toHaveBeenCalledWith("users/u1", {
      proBio: out.bio,
      proSignatureTricks: out.signatureTricks,
      proTagline: out.tagline,
      proHometown: "Los Angeles",
      proSponsors: ["A", "B", "C"],
    });
  });

  it("rejects a bio with slurs before writing (App Store 1.2)", async () => {
    const base = { bio: "", signatureTricks: [], tagline: "", hometown: "", sponsors: [] };
    await expect(saveProProfile("u1", { ...base, bio: "just kys" })).rejects.toThrow(/don't allow/);
    await expect(saveProProfile("u1", { ...base, tagline: "N1GG3RS" })).rejects.toThrow(/don't allow/);
    await expect(saveProProfile("u1", { ...base, sponsors: ["ok", "f4gg0t"] })).rejects.toThrow(/don't allow/);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

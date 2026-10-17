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
    });
    expect(out.bio).toHaveLength(280);
    expect(out.signatureTricks).toEqual(["Hardflip", "Kickflip", "Heelflip"]);
    expect(mockUpdateDoc).toHaveBeenCalledWith("users/u1", {
      proBio: out.bio,
      proSignatureTricks: out.signatureTricks,
    });
  });

  it("rejects a bio with slurs before writing (App Store 1.2)", async () => {
    await expect(saveProProfile("u1", { bio: "just kys", signatureTricks: [] })).rejects.toThrow(/don't allow/);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

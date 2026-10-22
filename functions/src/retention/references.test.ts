import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REFERENCE_SOURCES, gameIdOfRef, gamePathOf, type References } from "./references.js";

const url = (path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=t`;

function collect(collection: string, docs: Record<string, unknown>[]): References {
  const refs: References = { paths: new Set(), gameIds: new Set() };
  const source = REFERENCE_SOURCES.find((s) => s.collection === collection);
  if (!source) throw new Error(`no source ${collection}`);
  for (const doc of docs) source.collect(doc, refs);
  return refs;
}

describe("gamePathOf", () => {
  it.each([
    ["a download URL", url("games/g1/turn-1/set-u1.mp4"), "games/g1/turn-1/set-u1.mp4"],
    [
      "a lowercase-escaped download URL",
      "https://x/o/games%2fg1%2fturn-1%2fset-u1.mp4?alt=media",
      "games/g1/turn-1/set-u1.mp4",
    ],
    ["a gs:// URL", "gs://bucket/games/g3/turn-1/set-u3.mp4", "games/g3/turn-1/set-u3.mp4"],
    ["a raw path", "games/g4/turn-5/set-u4.mp4", "games/g4/turn-5/set-u4.mp4"],
  ])("reads %s", (_label, value, path) => {
    expect(gamePathOf(value)).toBe(path);
  });

  it.each([
    ["a malformed escape", "https://x/o/games%2F%E0%A4%A?alt=media"],
    ["a non-game gs:// path", "gs://bucket/userClips/a.mp4"],
    ["a user clip URL", url("userClips/u1/x.mp4")],
    ["a non-string", 3],
  ])("ignores %s", (_label, value) => {
    expect(gamePathOf(value)).toBeNull();
  });
});

describe("gameIdOfRef", () => {
  it("reads a game id from a game, clip or dispute id", () => {
    expect(gameIdOfRef("AbC123")).toBe("AbC123");
    expect(gameIdOfRef("AbC123_4_set")).toBe("AbC123");
    expect(gameIdOfRef("AbC123_4_match")).toBe("AbC123");
    expect(gameIdOfRef("AbC123_4")).toBe("AbC123");
  });

  it("ignores anything else", () => {
    expect(gameIdOfRef("a/b")).toBeNull();
    expect(gameIdOfRef("AbC_4_other")).toBeNull();
    expect(gameIdOfRef("")).toBeNull();
    expect(gameIdOfRef(null)).toBeNull();
  });
});

describe("REFERENCE_SOURCES", () => {
  it("a feed clip pins its own video", () => {
    const refs = collect("clips", [
      { videoUrl: url("games/g1/turn-1/set-u1.mp4") },
      { videoUrl: url("userClips/u/x.mp4") },
    ]);
    expect([...refs.paths]).toEqual(["games/g1/turn-1/set-u1.mp4"]);
  });

  it("a dispute, a report (game or clip) and a moderation statement pin whole games", () => {
    expect([...collect("disputes", [{ gameId: "g1" }]).gameIds]).toEqual(["g1"]);
    // Real report shapes (src/services/reports.ts): gameId always, clipId for a clip report.
    expect([...collect("reports", [{ gameId: "g2" }, { gameId: "g3", clipId: "g3_2_match" }]).gameIds]).toEqual([
      "g2",
      "g3",
    ]);
    // contentRef is the clip id (functions/src/moderation/handlers.ts) or "account".
    expect([...collect("moderationStatements", [{ contentRef: "g4_1_set" }]).gameIds]).toEqual(["g4"]);
  });

  it("a training label pins its clip only while the skater is opted in", () => {
    const refs = collect("trainingLabels", [
      { clipPath: "games/g1/turn-1/set-in.mp4", excluded: false, consent: { optedIn: true } },
      { clipPath: "games/g1/turn-1/match-out.mp4", excluded: true, consent: { optedIn: false } },
      { clipPath: "games/g1/turn-2/set-revoked.mp4", excluded: true, consent: { optedIn: true } },
      { clipPath: "games/g1/turn-3/set-noconsent.mp4", excluded: false },
    ]);
    expect([...refs.paths]).toEqual(["games/g1/turn-1/set-in.mp4"]);
  });

  it("every source collection exists in firestore.rules, so a typo cannot read as empty", () => {
    const rules = readFileSync(resolve(__dirname, "../../../firestore.rules"), "utf8");
    for (const { collection } of REFERENCE_SOURCES) {
      expect(rules, collection).toContain(`match /${collection}/{`);
    }
  });
});

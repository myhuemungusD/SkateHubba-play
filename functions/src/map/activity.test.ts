import { describe, expect, it } from "vitest";
import type { DiceTx } from "../dice/store.js";
import { activityPath, isVisible, toMs, writeHere, writeLeft } from "./activity.js";

const NOW = Date.UTC(2026, 9, 19, 18, 0, 0);

function fakeTx() {
  const sets: { path: string; data: Record<string, unknown>; merge?: boolean }[] = [];
  const tx = {
    get: () => Promise.reject(new Error("unused")),
    query: () => Promise.resolve([]),
    set: (path: string, data: Record<string, unknown>, merge?: boolean) => sets.push({ path, data, merge }),
    update: () => undefined,
  } as DiceTx;
  return { tx, sets };
}

describe("skater activity", () => {
  it("reads times from Dates and Timestamps", () => {
    expect(toMs(new Date(NOW))).toBe(NOW);
    expect(toMs({ toMillis: () => NOW })).toBe(NOW);
    expect(toMs("x")).toBeNull();
    expect(toMs(null)).toBeNull();
  });

  it("is visible unless the owner hid their status", () => {
    expect(isVisible({ id: "u", data: undefined })).toBe(true);
    expect(isVisible({ id: "u", data: { hidden: false } })).toBe(true);
    expect(isVisible({ id: "u", data: { hidden: true } })).toBe(false);
  });

  it("writes the spot name and no location", () => {
    const { tx, sets } = fakeTx();
    const base = { uid: "u1", username: "jason", spotId: "s1", nowMs: NOW, hereUntilMs: NOW + 1, visible: true };
    writeHere(tx, { ...base, spot: { name: "  Cherry Park ", latitude: 1, longitude: 2 } });
    writeHere(tx, { ...base, spot: { name: "   " }, visible: false });
    writeHere(tx, { ...base, spot: {} });
    expect(sets[0]).toEqual({
      path: activityPath("u1"),
      data: {
        uid: "u1",
        username: "jason",
        spotId: "s1",
        spotName: "Cherry Park",
        lastAt: new Date(NOW),
        hereUntil: new Date(NOW + 1),
        visible: true,
      },
      merge: undefined,
    });
    expect(sets[0]!.data).not.toHaveProperty("latitude");
    expect(sets[1]!.data).toMatchObject({ spotName: "a spot", visible: false });
    expect(sets[2]!.data.spotName).toBe("a spot");
  });

  it("ends 'skating now' only for the same spot while still live", () => {
    const { tx, sets } = fakeTx();
    const live = { spotId: "s1", hereUntil: new Date(NOW + 60_000) };
    writeLeft(tx, "u1", "s1", { id: "u1", data: undefined }, NOW);
    writeLeft(tx, "u1", "s2", { id: "u1", data: live }, NOW);
    writeLeft(tx, "u1", "s1", { id: "u1", data: { spotId: "s1", hereUntil: new Date(NOW - 1) } }, NOW);
    writeLeft(tx, "u1", "s1", { id: "u1", data: { spotId: "s1" } }, NOW);
    expect(sets).toHaveLength(0);
    writeLeft(tx, "u1", "s1", { id: "u1", data: { spotId: "s1", hereUntil: { toMillis: () => NOW + 5 } } }, NOW);
    expect(sets).toEqual([{ path: activityPath("u1"), data: { hereUntil: new Date(NOW) }, merge: true }]);
  });
});

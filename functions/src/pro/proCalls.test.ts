import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }));
import { applyProCall } from "./proCalls.js";

type Docs = Record<string, Record<string, unknown> | undefined>;
function fakeDb(docs: Docs) {
  const set = vi.fn();
  const update = vi.fn();
  const db = {
    collection: (c: string) => ({ doc: (id: string) => ({ path: `${c}/${id}` }) }),
    runTransaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        get: async (ref: { path: string }) => ({ exists: docs[ref.path] !== undefined, data: () => docs[ref.path] }),
        set,
        update,
      }),
  };
  return { db: db as never, set, update };
}
const call = { clipId: "c1", uid: "p", answerTrickId: "kickflip" };
const item = (status = "pro_queue") => ({ status, options: ["kickflip", "heelflip", "shuvit", "varial"] });

describe("applyProCall", () => {
  it("rejects malformed docs", async () => {
    const { db } = fakeDb({});
    expect(await applyProCall(db, "gold", undefined)).toEqual({ applied: false, reason: "malformed" });
    expect(await applyProCall(db, "gold", { clipId: "c", uid: "p" })).toMatchObject({ reason: "malformed" });
  });
  it("requires a verified pro, an item, no gold yet, and a valid option", async () => {
    expect(await applyProCall(fakeDb({ "users/p": {} }).db, "gold", call)).toMatchObject({ reason: "not_pro" });
    expect(await applyProCall(fakeDb({}).db, "gold", call)).toMatchObject({ reason: "not_pro" });
    const pro = { "users/p": { isVerifiedPro: true } };
    expect(await applyProCall(fakeDb(pro).db, "gold", call)).toMatchObject({ reason: "no_item" });
    expect(
      await applyProCall(fakeDb({ ...pro, "wttItems/c1": item(), "wttGold/c1": {} }).db, "gold", call),
    ).toMatchObject({ reason: "already_gold" });
    expect(
      await applyProCall(fakeDb({ ...pro, "wttItems/c1": item() }).db, "gold", { ...call, answerTrickId: "x" }),
    ).toMatchObject({ reason: "not_an_option" });
    expect(await applyProCall(fakeDb({ ...pro, "wttItems/c1": { status: "open" } }).db, "gold", call)).toMatchObject({
      reason: "not_an_option",
    });
  });
  it("a review writes gold and closes a queued item with the pro's label", async () => {
    const { db, set, update } = fakeDb({ "users/p": { isVerifiedPro: true }, "wttItems/c1": item() });
    expect(await applyProCall(db, "review", call)).toEqual({ applied: true });
    expect(set).toHaveBeenCalledWith(
      { path: "wttGold/c1" },
      { answerTrickId: "kickflip", source: "pro", confirmedBy: "p", createdAt: "TS" },
    );
    expect(update).toHaveBeenCalledWith(
      { path: "wttItems/c1" },
      { status: "retired", top: "kickflip", retiredAt: "TS" },
    );
  });
  it("gold authoring and reviews of non-queued items leave the item alone", async () => {
    for (const [kind, status] of [
      ["gold", "pro_queue"],
      ["review", "open"],
    ] as const) {
      const { db, set, update } = fakeDb({ "users/p": { isVerifiedPro: true }, "wttItems/c1": item(status) });
      expect(await applyProCall(db, kind, call)).toEqual({ applied: true });
      expect(set).toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    }
  });
});

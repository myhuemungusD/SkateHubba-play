/**
 * "Download my data" COVERAGE tests (GDPR Art. 15/20).
 *
 * The export is built from FIRESTORE_EXPORT in api/account/_userDataRegistry.ts
 * and nothing else. These tests keep that table honest:
 *
 * 1. It has exactly the keys of FIRESTORE_ERASURE, which
 *    account-delete.coverage.test.ts holds to every collection in
 *    firestore.rules. So a new collection that stores user data fails here
 *    until somebody says how the export reads it or why it is left out.
 * 2. Every left-out collection states why; every read fits the shape of its
 *    path; sections that share a key share a name.
 * 3. Collection-group reads have the recursive rule they need, and that group
 *    holds no collection the table didn't plan for.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FIRESTORE_ERASURE,
  FIRESTORE_EXPORT,
  type ExportIncluded,
  type ExportPlan,
} from "../../../api/account/_userDataRegistry";
import { rulesCollectionGroups, rulesCollections } from "./rules-collections.test-helpers";

const PLANS = Object.entries(FIRESTORE_EXPORT) as [string, ExportPlan][];
const INCLUDED = PLANS.filter((e): e is [string, ExportIncluded] => "section" in e[1]);
const RULES = readFileSync("firestore.rules", "utf8");

describe("every collection is classified for the export", () => {
  it("has exactly the collections deletion knows about", () => {
    expect(Object.keys(FIRESTORE_EXPORT).sort()).toEqual(Object.keys(FIRESTORE_ERASURE).sort());
  });

  it("covers every collection in firestore.rules", () => {
    const missing = [...rulesCollections(RULES)].filter((c) => !(c in FIRESTORE_EXPORT));
    expect(missing).toEqual([]);
  });

  it.each(PLANS.filter(([, p]) => "excluded" in p))("%s states why it is left out", (_key, plan) => {
    const p = plan as { excluded: string; fix?: string };
    expect(p.excluded.trim().length).toBeGreaterThanOrEqual(20);
    if (p.fix !== undefined) expect(p.fix.trim().length).toBeGreaterThanOrEqual(10);
  });
});

describe("included collections", () => {
  it.each(INCLUDED)("%s has a section, a name and at least one read", (_key, p) => {
    expect(p.section).toMatch(/^[a-z][A-Za-z]+$/);
    expect(p.name.trim().length).toBeGreaterThan(0);
    expect(p.reads.length).toBeGreaterThan(0);
  });

  it.each(INCLUDED.filter(([, p]) => p.reads.length > 1))("%s tells its reads apart by field", (_key, p) => {
    const fields = p.reads.map((r) => ("field" in r ? r.field : ""));
    expect(fields.every((f) => f.length > 0)).toBe(true);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("gives every section one name", () => {
    const names = new Map<string, Set<string>>();
    for (const [, p] of INCLUDED) names.set(p.section, (names.get(p.section) ?? new Set()).add(p.name));
    const clashes = [...names].filter(([, n]) => n.size > 1).map(([s]) => s);
    expect(clashes).toEqual([]);
  });

  it("only merges collections into one section when each holds a list", () => {
    const bySection = new Map<string, string[]>();
    for (const [key, p] of INCLUDED) bySection.set(p.section, [...(bySection.get(p.section) ?? []), key]);
    const byKey = new Map(INCLUDED);
    for (const [, keys] of bySection) {
      if (keys.length < 2) continue;
      for (const key of keys) {
        const reads = (byKey.get(key) as ExportIncluded).reads;
        expect(reads.every((r) => r.kind !== "uidDoc" && r.kind !== "ownDoc" && r.kind !== "usernameDoc")).toBe(true);
      }
    }
  });

  it.each(INCLUDED)("%s reads in a way that fits its path", (key, p) => {
    const segs = key.split("/");
    for (const r of p.reads) {
      switch (r.kind) {
        case "uidDoc":
        case "where":
        case "arrayContains":
          expect(segs).toHaveLength(1);
          break;
        case "usernameDoc":
          expect(key).toBe("usernames");
          break;
        case "ownDoc":
        case "ownList":
          expect(segs).toHaveLength(3);
          expect(segs.slice(0, 2)).toEqual(["users", "{}"]);
          break;
        case "group":
        case "underEachParent":
          expect(segs).toHaveLength(3);
          expect(segs[1]).toBe("{}");
          break;
      }
      if ("field" in r) expect(r.field).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
    }
  });

  it.each(INCLUDED.filter(([, p]) => p.redact))("%s lists real field names to redact", (_key, p) => {
    const redact = p.redact as readonly string[];
    expect(redact.length).toBeGreaterThan(0);
    expect(new Set(redact).size).toBe(redact.length);
    for (const f of redact) expect(f).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
  });

  it("redacts device tokens from the private profile", () => {
    expect((FIRESTORE_EXPORT["users/{}/private"] as ExportIncluded).redact).toContain("fcmTokens");
  });
});

describe("collection-group reads", () => {
  const ruleGroups = rulesCollectionGroups(RULES);
  const groupReads = INCLUDED.flatMap(([key, p]) =>
    p.reads
      .filter((r) => r.kind === "group")
      .map((r) => ({ key, group: key.split("/")[2], read: r, section: p.section })),
  );

  it("finds the recursive rules (parser sanity check)", () => {
    expect(ruleGroups.size).toBeGreaterThan(0);
  });

  it.each(groupReads.map((g) => [g.key, g] as const))("%s has a recursive rule to read through", (_key, g) => {
    expect(ruleGroups.has(g.group)).toBe(true);
  });

  it("has no recursive rule the export doesn't use", () => {
    const used = new Set(groupReads.map((g) => g.group));
    expect([...ruleGroups].filter((g) => !used.has(g))).toEqual([]);
  });

  it("reads each group from every collection in it, the same way", () => {
    // A group query returns docs from EVERY collection with that last
    // segment, so each of them has to be planned as the same group read.
    for (const group of new Set(groupReads.map((g) => g.group))) {
      const members = [...rulesCollections(RULES)].filter((c) => c.split("/").at(-1) === group);
      const planned = groupReads.filter((g) => g.group === group);
      expect(planned.map((g) => g.key).sort()).toEqual(members.sort());
      expect(new Set(planned.map((g) => JSON.stringify([g.read, g.section]))).size).toBe(1);
    }
  });
});

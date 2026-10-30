/**
 * The two push couriers each carry a copy of the push platform helpers (dice
 * filter + mirrorTokens) so Vercel never imports the functions package. This
 * keeps the copies' code identical (the header comments differ).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mirrorTokens, MAX_TOKENS_PER_DISPATCH, testerEligibleTokens } from "../../../api/cron/_pushPlatforms";

const read = (rel: string) => readFileSync(resolve(__dirname, "../../..", rel), "utf8");
/** Everything from the first export on: the code, without the header comment. */
const body = (src: string) => src.slice(src.indexOf("export type PushPlatform"));

describe("push platform helpers drift", () => {
  it("functions/src/push/platforms.ts and api/cron/_pushPlatforms.ts have the same code", () => {
    const functionsSrc = body(read("functions/src/push/platforms.ts"));
    expect(functionsSrc).toContain("export function mirrorTokens");
    expect(body(read("api/cron/_pushPlatforms.ts"))).toBe(functionsSrc);
  });

  it("the Vercel copy caps at the pushTargets limit", () => {
    expect(MAX_TOKENS_PER_DISPATCH).toBe(10);
    expect(mirrorTokens({ tokens: ["a", "a", "b"] })).toEqual(["a", "b"]);
  });

  it("the Vercel copy keeps the tester filter in step (android and web only)", () => {
    const mirror = { platforms: { a: "android", w: "web", i: "ios" } };
    expect(testerEligibleTokens(mirror, ["a", "w", "i", "old"])).toEqual(["a", "w"]);
  });

  it("ignores a platforms field that is not a plain map, so no token passes the filter", () => {
    for (const platforms of [["android"], "android", null]) {
      expect(testerEligibleTokens({ platforms }, ["0", "android"])).toEqual([]);
    }
    expect(testerEligibleTokens(undefined, ["a"])).toEqual([]);
  });
});

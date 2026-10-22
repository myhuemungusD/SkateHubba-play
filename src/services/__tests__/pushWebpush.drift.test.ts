/**
 * The two push couriers (Cloud Functions and the manual Vercel endpoint) each
 * carry a copy of the web push options so Vercel never imports the functions
 * package. This keeps the copies' code identical (the header comments differ),
 * and keeps the link origin equal to the site's canonical origin.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as vercel from "../../../api/cron/_pushWebpush";
import { SITE_ORIGIN } from "../../lib/canonical";

const read = (rel: string) => readFileSync(resolve(__dirname, "../../..", rel), "utf8");
/** Everything from the first export on: the code, without the header comment. */
const body = (src: string) => src.slice(src.indexOf("export const WEB_PUSH_ORIGIN"));

describe("web push options drift", () => {
  it("functions/src/push/webpush.ts and api/cron/_pushWebpush.ts have the same code", () => {
    const functionsSrc = body(read("functions/src/push/webpush.ts"));
    expect(functionsSrc.length).toBeGreaterThan(200);
    expect(body(read("api/cron/_pushWebpush.ts"))).toBe(functionsSrc);
  });

  it("the link origin is the site's canonical https origin", () => {
    expect(vercel.WEB_PUSH_ORIGIN).toBe(SITE_ORIGIN);
    expect(vercel.webPushLink({ gameId: "g1" })).toBe(`${SITE_ORIGIN}/?game=g1`);
    expect(vercel.webPushLink({ gameId: "d1", kind: "dice" })).toBe(`${SITE_ORIGIN}/dice/d1`);
  });
});

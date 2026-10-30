/**
 * api/well-known/*: the universal-link association files. Both must 404 until
 * configured (Apple and Google cache a wrong file for a long time) and must
 * never publish a partial or placeholder value.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import aasa from "../../../api/well-known/apple-app-site-association";
import assetlinks from "../../../api/well-known/assetlinks";

type Handler = typeof aasa;

function run(handler: Handler, method?: string) {
  const out: { code?: number; body?: string; headers: Record<string, string> } = { headers: {} };
  const res = {
    status(code: number) {
      out.code = code;
      return res;
    },
    setHeader(name: string, value: string) {
      out.headers[name] = value;
    },
    end(body?: string) {
      out.body = body;
    },
  };
  handler({ method }, res);
  return out;
}

// Made-up values in the right shape; not anyone's real Team ID or signing cert.
const TEAM = "ABCDE12345";
const HEX = "0123456789abcdef".repeat(4);
const COLONS = HEX.toUpperCase().match(/.{2}/g)!.join(":");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  ["apple-app-site-association", aasa],
  ["assetlinks", assetlinks],
])("%s: methods", (_name, handler) => {
  it.each(["POST", "PUT", undefined])("rejects %s with 405 and an Allow header", (method) => {
    const out = run(handler, method);
    expect(out.code).toBe(405);
    expect(out.headers.Allow).toBe("GET, HEAD");
    expect(out.body).toBeUndefined();
  });
});

describe("apple-app-site-association", () => {
  it.each([
    ["unset", undefined],
    ["a placeholder", "TEAMID"],
    ["lowercase", "abcde12345"],
    ["too long", "ABCDE123456"],
  ])("404s while APPLE_TEAM_ID is %s", (_label, value) => {
    vi.stubEnv("APPLE_TEAM_ID", value);
    expect(run(aasa, "GET").code).toBe(404);
  });

  it.each(["GET", "HEAD"])("serves the app link for a real-shaped Team ID on %s", (method) => {
    vi.stubEnv("APPLE_TEAM_ID", TEAM);
    const out = run(aasa, method);
    expect(out.code).toBe(200);
    expect(out.headers).toEqual({ "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" });
    expect(JSON.parse(out.body!)).toEqual({
      applinks: { apps: [], details: [{ appID: `${TEAM}.com.skatehubba.app`, paths: ["*"] }] },
    });
  });
});

describe("assetlinks", () => {
  it.each([
    ["unset", undefined],
    ["blank", " , ,"],
    ["too short", "AB:CD"],
    ["one bad entry among good ones", `${HEX},nothex`],
  ])("404s while the fingerprint list is %s", (_label, value) => {
    vi.stubEnv("ANDROID_SHA256_CERT_FINGERPRINTS", value);
    expect(run(assetlinks, "GET").code).toBe(404);
  });

  it("normalizes raw and colon-separated fingerprints and keeps their order", () => {
    vi.stubEnv("ANDROID_SHA256_CERT_FINGERPRINTS", ` ${HEX} , ${COLONS.toLowerCase()} ,`);
    const out = run(assetlinks, "HEAD");
    expect(out.code).toBe(200);
    expect(out.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(out.body!)).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.skatehubba.app",
          sha256_cert_fingerprints: [COLONS, COLONS],
        },
      },
    ]);
  });
});

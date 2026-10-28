import { describe, it, expect } from "vitest";
import { scrubBreadcrumb, scrubEvent, scrubUrl } from "../sentryScrub";

type Crumb = Parameters<typeof scrubBreadcrumb>[0];
type SentryEvent = Parameters<typeof scrubEvent>[0];

// Shape of the reject @capacitor/filesystem 8.1.5 raises on a failed
// download (LegacyFilesystemImplementation.swift: "Error downloading file: \(urlString)").
// The token is fake.
const STORAGE_PATH = "https://firebasestorage.googleapis.com/v0/b/demo-bucket/o/games%2Fg1%2Fturn-1%2Fset.webm";
const TOKEN_URL = `${STORAGE_PATH}?alt=media&token=secret-token`;
const CAPACITOR_ERROR = `Error downloading file: ${TOKEN_URL}`;

describe("scrubUrl", () => {
  it("redacts named PII params and keeps the rest of the URL", () => {
    expect(scrubUrl("/auth?email=a@b.co&next=/feed&Token=x#top")).toBe(
      "/auth?email=[REDACTED]&next=/feed&Token=[REDACTED]#top",
    );
  });
});

describe("scrubBreadcrumb", () => {
  it("drops the logger's dev console copy (raw data), which the logger's own app crumb replaces", () => {
    const crumb: Crumb = {
      category: "console",
      message: `[WARN] share_file_download_failed [object Object]`,
      data: { arguments: ["[WARN]", "share_file_download_failed", { error: CAPACITOR_ERROR }], logger: "console" },
    };
    expect(scrubBreadcrumb(crumb)).toBeNull();
  });

  it("drops the logger's production console copy (one JSON string key-based redaction can't reach)", () => {
    const line = JSON.stringify({ level: "warn", event: "x", ts: "t", data: { uid: "raw-uid", email: "a@b.co" } });
    expect(scrubBreadcrumb({ category: "console", message: line, data: { arguments: [line] } })).toBeNull();
  });

  it("keeps other console crumbs but strips URL queries from the message and every argument", () => {
    const crumb = scrubBreadcrumb({
      category: "console",
      message: `Failed: ${CAPACITOR_ERROR}`,
      data: { arguments: ["Failed:", CAPACITOR_ERROR, { nested: { src: TOKEN_URL, playerUid: "raw-uid" } }] },
    });
    expect(crumb?.message).toBe(`Failed: Error downloading file: ${STORAGE_PATH}`);
    expect(crumb?.data?.arguments).toEqual([
      "Failed:",
      `Error downloading file: ${STORAGE_PATH}`,
      { nested: { src: STORAGE_PATH, playerUid: expect.stringMatching(/^uid_[0-9a-f]{8}$/) } },
    ]);
    expect(JSON.stringify(crumb)).not.toContain("secret-token");
  });

  it("keeps a console crumb that has no arguments array", () => {
    expect(scrubBreadcrumb({ category: "console", message: "plain" })).toEqual({
      category: "console",
      message: "plain",
    });
  });

  it("strips the query from a fetch URL and redacts PII params on navigation paths", () => {
    expect(scrubBreadcrumb({ category: "fetch", data: { url: TOKEN_URL, method: "GET", status_code: 403 } })).toEqual({
      category: "fetch",
      data: { url: STORAGE_PATH, method: "GET", status_code: 403 },
    });
    expect(
      scrubBreadcrumb({ category: "navigation", data: { from: "/auth?email=a@b.co", to: "/?game=g1" } })?.data,
    ).toEqual({ from: "/auth?email=[REDACTED]", to: "/?game=g1" });
    expect(scrubBreadcrumb({ category: "xhr", data: { url: "/api?token=t" } })?.data).toEqual({
      url: "/api?token=[REDACTED]",
    });
  });

  it("passes a crumb with no message or data through", () => {
    expect(scrubBreadcrumb({ category: "ui.click" })).toEqual({ category: "ui.click" });
  });
});

describe("scrubEvent", () => {
  it("strips the token from exception values, the message, extras and attached crumbs", () => {
    const event = {
      message: CAPACITOR_ERROR,
      exception: { values: [{ type: "Error", value: CAPACITOR_ERROR }, { type: "Error" }] },
      extra: { context: "share", detail: { error: CAPACITOR_ERROR } },
      breadcrumbs: [
        { category: "app", message: "share_file_download_failed", data: { error: CAPACITOR_ERROR } },
        { category: "fetch", data: { url: "/x?email=a@b.co" } },
      ],
    } as unknown as SentryEvent;

    const out = scrubEvent(event);

    expect(JSON.stringify(out)).not.toContain("secret-token");
    expect(out.message).toBe(`Error downloading file: ${STORAGE_PATH}`);
    expect(out.exception?.values?.[0].value).toBe(`Error downloading file: ${STORAGE_PATH}`);
    expect(out.exception?.values?.[1].value).toBeUndefined();
    expect(out.extra).toEqual({ context: "share", detail: { error: `Error downloading file: ${STORAGE_PATH}` } });
    expect(out.breadcrumbs?.[1].data).toEqual({ url: "/x?email=[REDACTED]" });
  });

  it("scrubs the request URL, drops headers and cookies, and removes user email and IP", () => {
    const event = {
      request: { url: "https://skatehubba.com/?token=t&tab=feed", headers: { a: "b" }, cookies: { c: "d" } },
      user: { id: "uid_12345678", email: "a@b.co", ip_address: "1.2.3.4" },
    } as unknown as SentryEvent;

    const out = scrubEvent(event);

    expect(out.request).toEqual({ url: "https://skatehubba.com/?token=[REDACTED]&tab=feed" });
    expect(out.user).toEqual({ id: "uid_12345678" });
  });

  it("leaves an event with none of those fields as it is", () => {
    const event = { request: {}, level: "error" } as unknown as SentryEvent;
    expect(scrubEvent(event)).toEqual({ request: {}, level: "error" });
  });
});

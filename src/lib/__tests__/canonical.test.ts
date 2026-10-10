import { describe, expect, it } from "vitest";
import { applyCanonical, canonicalHref } from "../canonical";

describe("canonicalHref", () => {
  it("uses the route, including a trailing slash", () => {
    expect(canonicalHref("/")).toBe("https://skatehubba.com/");
    expect(canonicalHref("/auth")).toBe("https://skatehubba.com/auth");
    expect(canonicalHref("/auth/")).toBe("https://skatehubba.com/auth");
    expect(canonicalHref("/feed")).toBe("https://skatehubba.com/feed");
    expect(canonicalHref("/privacy")).toBe("https://skatehubba.com/privacy");
    expect(canonicalHref("/terms")).toBe("https://skatehubba.com/terms");
  });

  it("leaves signed-in app routes alone", () => {
    expect(canonicalHref("/lobby")).toBeNull();
  });
});

describe("applyCanonical", () => {
  it("rewrites the head link", () => {
    const link = document.createElement("link");
    link.rel = "canonical";
    link.href = "https://skatehubba.com/";
    document.head.appendChild(link);
    applyCanonical("/auth");
    expect(link.href).toBe("https://skatehubba.com/auth");
    link.remove();
  });

  it("does not add a second link for an app route", () => {
    const link = document.createElement("link");
    link.rel = "canonical";
    link.href = "https://skatehubba.com/";
    document.head.appendChild(link);
    applyCanonical("/lobby");
    expect(link.href).toBe("https://skatehubba.com/");
    expect(document.querySelectorAll('head link[rel="canonical"]')).toHaveLength(1);
    link.remove();
  });
});

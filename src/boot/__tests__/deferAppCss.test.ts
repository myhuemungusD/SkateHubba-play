import { describe, expect, it } from "vitest";
import { deferAppEntry, deferAppStylesheet } from "../../../scripts/deferAppCss";

describe("deferAppStylesheet", () => {
  it("marks the built app stylesheet as print so it does not block the shell", () => {
    const html = '<link rel="stylesheet" crossorigin href="/assets/index-abc.css">';
    expect(deferAppStylesheet(html)).toBe(
      '<link media="print" data-app-css="" rel="stylesheet" crossorigin href="/assets/index-abc.css">',
    );
  });

  it("moves the entry module behind a meta tag and drops modulepreloads", () => {
    const html = [
      '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
      '<link rel="modulepreload" crossorigin href="/assets/react-xyz.js">',
      "</head>",
    ].join("");
    expect(deferAppEntry(html)).toBe('<meta name="app-entry" content="/assets/index-abc.js"></head>');
  });

  it("leaves dev HTML without a built entry unchanged", () => {
    const html = '<script type="module" src="/src/main.tsx"></script></head>';
    expect(deferAppEntry(html)).toBe(html);
  });

  it("leaves the shell stylesheet and already-deferred links alone", () => {
    const html = [
      '<link rel="stylesheet" href="/lcp.css" />',
      '<link media="print" rel="stylesheet" href="/assets/index-abc.css">',
    ].join("");
    expect(deferAppStylesheet(html)).toBe(html);
  });
});

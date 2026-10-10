import { describe, expect, it } from "vitest";
import { dismissLcpShell } from "../dismissLcpShell";

describe("dismissLcpShell", () => {
  it("removes every pre-JS shell and marks the document done", () => {
    document.body.innerHTML =
      '<div class="lcp-shell lcp-shell-home"></div><div class="lcp-shell lcp-shell-auth"></div><div id="root"></div>';
    document.documentElement.setAttribute("data-lcp", "home");
    dismissLcpShell();
    expect(document.querySelector(".lcp-shell")).toBeNull();
    expect(document.getElementById("root")).not.toBeNull();
    expect(document.documentElement.getAttribute("data-lcp")).toBe("done");
  });
});

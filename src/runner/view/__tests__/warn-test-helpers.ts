import { expect, type MockInstance } from "vitest";

/**
 * One console call as lowercase words. The runner's load-failure warnings
 * read either `console.warn("Runner low rail failed to load", error)` or, once
 * they go through the logger (#928), `"[WARN]", "runner_low_rail_load_failed",
 * { error: message }`. Both flatten to text that holds the same words and the
 * error's message, so tests check those and not the exact wording.
 */
function callText(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) return arg.message;
      if (typeof arg === "object" && arg !== null) return JSON.stringify(arg);
      return String(arg);
    })
    .join(" ")
    .toLowerCase()
    .replace(/_/g, " ");
}

function warnings(warn: MockInstance, words: string[]): string[] {
  return warn.mock.calls.map(callText).filter((text) => words.every((word) => text.includes(word.toLowerCase())));
}

/** Expect a warning that names every word in `words` and carries `detail` (an error's message, a count). */
export function expectWarned(warn: MockInstance, words: string[], detail?: string): void {
  const all = warn.mock.calls.map(callText);
  const hits = warnings(warn, words).filter((text) => detail === undefined || text.includes(detail.toLowerCase()));
  expect(hits, `no warning with ${JSON.stringify(words)} ${detail ?? ""} in ${JSON.stringify(all)}`).not.toHaveLength(
    0,
  );
}

/** Expect no warning that names every word in `words`. */
export function expectNotWarned(warn: MockInstance, words: string[]): void {
  expect(warnings(warn, words)).toEqual([]);
}

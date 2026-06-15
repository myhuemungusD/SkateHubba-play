/**
 * Unit coverage for scripts/check-release-tags.mjs.
 *
 * Strategy mirrors scripts-duplication-gate.test.ts and scripts-file-length.test.ts:
 * copy the script into a temp fixture so its `REPO_ROOT` (derived from
 * import.meta.url) lands inside the fixture, then drive it via spawnSync.
 *
 * Two test hooks let us avoid the network entirely:
 *  - `RELEASE_TAGS_SOURCE_FILE` env var: the script reads this file as the
 *    newline-delimited tag list instead of calling git. Used by happy-path and
 *    mismatch cases.
 *  - A fake `git` shim on PATH that exits non-zero: used by the
 *    GIT_CALL_FAILED degradation cases.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, delimiter } from "node:path";
import { spawnSync } from "node:child_process";

// The fake-git tests overwrite PATH to point at a shim that exits non-zero.
// We need node's own directory on PATH so spawnSync can still find the
// interpreter when the test passes a constrained PATH.
const NODE_BIN_DIR = dirname(process.execPath);

const SCRIPT = resolve(__dirname, "../../scripts/check-release-tags.mjs");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(fixtureRoot: string, args: string[] = [], env: NodeJS.ProcessEnv = {}): RunResult {
  const result = spawnSync("node", [join(fixtureRoot, "scripts/check-release-tags.mjs"), ...args], {
    cwd: fixtureRoot,
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function seedFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "release-tags-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  const scriptSrc = readFileSync(SCRIPT, "utf-8");
  writeFileSync(join(dir, "scripts/check-release-tags.mjs"), scriptSrc);
  return dir;
}

function writeManifest(dir: string, contents: string): void {
  writeFileSync(join(dir, ".release-please-manifest.json"), contents);
}

function writeTagFile(dir: string, tags: string[]): string {
  const path = join(dir, "fake-tags.txt");
  // Mix ls-remote-style and plain lines so parseTagList is exercised honestly.
  const lines = tags.map((t, i) => (i % 2 === 0 ? `deadbeef\trefs/tags/${t}` : t));
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

/**
 * Drop a fake `git` executable in `dir/bin/git` that exits non-zero with a
 * fixed stderr. Returns the bin dir so callers can prepend it to PATH.
 */
function seedFailingGit(dir: string): string {
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const gitPath = join(binDir, "git");
  writeFileSync(gitPath, "#!/usr/bin/env sh\necho 'fatal: simulated git failure' 1>&2\nexit 128\n");
  chmodSync(gitPath, 0o755);
  return binDir;
}

describe("check-release-tags.mjs", () => {
  let fixture: string;

  beforeEach(() => {
    fixture = seedFixture();
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it("passes when every manifest version has a matching git tag", () => {
    writeManifest(fixture, JSON.stringify({ ".": "1.2.3" }));
    const tagsFile = writeTagFile(fixture, ["v1.0.0", "v1.2.3", "v2.0.0-rc.1"]);
    const res = runScript(fixture, ["--strict"], { RELEASE_TAGS_SOURCE_FILE: tagsFile });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Release tag gate: OK/);
    expect(res.stdout).toMatch(/1 manifest entry matched/);
  });

  it("fails with MANIFEST_MISSING_TAG when a manifest version has no tag", () => {
    writeManifest(fixture, JSON.stringify({ ".": "1.1.0", "packages/app": "0.4.0" }));
    const tagsFile = writeTagFile(fixture, ["v1.0.0", "packages/app-v0.3.0"]);
    const res = runScript(fixture, ["--strict"], { RELEASE_TAGS_SOURCE_FILE: tagsFile });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/MANIFEST_MISSING_TAG/);
    expect(res.stderr).toMatch(/expected tag "v1\.1\.0"/);
    expect(res.stderr).toMatch(/expected tag "v0\.4\.0"/);
    expect(res.stderr).toMatch(/Hint:/);
  });

  it("emits structured JSON with the missing-tag list", () => {
    writeManifest(fixture, JSON.stringify({ ".": "9.9.9" }));
    const tagsFile = writeTagFile(fixture, ["v1.0.0"]);
    const res = runScript(fixture, ["--json", "--strict"], { RELEASE_TAGS_SOURCE_FILE: tagsFile });
    expect(res.status).toBe(1);
    const parsed = JSON.parse(res.stdout) as {
      ok: boolean;
      code: string;
      missing: { path: string; version: string; expectedTag: string }[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("MANIFEST_MISSING_TAG");
    expect(parsed.missing).toEqual([{ path: ".", version: "9.9.9", expectedTag: "v9.9.9" }]);
  });

  it("fails MANIFEST_MALFORMED when the file is missing", () => {
    // No manifest written.
    const tagsFile = writeTagFile(fixture, ["v1.0.0"]);
    const res = runScript(fixture, ["--strict"], { RELEASE_TAGS_SOURCE_FILE: tagsFile });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/MANIFEST_MALFORMED/);
    expect(res.stderr).toMatch(/does not exist/);
  });

  it("fails MANIFEST_MALFORMED when the file is not JSON", () => {
    writeManifest(fixture, "this is not json {");
    const tagsFile = writeTagFile(fixture, ["v1.0.0"]);
    const res = runScript(fixture, ["--strict"], { RELEASE_TAGS_SOURCE_FILE: tagsFile });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/MANIFEST_MALFORMED/);
    expect(res.stderr).toMatch(/invalid JSON/);
  });

  it("fails MANIFEST_MALFORMED when the JSON shape is wrong", () => {
    writeManifest(fixture, JSON.stringify(["1.0.0"]));
    const tagsFile = writeTagFile(fixture, ["v1.0.0"]);
    const res = runScript(fixture, ["--strict"], { RELEASE_TAGS_SOURCE_FILE: tagsFile });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/MANIFEST_MALFORMED/);
    expect(res.stderr).toMatch(/expected a JSON object/);
  });

  it("fails MANIFEST_MALFORMED when a version is non-string", () => {
    writeManifest(fixture, JSON.stringify({ ".": 1.0 }));
    const tagsFile = writeTagFile(fixture, ["v1.0.0"]);
    const res = runScript(fixture, ["--strict"], { RELEASE_TAGS_SOURCE_FILE: tagsFile });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/MANIFEST_MALFORMED/);
    expect(res.stderr).toMatch(/non-string or empty version/);
  });

  it("degrades to a warning when git fails and --strict is NOT set", () => {
    writeManifest(fixture, JSON.stringify({ ".": "1.0.0" }));
    const binDir = seedFailingGit(fixture);
    const res = runScript(fixture, [], { PATH: `${binDir}${delimiter}${NODE_BIN_DIR}${delimiter}/usr/bin:/bin` });
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/GIT_CALL_FAILED/);
    expect(res.stderr).toMatch(/Skipping check/);
  });

  it("fails hard when git fails and --strict IS set", () => {
    writeManifest(fixture, JSON.stringify({ ".": "1.0.0" }));
    const binDir = seedFailingGit(fixture);
    const res = runScript(fixture, ["--strict"], {
      PATH: `${binDir}${delimiter}${NODE_BIN_DIR}${delimiter}/usr/bin:/bin`,
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/GIT_CALL_FAILED/);
    expect(res.stderr).not.toMatch(/Skipping check/);
  });

  it("emits JSON degraded payload when git fails without --strict and --json is set", () => {
    writeManifest(fixture, JSON.stringify({ ".": "1.0.0" }));
    const binDir = seedFailingGit(fixture);
    const res = runScript(fixture, ["--json"], {
      PATH: `${binDir}${delimiter}${NODE_BIN_DIR}${delimiter}/usr/bin:/bin`,
    });
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout) as { ok: boolean; code: string; degraded: boolean; strict: boolean };
    expect(parsed.code).toBe("GIT_CALL_FAILED");
    expect(parsed.degraded).toBe(true);
    expect(parsed.strict).toBe(false);
    expect(parsed.ok).toBe(true);
  });

  it("rejects unknown flags with exit code 2", () => {
    writeManifest(fixture, JSON.stringify({ ".": "1.0.0" }));
    const tagsFile = writeTagFile(fixture, ["v1.0.0"]);
    const res = runScript(fixture, ["--bogus"], { RELEASE_TAGS_SOURCE_FILE: tagsFile });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/Unknown argument: --bogus/);
  });
});

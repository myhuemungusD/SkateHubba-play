/**
 * Prepare Skateboard_01 for the runner. Not part of CI or `npm run verify`.
 *
 * Usage:
 *   node scripts/compress-runner-board.mjs <source.glb> [--draco] [--ktx2]
 *
 * Default: resize PNG/JPEG textures to 1024, convert every texture to WebP,
 * then compress geometry with Meshopt. The mesh is not simplified.
 *
 * --draco uses Draco instead of Meshopt.
 * --ktx2 encodes normals and occlusion with Basis UASTC and the remaining
 * textures with ETC1S. That path needs the `toktx` encoder, which this
 * project does not install. WebP is the path that runs without it.
 *
 * Output: src/runner/assets/skateboard-01.glb
 * Then return that URL from skateboard01ModelUrl() in src/runner/artSlots.ts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "src/runner/assets/skateboard-01.glb");
const args = process.argv.slice(2);
const source = args.find((arg) => !arg.startsWith("--"));
const useDraco = args.includes("--draco");
const useKtx2 = args.includes("--ktx2");

if (!source) {
  console.error("Usage: node scripts/compress-runner-board.mjs <source.glb> [--draco] [--ktx2]");
  process.exit(1);
}

const input = resolve(source);
if (!existsSync(input)) {
  console.error(`Missing ${input}`);
  console.error("Download Skateboard_01 (Sketchfab, CC BY 4.0) and pass that glTF or glb.");
  process.exit(1);
}

if (useKtx2) {
  const toktx = spawnSync("toktx", ["--version"], { stdio: "ignore" });
  if (toktx.status !== 0) {
    console.error("KTX2 needs the toktx encoder (Basis Universal). It is not installed.");
    console.error("Install toktx, or rerun without --ktx2 to write WebP textures instead.");
    process.exit(1);
  }
}

function transform(commandArgs) {
  const result = spawnSync("npx", ["--yes", "@gltf-transform/cli@4", ...commandArgs], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const work = mkdtempSync(resolve(tmpdir(), "skateboard-01-"));
const resized = resolve(work, "resized.glb");
const textured = resolve(work, "textured.glb");

try {
  transform(["resize", input, resized, "--width", "1024", "--height", "1024"]);
  if (useKtx2) {
    const uastc = resolve(work, "uastc.glb");
    transform(["uastc", resized, uastc, "--slots", "{normalTexture,occlusionTexture}", "--level", "2"]);
    transform([
      "etc1s",
      uastc,
      textured,
      "--slots",
      "{baseColorTexture,emissiveTexture,metallicRoughnessTexture}",
      "--quality",
      "128",
    ]);
  } else {
    transform(["webp", resized, textured, "--quality", "80"]);
  }
  transform(
    useDraco
      ? ["draco", textured, output, "--method", "edgebreaker"]
      : ["meshopt", textured, output, "--level", "medium"],
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`Wrote ${output}`);
console.log("Import that file from skateboard01ModelUrl() in src/runner/artSlots.ts.");

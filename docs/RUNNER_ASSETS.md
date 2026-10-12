# Runner assets

Textures for `/play/runner` only. They are imported from `src/runner/view/textures.ts`, which the lazy runner route loads. They are not part of the main app bundle, so the lobby and the rest of the game do not download them.

The PBR maps, the HDRI, and the three runner one-shots shipped here are CC0. The SkateHubba logo and the two graffiti posters are brand art owned by Design Mainline LLC and are cleared for the game. Skateboard_01, the low rail, and Skatepark Obstacles are CC BY 4.0. The compressed payload of the files in this folder is about 4.57 MB.

| File                       |   Bytes | Use                                        |
| -------------------------- | ------: | ------------------------------------------ |
| `asphalt-color.webp`       |   23342 | Road albedo                                |
| `asphalt-normal.webp`      |   65448 | Road normal                                |
| `asphalt-roughness.webp`   |   28876 | Road roughness                             |
| `concrete-color.webp`      |    9162 | Sidewalk and ledge albedo                  |
| `concrete-normal.webp`     |   65540 | Sidewalk, ledge, and wax normal            |
| `concrete-roughness.webp`  |    9860 | Sidewalk and ledge roughness               |
| `metal-color.webp`         |   12500 | Rail, coping, and truck albedo             |
| `metal-normal.webp`        |    7106 | Rail, coping, and truck normal             |
| `metal-roughness.webp`     |    5524 | Rail, coping, and truck roughness          |
| `metal-metalness.webp`     |    5222 | Rail, coping, and truck metalness          |
| `brick-color.webp`         |   26142 | Wall and building albedo                   |
| `brick-normal.webp`        |   71880 | Wall and building normal                   |
| `brick-roughness.webp`     |   31540 | Wall and building roughness                |
| `sunset_jhbcentral_1k.hdr` | 1573705 | Dusk environment light and reflections     |
| `board-logo.webp`          |   42058 | Deck underside, top mark, and wall poster  |
| `graff-wall.webp`          |   47304 | Left-wall mural                            |
| `hubba-graff.webp`         |   79650 | Right-wall mural                           |
| `skateboard-01.glb`        |  368992 | Player board (Meshopt + WebP)              |
| `low-rail.glb`             |  338236 | Grind rail (Meshopt + WebP)                |
| `skatepark-obstacles.glb`  | 1739308 | Ledges and sidewalk props (Meshopt + WebP) |
| `sfx/pop.wav`              |    4012 | Pop one-shot                               |
| `sfx/grind.wav`            |    9746 | Grind and powerslide one-shot              |
| `sfx/land.wav`             |    6218 | Landing one-shot                           |

Total: 4571371 bytes.

Maps are 512×512 WebP (color and roughness quality 76–78, normals 90) with mipmaps and anisotropy capped at 4. The logo is 512×512 WebP. The murals are 640×960 WebP. The HDRI is the official 1k RGBE file, used as `scene.environment` only. The background stays the dusk street color.

Phones and machines with 4 GB of memory or fewer, or 4 cores or fewer, stay on the low tier: the blob shadow under the board, and no shadow map. A desktop draws one 512×512 soft shadow map from the warm key light. Lamp glow is an additive card on the lamp head plus a pool on the ground. There is no fullscreen bloom pass.

The metal color was brightened after compression so a rail reads against asphalt. Normal, roughness, and metalness are the source maps, only resized. Griptape and the deck wood grain are still drawn in code. They are not third-party files.

## Sources

License for every ambientCG file: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), as stated on [ambientCG's license page](https://docs.ambientcg.com/license/).

| Asset               | Page                                      | Download                                              |
| ------------------- | ----------------------------------------- | ----------------------------------------------------- |
| Asphalt019, 1K JPG  | https://ambientcg.com/view?id=Asphalt019  | https://ambientcg.com/get?file=Asphalt019_1K-JPG.zip  |
| Concrete034, 1K JPG | https://ambientcg.com/view?id=Concrete034 | https://ambientcg.com/get?file=Concrete034_1K-JPG.zip |
| Metal038, 1K JPG    | https://ambientcg.com/view?id=Metal038    | https://ambientcg.com/get?file=Metal038_1K-JPG.zip    |
| Bricks060, 1K JPG   | https://ambientcg.com/view?id=Bricks060   | https://ambientcg.com/get?file=Bricks060_1K-JPG.zip   |

Bricks060 is a clean brick wall. It is not a graffiti texture.

The pop, grind, and land one-shots in `sfx/` were generated for Skate Runner and released [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). They are not a third-party recording.

The HDRI is Poly Haven `sunset_jhbcentral`, 1k HDR. License: [CC0](https://polyhaven.com/license).

- Asset page: https://polyhaven.com/a/sunset_jhbcentral
- File: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/sunset_jhbcentral_1k.hdr

## Brand art

Owned by Design Mainline LLC. Cleared to ship in the game. These are not CC0.

| File               | Source in the art pack   | Use                                            |
| ------------------ | ------------------------ | ---------------------------------------------- |
| `board-logo.webp`  | `logov2_transparent.png` | Board underside, small top mark, shop and wall |
| `graff-wall.webp`  | `graff_wall.jpg`         | Mural on the left wall                         |
| `hubba-graff.webp` | `hubbagraffwall.jpg`     | Mural on the right wall                        |

The shop front (dark green awning, yellow “THE HUBBASPOT” / “SKATESHOP”) is built from meshes. The lettering is drawn in the runner with Bebas Neue, the same display face as the HUD. The USPTO scan was the reference for the mark and is not a separate texture.

## Skateboard model

Jason supplied Skateboard_01 by CrazyScans (https://sketchfab.com/RandomScan). The source file's textures were already 1024. `toktx` is not installed here, so the glb is Meshopt geometry plus WebP textures (quality 80), not KTX2. The mesh is not simplified. `loadRunnerModel` still accepts Draco, Meshopt, KTX2, and WebP.

`skateboard01ModelUrl()` points at `src/runner/assets/skateboard-01.glb`. The loader scales it to length 1.9 inside the posed group (that group is already scaled 1.4), points the nose toward **-Z**, and sits the wheels on the rig origin. This file's thin axis points at the wheels, so the fit flips that axis and keeps the kicked deck on top. `ProceduralBoard` hides only after the file loads. A failed load leaves the procedural board on screen. The file is one mesh, so named wheel nodes are absent and the wheels do not spin on their own.

The bottom graphic is a separate plane named `Graphic`. `customBoardGraphicUrl()` paints it with the SkateHubba logo. Swap that file to change the underside without editing the glb.

Credit line, copied from the model's `license.txt`:

This work is based on "Skateboard_01" (https://sketchfab.com/3d-models/skateboard-01-bc02544579d34003a703962d7b930e7b) by CrazyScans (https://sketchfab.com/RandomScan) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Low rail

Jason supplied Low Rail | Game Ready | 4K by bralunit (https://sketchfab.com/bral_unit). Same compression as the board: Meshopt and WebP, textures already 1024. `lowRailModelUrl()` points at `src/runner/assets/low-rail.glb`. Each pool slot clones that one load. The clone is fit to length 7, which is `RAIL_LENGTH`, and the existing stretch still runs if a length ever differs. The box rail and its posts stay in the pool and show only if the file fails to load. Grind timing and lane checks are unchanged.

Credit line, copied from the model's `license.txt`:

This work is based on "Low Rail | Game Ready | 4K" (https://sketchfab.com/3d-models/low-rail-game-ready-4k-ec7bba14b8984e67ab459c20422171a0) by bralunit (https://sketchfab.com/bral_unit) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Skatepark obstacles

Jason supplied Skatepark Obstacles by rhcreations (https://sketchfab.com/rhcreations). The source is one scene with spec-gloss materials. `gltf-transform metalrough` converts those to metallic-roughness, because three.js does not load `KHR_materials_pbrSpecularGlossiness`. Textures were already 1024. `toktx` is not installed here, so the kept nodes are Meshopt plus WebP (quality 80).

`skateparkModelUrl()` points at `src/runner/assets/skatepark-obstacles.glb`. The file is loaded once. Box slots clone the grindable nodes: funboxes (including the one with coping), table tops with a ledge or a rail, both hips with a ledge, Rail 1, Rail 1 High to Low, Curved Rail 1, and the picnic bench. Each clone is scaled to stay inside the lane and near the existing grind height. The waxed box stays in the pool and shows only if the file fails. Grind timing, lanes, and collision are unchanged.

Banks, quarterpipes, and kickers are cloned onto the sidewalk, between the curb and the wall. They are scenery. Spines, mini ramps, volcanoes, humps, roll-ins, plain table tops, and the ground plane are not in the run.

Credit line, copied from the model's `license.txt`:

This work is based on "Skatepark Obstacles" (https://sketchfab.com/3d-models/skatepark-obstacles-235d1cab2dfe4d63b46030db8d459699) by rhcreations (https://sketchfab.com/rhcreations) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

All three license lines are on the pause card. The URLs in each sentence are links.

Decoders are same-origin and are fetched only when a model URL is set:

| Decoder                             | Path                            | License                                                                          |
| ----------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| Draco glTF (js, wasm wrapper, wasm) | `public/runner/decoders/draco/` | [Apache 2.0](https://github.com/google/draco/blob/master/LICENSE)                |
| Basis Universal transcoder          | `public/runner/decoders/basis/` | [Apache 2.0](https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE) |

Meshopt stays inside the three.js package (MIT) and loads with the model chunk. The copied Draco files are the glTF builds, not the larger default decoder.

The PBR maps and the HDRI stay CC0. The logo and murals are Design Mainline LLC art. The board, the rail, and the skatepark pieces are the CC BY files.

## Slots for later art

The logo, Skateboard_01, the low rail, and the skatepark pieces are filled. The Mike White model stays empty until that file is in the repo. The constants live in `src/runner/artSlots.ts`. Do not add an import for a file that is not in the repo. A missing import fails the build.

| Slot             | Constant               | File                                        | What it drives                                                                          |
| ---------------- | ---------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Deck graphic     | `CUSTOM_BOARD_GRAPHIC` | `src/runner/assets/board-logo.webp`         | `Graphic` mesh on the underside of the deck                                             |
| Logo decal       | `CUSTOM_LOGO_DECAL`    | `src/runner/assets/board-logo.webp`         | `LogoDecal` mesh, the small mark on top of the griptape                                 |
| Skateboard_01    | `SKATEBOARD_01_MODEL`  | `src/runner/assets/skateboard-01.glb`       | `loadRunnerModel`. Hides `ProceduralBoard` after a successful load.                     |
| Low rail         | `LOW_RAIL_MODEL`       | `src/runner/assets/low-rail.glb`            | Cloned into each rail slot. The box rail remains the fallback.                          |
| Skatepark        | `SKATEPARK_MODEL`      | `src/runner/assets/skatepark-obstacles.glb` | Ledge nodes replace the box mesh. Banks, quarterpipes, and kickers sit on the sidewalk. |
| Mike White board | `MIKE_WHITE_BOARD`     | `src/runner/assets/mike-white-board.glb`    | Still empty. Not loaded by the Skateboard_01 path.                                      |

`customBoardGraphicUrl()` and `customLogoDecalUrl()` both return the logo. `skateboard01ModelUrl()`, `lowRailModelUrl()`, and `skateparkModelUrl()` return the glbs. `mikeWhiteBoardUrl()` stays null. The posed group is `BoardRig` (nose toward **-Z**). `Graphic` lives on that rig, outside `ProceduralBoard`. Node names on the procedural board: `Deck`, `DeckPly`, `Griptape`, `LogoDecal`, `TruckNose`, `TruckTail`, `WheelNoseLeft`, `WheelNoseRight`, `WheelTailLeft`, `WheelTailRight`.

# Runner assets

Textures for `/play/runner` only. They are imported from `src/runner/view/textures.ts`, which the lazy runner route loads. They are not part of the main app bundle, so the lobby and the rest of the game do not download them.

The PBR maps, the HDRI, and the three runner one-shots shipped here are CC0. The SkateHubba logo and the two graffiti posters are brand art owned by Design Mainline LLC and are cleared for the game. Skateboard_01, the low rail, and Skatepark Obstacles are CC BY 4.0. The runner loads the KTX2 maps below, not the WebP sources sitting next to them.

| File                       |   Bytes | Use                                        |
| -------------------------- | ------: | ------------------------------------------ |
| `asphalt-color.ktx2`       |  194614 | Road albedo, UASTC                         |
| `asphalt-normal.ktx2`      |  261875 | Road normal, UASTC                         |
| `asphalt-roughness.ktx2`   |   71485 | Road roughness, ETC1S                      |
| `concrete-color.ktx2`      |  146349 | Sidewalk and ledge albedo, UASTC           |
| `concrete-normal.ktx2`     |  288650 | Sidewalk, ledge, and wax normal, UASTC     |
| `concrete-roughness.ktx2`  |   42395 | Sidewalk and ledge roughness, ETC1S        |
| `metal-color.ktx2`         |  171067 | Rail, coping, and truck albedo, UASTC      |
| `metal-normal.ktx2`        |   64366 | Rail, coping, and truck normal, UASTC      |
| `metal-roughness.ktx2`     |   26288 | Rail, coping, and truck roughness, ETC1S   |
| `metal-metalness.ktx2`     |   14843 | Rail, coping, and truck metalness, ETC1S   |
| `brick-color.ktx2`         |  235200 | Wall and building albedo, UASTC            |
| `brick-normal.ktx2`        |  262029 | Wall and building normal, UASTC            |
| `brick-roughness.ktx2`     |   71742 | Wall and building roughness, ETC1S         |
| `alley-palette.ktx2`       |     325 | Shared alley colors, UASTC, no mips        |
| `sunset_jhbcentral_1k.hdr` | 1573705 | Dusk environment light and reflections     |
| `board-logo.webp`          |   42058 | Deck underside, top mark, and wall poster  |
| `graff-wall.webp`          |   47304 | Left-wall mural                            |
| `hubba-graff.webp`         |   79650 | Right-wall mural                           |
| `skateboard-01.glb`        |  368992 | Player board (Meshopt + WebP)              |
| `low-rail.glb`             |  338236 | Grind rail (Meshopt + WebP)                |
| `skatepark-obstacles.glb`  | 1739308 | Ledges and sidewalk props (Meshopt + WebP) |
| `sfx/pop.wav`              |    4012 | Pop one-shot                               |
| `sfx/grind.wav`            |    9746 | Grind attack and powerslide one-shot       |
| `sfx/land.wav`             |    6218 | Landing one-shot                           |

The 13 tiling KTX2 maps are 1,850,903 bytes. The alley palette adds 325 bytes and is the only map on the pole, awning, stripe, dumpster, and lid. The WebP files they were encoded from stay in the folder (531,154 bytes) and are not imported, so the runner does not download them. Roll and grind loops are synthesized at runtime and are not files.

Maps are 512×512. Color and normals are UASTC, zstd packed, with mipmaps. Roughness and metalness are ETC1S with mipmaps. Anisotropy is capped at 4. The logo is 512×512 WebP. The murals are 640×960 WebP. The HDRI is the official 1k RGBE file, used as `scene.environment` only. The background stays the dusk street color.

Phones and machines with 4 GB of memory or fewer, or 4 cores or fewer, stay on the low tier: pixel ratio 1, the blob shadow under the board, and no shadow map. A desktop caps pixel ratio at 1.5 and draws one 512×512 soft shadow map from the warm key light, plus a short bloom pass. Lamp glow is an additive card on the lamp head plus a pool on the ground, on both tiers. The road, sidewalks, curbs, walls, and dashes are instanced. Sparks are an instanced additive spray.

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

Three Freesound files were checked before this pass and not shipped. Each page's license link is [CC0 1.0](http://creativecommons.org/publicdomain/zero/1.0/): [Skateboard_Grinds.wav](https://freesound.org/people/BlackNeon1234/sounds/348326/) (2.7 MB, 24-bit stereo), [skateboard ollie](https://freesound.org/people/nolimitkid/sounds/515229/) (CC0, confirmed on the sound page and in pack 28982), and [Skateboarding Rail Slide](https://freesound.org/people/C-V/sounds/845524/) (2.2 MB, 24-bit stereo). The long takes would sit in the lazy runner chunk. The short generated one-shots stay. Pop and land pitch still wander by ±5%.

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

Jason supplied Skateboard_01 by CrazyScans (https://sketchfab.com/RandomScan). The source file's textures were already 1024. The glb stays Meshopt geometry plus WebP textures (quality 80). The mesh is not simplified. `toktx` encoded the loose street maps to KTX2. It was not run on this glb. `loadRunnerModel` still accepts Draco, Meshopt, KTX2, and WebP.

`skateboard01ModelUrl()` points at `src/runner/assets/skateboard-01.glb`. The loader scales it to length 1.9 inside the posed group (that group is already scaled 1.4), points the nose toward **-Z**, and sits the wheels on the rig origin. This file's thin axis points at the wheels, so the fit flips that axis and keeps the kicked deck on top. `ProceduralBoard` hides only after the file loads. A failed load leaves the procedural board on screen. The file is one mesh, so named wheel nodes are absent and the wheels do not spin on their own.

The bottom graphic is a separate plane named `Graphic`. `customBoardGraphicUrl()` paints it with the SkateHubba logo. Swap that file to change the underside without editing the glb.

Credit line, copied from the model's `license.txt`:

This work is based on "Skateboard_01" (https://sketchfab.com/3d-models/skateboard-01-bc02544579d34003a703962d7b930e7b) by CrazyScans (https://sketchfab.com/RandomScan) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Low rail

Jason supplied Low Rail | Game Ready | 4K by bralunit (https://sketchfab.com/bral_unit). Same compression as the board: Meshopt and WebP, textures already 1024. `lowRailModelUrl()` points at `src/runner/assets/low-rail.glb`. Each pool slot clones that one load. The clone is fit to length 7, which is `RAIL_LENGTH`, and the existing stretch still runs if a length ever differs. The box rail and its posts stay in the pool and show only if the file fails to load. Grind timing and lane checks are unchanged.

Credit line, copied from the model's `license.txt`:

This work is based on "Low Rail | Game Ready | 4K" (https://sketchfab.com/3d-models/low-rail-game-ready-4k-ec7bba14b8984e67ab459c20422171a0) by bralunit (https://sketchfab.com/bral_unit) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

## Skatepark obstacles

Jason supplied Skatepark Obstacles by rhcreations (https://sketchfab.com/rhcreations). The source is one scene with spec-gloss materials. `gltf-transform metalrough` converts those to metallic-roughness, because three.js does not load `KHR_materials_pbrSpecularGlossiness`. Textures were already 1024. The kept nodes stay Meshopt plus WebP (quality 80). `toktx` was used for the loose street maps, not for this glb.

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

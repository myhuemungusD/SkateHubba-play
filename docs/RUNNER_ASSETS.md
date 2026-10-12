# Runner assets

Textures for `/play/runner` only. They are imported from `src/runner/view/textures.ts`, which the lazy runner route loads. They are not part of the main app bundle, so the lobby and the rest of the game do not download them.

The PBR maps and the HDRI shipped here are CC0. The SkateHubba logo and the two graffiti posters are brand art owned by Design Mainline LLC and are cleared for the game. Skateboard_01 is CC BY 4.0 and is not in the build yet. The compressed payload of the files in this folder is about 2.10 MB.

| File                                          |   Bytes | Use                                       |
| --------------------------------------------- | ------: | ----------------------------------------- |
| `asphalt-color.webp`                          |   23342 | Road albedo                               |
| `asphalt-normal.webp`                         |   65448 | Road normal                               |
| `asphalt-roughness.webp`                      |   28876 | Road roughness                            |
| `concrete-color.webp`                         |    9162 | Sidewalk and ledge albedo                 |
| `concrete-normal.webp`                        |   65540 | Sidewalk, ledge, and wax normal           |
| `concrete-roughness.webp`                     |    9860 | Sidewalk and ledge roughness              |
| `metal-color.webp`                            |   12500 | Rail, coping, and truck albedo            |
| `metal-normal.webp`                           |    7106 | Rail, coping, and truck normal            |
| `metal-roughness.webp`                        |    5524 | Rail, coping, and truck roughness         |
| `metal-metalness.webp`                        |    5222 | Rail, coping, and truck metalness         |
| `brick-color.webp`                            |   26142 | Wall and building albedo                  |
| `brick-normal.webp`                           |   71880 | Wall and building normal                  |
| `brick-roughness.webp`                        |   31540 | Wall and building roughness               |
| `sunset_jhbcentral_1k.hdr`                    | 1573705 | Dusk environment light and reflections    |
| `board-logo.webp`                             |   42058 | Deck underside, top mark, and wall poster |
| `graff-wall.webp`                             |   47304 | Left-wall mural                           |
| `hubba-graff.webp`                            |   79650 | Right-wall mural                          |

Total: 2104859 bytes.

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

The HDRI is Poly Haven `sunset_jhbcentral`, 1k HDR. License: [CC0](https://polyhaven.com/license).

- Asset page: https://polyhaven.com/a/sunset_jhbcentral
- File: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/sunset_jhbcentral_1k.hdr

## Brand art

Owned by Design Mainline LLC. Cleared to ship in the game. These are not CC0.

| File                | Source in the art pack        | Use                                              |
| ------------------- | ----------------------------- | ------------------------------------------------ |
| `board-logo.webp`   | `logov2_transparent.png`      | Board underside, small top mark, shop and wall   |
| `graff-wall.webp`   | `graff_wall.jpg`              | Mural on the left wall                           |
| `hubba-graff.webp`  | `hubbagraffwall.jpg`          | Mural on the right wall                          |

The shop front (dark green awning, yellow “THE HUBBASPOT” / “SKATESHOP”) is built from meshes. The lettering is drawn in the runner with Bebas Neue, the same display face as the HUD. The USPTO scan was the reference for the mark and is not a separate texture.

## Skateboard model

Jason picked [Skateboard_01](https://sketchfab.com/3d-models/skateboard-01-bc02544579d34003a703962d7b930e7b) by RandomScan on Sketchfab (~18.5k faces). License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Commercial use is allowed. Credit is required.

Credit line: Skateboard_01 by RandomScan (Sketchfab), CC BY 4.0

That line is on the pause card. The model name links to the Sketchfab page. CC BY 4.0 links to the license.

The glTF is not in this repo yet. Sketchfab downloads need a login, so the file arrives with Jason's download. Until `skateboard01ModelUrl()` in `src/runner/artSlots.ts` returns a URL, the player stays the procedural board in `src/runner/view/Board.tsx` and the game does not fetch a model or a decoder.

When the file is here:

```bash
node scripts/compress-runner-board.mjs path/to/skateboard.glb
```

That writes `src/runner/assets/skateboard-01.glb`. It resizes PNG and JPEG textures to 1024, converts textures to WebP, and compresses geometry with Meshopt. It does not simplify the mesh. `--draco` uses Draco instead of Meshopt. `--ktx2` encodes normals and occlusion with Basis UASTC and the other textures with ETC1S. That path needs the `toktx` encoder, which is not installed here. WebP is the default that runs without it. The script is not part of CI.

Then return the imported URL from `skateboard01ModelUrl()`. `loadSkateboardModel` in `src/runner/view/skateboardModel.ts` accepts Draco, Meshopt, KTX2, and WebP. It scales the model to length 1.9 inside the posed group (that group is already scaled 1.4), points the nose toward **-Z**, and sits the bottom of the bounds on the rig origin. `SKATEBOARD_01_NOSE_FLIP` turns the board around if the nose faces the tail. Nodes whose names contain "wheel" spin on local X. `ProceduralBoard` hides only after the file loads. A failed load leaves the procedural board on screen.

Decoders are same-origin and are fetched only when a model URL is set:

| Decoder                                      | Path                            | License                                                                                      |
| -------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| Draco glTF (js, wasm wrapper, wasm)          | `public/runner/decoders/draco/` | [Apache 2.0](https://github.com/google/draco/blob/master/LICENSE)                            |
| Basis Universal transcoder                   | `public/runner/decoders/basis/` | [Apache 2.0](https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE)             |

Meshopt stays inside the three.js package (MIT) and loads with the model chunk. The copied Draco files are the glTF builds, not the larger default decoder.

The PBR maps and the HDRI stay CC0. The logo and murals are Design Mainline LLC art. This model is the CC BY file, and it is not in the build until the glb is added.

## Slots for later art

The logo slots are filled. The two model slots stay empty until those files are in the repo. The constants live in `src/runner/artSlots.ts`. Do not add an import for a file that is not in the repo. A missing import fails the build.

| Slot             | Constant               | File                                     | What it drives                                                                                                                                |
| ---------------- | ---------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Deck graphic     | `CUSTOM_BOARD_GRAPHIC` | `src/runner/assets/board-logo.webp`      | `Graphic` mesh on the underside of the deck                                                                                                   |
| Logo decal       | `CUSTOM_LOGO_DECAL`    | `src/runner/assets/board-logo.webp`      | `LogoDecal` mesh, the small mark on top of the griptape                                                                                       |
| Skateboard_01    | `SKATEBOARD_01_MODEL`  | `src/runner/assets/skateboard-01.glb`    | Still empty. `loadSkateboardModel` hides `ProceduralBoard` after a successful load.                                                           |
| Mike White board | `MIKE_WHITE_BOARD`     | `src/runner/assets/mike-white-board.glb` | Still empty. Not loaded by the Skateboard_01 path.                                                                                            |

`customBoardGraphicUrl()` and `customLogoDecalUrl()` both return the logo. The model getters stay null. The posed group is `BoardRig` (nose toward **-Z**). Node names already on the procedural board: `Deck`, `DeckPly`, `Griptape`, `Graphic`, `LogoDecal`, `TruckNose`, `TruckTail`, `WheelNoseLeft`, `WheelNoseRight`, `WheelTailLeft`, `WheelTailRight`.

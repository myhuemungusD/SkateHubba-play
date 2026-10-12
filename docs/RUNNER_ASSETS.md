# Runner assets

Textures for `/play/runner` only. They are imported from `src/runner/view/textures.ts`, which the lazy runner route loads. They are not part of the main app bundle, so the lobby and the rest of the game do not download them.

Everything shipped here is CC0. The compressed payload is about 1.71 MB.

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
| `kloofendal_48d_partly_cloudy_puresky_1k.hdr` | 1435119 | Daytime environment light and reflections |

Total: 1797261 bytes.

Maps are 512×512 WebP (color and roughness quality 76–78, normals 90) with mipmaps and anisotropy capped at 4. The HDRI is the official 1k RGBE file, used as `scene.environment` only. The background stays the street color. There are still no shadow maps.

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

The HDRI is Poly Haven `kloofendal_48d_partly_cloudy_puresky`, 1k HDR. License: [CC0](https://polyhaven.com/license).

- Asset page: https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
- File: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr

## Skateboard model

No skateboard glTF is in this build. A Sketchfab search for skateboard models under the CC0 license returned none. The downloadable boards that showed up were CC BY or CC BY-SA, so they are not included. The player stays the procedural board in `src/runner/view/Board.tsx` (deck ply, wood grain, griptape, trucks, wheels).

## Slots for later art

These stay empty until Jason supplies the files. The constants live in `src/runner/artSlots.ts`. Do not add an import for a file that is not in the repo. A missing import fails the build.

| Slot             | Constant               | Put the file at                          | What it drives                                                                                                                                |
| ---------------- | ---------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Deck graphic     | `CUSTOM_BOARD_GRAPHIC` | `src/runner/assets/board-graphic.webp`   | `Graphic` mesh                                                                                                                                |
| Logo decal       | `CUSTOM_LOGO_DECAL`    | `src/runner/assets/board-logo.webp`      | `LogoDecal` mesh, hidden until the URL is set                                                                                                 |
| Mike White board | `MIKE_WHITE_BOARD`     | `src/runner/assets/mike-white-board.glb` | Parent under the posed group. Hide the procedural meshes. Load with `GLTFLoader` or `@react-three/drei/core/Gltf`, not the drei package root. |

Return the imported URL from the matching function in `artSlots.ts`. `useCustomBoardArt` already paints the graphic and the logo. The posed group is `BoardRig` (nose toward **-Z**). Node names already on the procedural board: `Deck`, `DeckPly`, `Griptape`, `Graphic`, `LogoDecal`, `TruckNose`, `TruckTail`, `WheelNoseLeft`, `WheelNoseRight`, `WheelTailLeft`, `WheelTailRight`.

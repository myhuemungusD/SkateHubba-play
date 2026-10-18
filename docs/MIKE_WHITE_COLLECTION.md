# Mike White Signature collection

Every shoe in this collection was designed by **Mike White**, drawn by hand in a
paint app on his iPhone 13. Credit is a hard requirement:

- Every item card shows **"Designed by Mike White"**, his signature, and
  "Mike White Signature collection" (`src/components/DesignerCredit.tsx`).
- Credit is looked up by `itemDefId` (`designerCreditFor`), so a copy keeps it
  after it is traded.
- Anything a skater makes from one of his designs in Closet Studio must carry
  `MIKE_WHITE_TEMPLATE_CREDIT` ("Based on a Mike White design").
- Signature items are earn/drop only. They are never sold for Hubba Bucks.

Definitions: `src/lib/closet/mikeWhiteCollection.ts`. Art (512px WebP, about 10 KB
each) and the signature: `public/assets/closet/mike-white/`. Source files:
branch `assets/mike-white-shoe`, folder `design/closet/` (47 files).

The whole closet is behind `VITE_FEATURE_CLOSET_ENABLED` plus the server
`CLOSET_ENABLED` switch, both default off. To seed the catalog once the closet
functions are deployed, run each payload from `mikeWhiteSeedActions()` through
the `closetAdmin` callable.

## Items (37)

| itemDefId                        | Model                | Colorway               | Source file                                               |
| -------------------------------- | -------------------- | ---------------------- | --------------------------------------------------------- |
| `mike_white_signature_001`       | Mike White Signature | Tan / White / Navy     | `mike-white-shoe.png`                                     |
| `mike_white_m_navy_gold`         | M-Logo Low           | Navy / Gold            | `mike-28.jpg`                                             |
| `mike_white_m_red_grey`          | M-Logo Low           | Red / Grey             | `mike-32.png`                                             |
| `mike_white_m_blackout`          | M-Logo Low           | Blackout               | `mike-35.jpg`                                             |
| `mike_white_ice_bolt`            | Bolt Runner          | Black / Ice            | `mike-26.jpg`                                             |
| `mike_white_shadow_runner`       | Shadow Runner        | Black / Silver         | `mike-27.jpg`                                             |
| `mike_white_gold_trim`           | Gold Trim Low        | Black / Gold           | `mike-33.jpg`                                             |
| `mike_white_creamsicle`          | Creamsicle           | White / Orange         | `mike-34.jpg`                                             |
| `mike_white_slate_ember`         | Slate Ember          | Grey / Black / Rust    | `mike-37.jpg`                                             |
| `mike_white_redline`             | Redline              | Black / Red            | `mike-38.jpg`                                             |
| `mike_white_desert_stripe`       | Desert Stripe        | Brown / Sand           | `mike-39.jpg`                                             |
| `mike_white_teeth_ghost`         | Teeth                | Ghost White            | `mike-40.jpg`                                             |
| `mike_white_teeth_fire`          | Teeth                | Fire Red               | `mike-41.jpg`                                             |
| `mike_white_teeth_wave`          | Teeth                | White / Royal / Gold   | `mike-42.jpg`                                             |
| `mike_white_pbjs`                | PB&J's               | Purple / Peach         | `mike-raw-19.jpg`                                         |
| `mike_white_true_blues`          | True Blues           | Royal Blue             | `mike-raw-24.jpg`                                         |
| `mike_white_dip_sets`            | Dip Sets             | Black / White          | `mike-raw-17.jpg`                                         |
| `mike_white_og_gum`              | OG Signature         | Black / Gum            | `mike-ai-1.png`                                           |
| `mike_white_laced_black`         | Laced Low            | Black / Orange         | `mike-raw-1.jpg`                                          |
| `mike_white_camo_moss`           | Moss Camo            | Olive / Tan            | `mike-raw-2.jpg`                                          |
| `mike_white_panda_wave`          | Wave Runner          | Black / White          | `mike-raw-3.jpg`                                          |
| `mike_white_charcoal_wave`       | Wave Runner          | Charcoal / Red         | `mike-raw-4.jpg`                                          |
| `mike_white_cloud_strap`         | Cloud Strap          | Grey / Red             | `mike-raw-7.jpg`                                          |
| `mike_white_oxblood`             | Oxblood Slip         | Oxblood                | `mike-raw-8.jpg`                                          |
| `mike_white_slip_gum`            | Slip Low             | Black / Gum            | `mike-raw-9.jpg`                                          |
| `mike_white_slip_white`          | Slip Low             | White / Red            | `mike-raw-10.jpg`                                         |
| `mike_white_slip_camo`           | Slip Low             | Black / Camo           | `mike-raw-11.jpg`                                         |
| `mike_white_slip_teal`           | Slip Low             | Black / Teal           | `mike-raw-12.jpg`                                         |
| `mike_white_slip_bred`           | Slip Low             | Black / Red            | `mike-raw-21.jpg`                                         |
| `mike_white_mw_patch_bred`       | MW Patch             | Black / Red            | `mike-raw-13.jpg`                                         |
| `mike_white_mw_patch_navy`       | MW Patch             | Navy / Orange          | `mike-raw-14.jpg`                                         |
| `mike_white_mw_patch_brown`      | MW Patch             | Brown / Gold           | `mike-raw-22.jpg`                                         |
| `mike_white_royal_stripe`        | Royal Stripe         | Navy / White           | `mike-raw-18.jpg`                                         |
| `mike_white_night_strap`         | Night Strap          | Black / White / Purple | `mike-raw-20.jpg`                                         |
| `mike_white_heel_loop_white_red` | Heel Loop Low        | White / Red / Grey     | `design/closet/mike-white/heel-loop-white-red/` (5 views) |
| `mike_white_claw_runner`         | Claw Runner          | Black / Orange         | `design/closet/mike-white/claw-runner/` (5 views)         |
| `mike_white_claw_runner_royal`   | Claw Runner          | White / Royal / Yellow | `design/closet/mike-white/claw-runner-royal/` (top only)  |

### Multi-view 360 skins

Sheets with several views of one shoe live on main under
`design/closet/mike-white/<slug>/` and are listed in `MULTI` in
`scripts/closet/build_shoe_skins.py`, which splits each sheet, cuts every view
out (alpha or white background) and packs a 2048x1024 atlas.

- **Heel Loop Low (White / Red / Grey):** full 5-view 360 (outer, inner, top,
  front, back). Closest older design is Slip Low White / Red, but this one is
  laced with twin heel loops, so it is its own item.
- **Claw Runner (Black / Orange):** full 5-view 360 from a rendered, labeled
  sheet on grey (`claw-runner/sheet-b-5-views-labeled.png`). It replaced Mike's
  first 3-view drawing, which had no inner side or top.

## Folded or left out (13 of 47 source files)

| Source file                          | Why                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mike-25.png`                        | Same tan/white/navy shoe as `mike-white-shoe.png`                                                                                                                      |
| `mike-29.jpg`                        | Same red/grey M-Logo as `mike-32.png` (has a screenshot artifact)                                                                                                      |
| `mike-30.png`                        | Multi-view sheet of the navy/gold M-Logo (`mike-28.jpg`)                                                                                                               |
| `mike-31.png`                        | Pixel-identical to `mike-28.jpg`                                                                                                                                       |
| `mike-36.png`                        | Photo render of the blackout M-Logo (`mike-35.jpg`)                                                                                                                    |
| `mike-ai-2.png`                      | Multi-view sheet of `mike-ai-1.png`                                                                                                                                    |
| `mike-ai-3.jpg`, `mike-ai-4.jpg`     | Renders of the MW Patch black/red (`mike-raw-13.jpg`)                                                                                                                  |
| `mike-raw-5.jpg`                     | Byte-identical to `mike-raw-2.jpg`                                                                                                                                     |
| `mike-raw-16.jpg`, `mike-raw-23.jpg` | Byte-identical to `mike-raw-1.jpg`                                                                                                                                     |
| `mike-raw-15.jpg`                    | Mike's sketch of the OG Signature (shipped as `mike-ai-1.png`); his signature is cropped from this file                                                                |
| `mike-raw-6.jpg`                     | **Left out:** the photo includes a cigarette pack. The B-One beanie, tee and deck in it can be added later from a clean re-shoot or crop that has no tobacco in frame. |

## Polished cards and 360 view

`scripts/closet/build_shoe_skins.py` (python3 + numpy + Pillow) cuts each design
out of its background and writes:

- `public/assets/closet/mike-white/card/<slug>.webp`: the 2D card for every design,
  on the same dark studio backdrop, centered, with a soft contact shadow. Photos,
  split backgrounds and multi-shoe sheets (`KEEP_FRAME`) keep their framing.
- `public/assets/closet/mike-white/skin/<slug>.webp` + `src/lib/closet/shoe360Skins.json`:
  a 1024x512 side texture and the silhouette profile for each 360 skin.

The viewer (`src/closet360/Shoe360Canvas.tsx`, lazy-loaded by `components/Shoe360`)
lofts a low-poly shoe (~1k verts, no model file) from the profile and projects
Mike's art onto it, so the art always lines up and every pair shares one look.
Launch skins: m-navy-gold, m-red-grey, m-blackout, teeth-fire, true-blues,
panda-wave, redline, creamsicle. To add one, put its slug in `SKINS` and rerun.
Gated by `VITE_FEATURE_SHOE_360` (off; testers get it via config/featureTesters).
Credit stays on every surface: the detail sheet and showcase hero render
DesignerCredit ("Designed by Mike White" + signature).

- **Claw Runner (White / Royal / Yellow):** top view only. Same chunky lug sole,
  oval side cutouts and heel tab as Mike's first black/orange Claw Runner drawing, so it is a new
  colorway of that model (Teeth White / Royal / Gold shares the colors but is a
  slim shoe with a teeth graphic). **Needs outer side, inner side, front and
  back.** No 360 skin until a side view arrives; it shows its 2D card.
- **Dip Sets (Black / White):** full 5-view 360 from a labeled sheet on grey
  (`design/closet/mike-white/dip-sets/`). Same white toe, black heel, piano-key
  stripes and logo as the original Dip Sets art, so it skins the existing item;
  its card keeps Mike's original framing. The views are cropped by fixed boxes
  that leave the text labels out.
- **MW Patch (Brown / Gold):** full 5-view 360 from a labeled sheet on grey
  (`design/closet/mike-white/mw-patch-brown/`). Brown suede, MW oval logo and
  yellow heel lights match the original MW Patch Brown art, so it skins the
  existing item and keeps Mike's original card.

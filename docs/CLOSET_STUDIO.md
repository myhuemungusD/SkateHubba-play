# Closet Studio

Paint-style clothes editor for the avatar. Behind `VITE_FEATURE_CLOSET_STUDIO`
(default **off**; the `config/featureTesters` override turns it on for listed
testers — Jason and Mike). Route: `/closet/studio` (signed-in, lazy-loaded).
Entry points: Settings → Closet Studio, and the Closet heading on your own
profile.

Benchmarked against Procreate Pocket, ibisPaint, the NBA 2K shoe creator and
Nike By You: start from a real design, tap panels to recolor, then go as deep
as you want with brushes and layers.

## Tools

| Tool            | Notes                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fill            | Tap a panel. The region is found on the template line art + visible paint (scanline flood fill, tolerance 32) and painted into the active layer, so the template is never altered. |
| Brush           | Size 1–120, opacity, hardness (radial-gradient dab, spacing 15% of size).                                                                                                          |
| Eraser          | Same dab with `destination-out` on the active layer.                                                                                                                               |
| Eyedropper      | Samples the flattened design.                                                                                                                                                      |
| Color           | Hue/saturation wheel + brightness, exact color input, 18 swatches (Mike's colorways + brand colors), 12 recent colors.                                                             |
| Layers          | Up to 8; add, delete, reorder, hide, opacity.                                                                                                                                      |
| Undo/redo       | 40 steps; pixel edits store the layer's previous ImageData, structure edits store the layer list.                                                                                  |
| Zoom/pan        | Two-finger pinch (1–8×). A second finger cancels the stroke, like Procreate.                                                                                                       |
| Symmetry        | Left/right mirror for brush, eraser, fill, stickers and text.                                                                                                                      |
| Stickers / text | Emoji stickers and text (Bebas Neue, DM Sans, mono) stamped onto the active layer.                                                                                                 |
| Import          | Any image, scaled to fit, lands on a new layer.                                                                                                                                    |
| Live preview    | The flattened design renders on `Avatar2D` in the chosen slot after every edit.                                                                                                    |

Canvas is 512×512. Code: `src/lib/closetStudio/` (engine + pure helpers),
`src/screens/ClosetStudio/` (UI).

## Templates and credit

Every Mike White Signature design (`src/lib/closet/mikeWhiteCollection.ts`,
art in `public/assets/closet/mike-white/`) is a starter template. The picker
shows "Designed by Mike White" with his signature on each template and a
credit line above the grid. Anything saved from one of his templates carries
**"Based on a Mike White design"** — shown in the editor, on saved designs,
and enforced by Firestore rules (`credit` must equal that string whenever
`templateId` starts with `mike_white`). Mike is also listed in Settings →
Credits (`src/lib/appCredits.ts`).

## Saving (server-validated)

- `closetDesigns/{uid}/d0..d23.webp` (Storage): owner-only read/create/delete,
  `image/webp`, 100 B–1 MB, `uploaderUid` metadata must match, no update
  (re-save = delete then create).
- `users/{uid}/closetDesigns/d0..d23` (Firestore, `closetDesignValid`):
  owner-only writes, 24-slot cap via the id pattern, fixed key set, name 1–40,
  slot in shoes/top/bottom/head/deck, layerCount 1–8, `imageUrl` pinned to the
  owner's own object in this project's bucket, `updatedAt == request.time`.
  Owner can list; anyone can `get` a shared design.
- Account deletion removes the docs (same batch as the profile) and every
  slot's picture (best-effort).

## Moderation

A design is private unless "Share publicly" is checked. Sharing first runs
the same on-device image filter as avatars and banners
(`services/avatarModeration.ts`, nsfwjs); anything at or above the 0.5 warn
score is refused. Rules refuse `shared: true` unless `moderation == "passed"`.
As with avatars, the filter runs on the device, so the rules field is an
honest-client flag, not proof; reports and admin moderation still apply.

## Tests

- `src/lib/closetStudio/__tests__/` — color, fill, history, geometry,
  templates/credits, engine (fake 2D canvas with real pixel buffers).
- `src/services/__tests__/closetStudio.test.ts` — 100% coverage.
- `src/screens/ClosetStudio/__tests__/` — every tool, layers, import, save,
  share, errors.
- `rules-tests/closet-studio.rules.test.ts` — Firestore + Storage rules.

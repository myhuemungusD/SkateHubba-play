# Clip editor

Skate-specific editor for user clips. **Off by default** — set
`VITE_FEATURE_CLIP_EDITOR=true` to show the "Edit clip" button on the
"Post a clip" review step. No Firestore, Storage-rule or Cloud Function
changes: the editor outputs a normal `.mp4`/`.webm` that goes through the
existing upload path and `storage.rules` unchanged.

## What it does

| Tool                  | How it works                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trim + landing marker | Scrub to the landing and tap **Mark landing**. **Trim to trick** keeps 2.5 s of roll-in and 1.5 s of ride-away. Ramps, music sync and auto-trim all key off the landing.                                                                          |
| Speed ramps / slow-mo | Presets built around the landing: _Slow the trick_, _Slow the pop_, _Hammer_ (fast roll-in, super slow trick), _Fast roll-in_. Ramps ease in 4 steps like CapCut curves. Slow-mo amount 12.5–75 %. 120/240 fps source footage gives true slow-mo. |
| Looks                 | VX1000 (death-lens barrel + 4:3 + grain — same atan curve as the camera's `FisheyeRenderer`), Fisheye, VHS (chroma bleed, scanlines, soft focus, PLAY/date burn-in), Hi8. Strength slider.                                                        |
| Color presets         | Natural, Street, Golden hour, B&W, Faded, Cold, Punch — 4×5 color matrices shared by WebGL and Core Image.                                                                                                                                        |
| Multi-angle line cuts | Add up to 4 angles (follow cam + long lens), cut between them at the playhead. With music on, cuts snap to the nearest beat.                                                                                                                      |
| Trick name captions   | Stamp, label-tape or clean styles, 1.5 s at the playhead.                                                                                                                                                                                         |
| Beat-synced music     | 4 original CC0 loops (75–170 BPM). Picking a track shifts it so a downbeat lands exactly on the landing; beat ticks show on the timeline. Original-sound ducking slider.                                                                          |
| Skate SFX             | 13 sounds (ollie pop, flick, landing, 50-50 / crooked / smith grinds, wood / concrete / metal slides, wheel roll, powerslide, bail, crowd hype). Drag onto the SFX lane, or tap to drop at the playhead; arrows nudge, Delete removes.            |
| Stabilization         | iPhone app only (Vision-based, see below).                                                                                                                                                                                                        |
| Export                | Web: 720p/1080p at 30/60 fps, real time. iPhone app: up to 4K/60 HEVC via AVFoundation. If a 4K file is too big for the 50 MB feed cap, the full-quality file saves to Photos and a feed-sized copy is posted.                                    |

## Architecture

- `src/lib/clipEditor/` — pure project model (trim, speed map, beats, looks,
  libraries, export plan) + `engine.ts` (WebGL preview/export) +
  `shader.ts`. Source↔output time mapping lives in `speed.ts` and is the one
  thing both renderers must agree on.
- `src/components/ClipEditor/` — UI. Lazy-loaded from `UserClipUpload`, so
  none of it touches the entry chunk.
- `src/services/clipEditorNative.ts` — bridge to the native `ClipEditor`
  Capacitor plugin. When the plugin isn't in the build (web, or an older
  TestFlight build) everything falls back to the web exporter.
- Preview never lags the decoder: frames are drawn from
  `requestVideoFrameCallback`, one GPU pass per frame, captions are only
  re-rasterised when their text changes.

## Formats (coordinated with camera PR #673)

The camera records MP4 (native, H.264/HEVC) or WebM (web) at
`VIDEO_BITS_PER_SECOND`; the editor accepts either, at any resolution or
frame rate, and the native renderer reads the real frame rate and
orientation from the track. 0.5× ultra-wide footage works with every look —
VX1000 on ultra-wide footage is the classic combo. Output stays inside the
`MAX_UPLOAD_BYTES` cap via `planExport().uploadBitrate`.

## Audio licensing

Every sound and loop is an original synthesized work released under CC0 —
see `public/editor/CREDITS.md` and `scripts/generate-skate-sfx.mjs`
(deterministic; re-run with ffmpeg on PATH). No third-party audio ships.

## Benchmark

|                         | SkateHubba                      | CapCut         | VN          | InShot  | LumaFusion |
| ----------------------- | ------------------------------- | -------------- | ----------- | ------- | ---------- |
| Speed ramp presets      | Built around the landing marker | Generic curves | Curves      | Basic   | Keyframes  |
| VX/fisheye + tape looks | VX1000, Fisheye, VHS, Hi8       | Filters        | Filters     | Filters | Plugins    |
| Skate SFX library       | 13 skate-specific               | Generic        | —           | Generic | —          |
| Beat sync               | Downbeat locked to landing      | Auto beat      | Beat marks  | —       | Manual     |
| Multi-angle             | 4 angles, beat-snapped cuts     | Overlay only   | Multi-track | —       | Multicam   |
| 4K/60 export            | iPhone app                      | ✓              | ✓           | ✓       | ✓          |

Where we're behind: no keyframed zoom/punch-in, no per-clip transitions, no
curve editor for custom ramps, no frame-accurate waveform. Those are the
next additions if testers ask for them.

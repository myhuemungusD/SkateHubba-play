# Clip editor audio credits

## Recorded sound effects — SoundBiterSFX (CC BY 4.0)

Seven sound effects are real skateboard recordings edited from
**"Skateboarding Tricks" by SoundBiterSFX** (recorded/produced by VoiceBosch),
https://freesound.org/s/746602/, licensed under **Creative Commons Attribution
4.0** (https://creativecommons.org/licenses/by/4.0/). Changes: cut into single
hits, high-pass filtered, lightly denoised, loudness-normalized to about
−14 LUFS, faded, transcoded to AAC (.m4a) and Ogg Vorbis (.ogg). The editor's
Skate Sounds panel shows this credit in the app. Made by
`scripts/process-recorded-sfx.sh`.

| File | Sound | Cut from source (s) |
| ---- | ----- | ------------------- |

## Synthesized sounds (CC0)

Every other sound effect and music loop in `public/editor/` is an **original work
synthesized from scratch** by `scripts/generate-skate-sfx.mjs` (oscillators,
filtered noise and envelopes — no recordings, no samples, no third-party
audio). The SkateHubba project dedicates them to the public domain under
**CC0 1.0 Universal** (https://creativecommons.org/publicdomain/zero/1.0/).

That means skaters can post edits that use them anywhere (Instagram, TikTok,
YouTube) without Content ID claims, and the App Store build carries no audio
licensing obligations.

## Sound effects (`sfx/`)

| File              | Sound                | Source             | License |
| ----------------- | -------------------- | ------------------ | ------- |
| grind-crooked.m4a | Crooked grind        | Original synthesis | CC0 1.0 |
| grind-smith.m4a   | Smith grind          | Original synthesis | CC0 1.0 |
| slide-wood.m4a    | Board slide on wood  | Original synthesis | CC0 1.0 |
| slide-metal.m4a   | Slide on metal rail  | Original synthesis | CC0 1.0 |
| bail.m4a          | Bail (board clatter) | Original synthesis | CC0 1.0 |
| crowd-hype.m4a    | Crowd hype           | Original synthesis | CC0 1.0 |

## Music (`music/`)

| File            | Title         | BPM | Source             | License |
| --------------- | ------------- | --- | ------------------ | ------- |
| boom-bap-90.m4a | Curb Cut      | 90  | Original synthesis | CC0 1.0 |
| punk-170.m4a    | Kickflip Riot | 170 | Original synthesis | CC0 1.0 |
| lofi-75.m4a     | Late Session  | 75  | Original synthesis | CC0 1.0 |
| breaks-128.m4a  | Rail Ride     | 128 | Original synthesis | CC0 1.0 |

## Adding third-party audio

Only add a file here if it is CC0 or we hold a written commercial license that
covers in-app use **and** re-posting to social platforms, or it is CC BY and
we credit the author both here and in the app (Skate Sounds panel, via the
`credit` field in `src/lib/clipEditor/sfxLibrary.ts`). Add a row with the
author, source URL, license and (for paid licenses) where the license
document is stored. CC-NC, Sampling+ and "royalty free for personal use"
sounds are **not** acceptable.

# Skate Runner

An endless three-lane street. You are a skateboard. Rails and waxed ledges are the only obstacles, and the run is about picking a lane and locking a grind. It is a separate game from S.K.A.T.E. A run does not give letters, it does not write to Firestore, and it does not call a Cloud Function. The score exists only until you leave the page.

## Turn it on

The switch is `VITE_FEATURE_RUNNER_ENABLED`. It works like Roll Dice: only the literal string `true` enables it. Unset, empty, `TRUE`, and `false` all leave the game hidden.

| Switch                        | Where                             | Default | What it does                                                                                                                         |
| ----------------------------- | --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_FEATURE_RUNNER_ENABLED` | Vercel env, inlined at build time | unset   | Shows `/play/runner` and the lobby card. Anything except the literal `true` redirects that URL the way other frozen routes redirect. |

`VITE_*` values are baked in at build time. Changing the variable does nothing until that deployment is rebuilt.

### Try it on a Vercel preview

Preview for this branch already has the flag set to the literal `true`. Open:

`https://play-git-cursor-skate-runner-phase-1-5d57-skatehubba.vercel.app/play/runner`

The preview host still asks you to sign in to Vercel. After that, the game itself does not need a SkateHubba account. Leave Production unset so skatehubba.com stays on the main game.

Signed-in players also get a **Skate Runner** card on the lobby. The old `/play/*` redirect to `/lobby` still applies to every other `/play/...` path. `/play/runner` is the exception, including at the Vercel edge.

## Controls

Touch counts on the way, not when you lift, except a tap. A finger that never moves past the swipe threshold is a tap. Swipes fire as soon as they cross a short distance. There is no tilt.

The outer 32px on each side of the screen is left for iOS swipe-back and Android gesture navigation. Those strips use `touch-action: pan-y` and sit outside the canvas (`touch-action: none` is only on the canvas). The screen uses `overscroll-behavior: none`.

|                       | Phone                                | Keyboard                 |
| --------------------- | ------------------------------------ | ------------------------ |
| Change lane           | Swipe left or right                  | Arrow keys, A, D         |
| Crooked grind         | Tap once as you reach the lip        | Arrow up, W, F           |
| Nose slide            | Tap twice, quickly                   | The same key twice       |
| Kickflip into crooked | Swipe up (extra input on the way in) | Space, K                 |
| Powerslide            | Swipe down                           | Arrow down, S            |
| Balance on a grind    | Hold or swipe left and right         | Hold arrow keys, A, D    |
| Pop off a grind       | Tap, or swipe up                     | Arrow up, W, F, or Space |
| Pause                 | Pause button                         | Escape, P                |
| Restart after a bail  | Play again                           | R                        |

A powerslide cancels a trick you had armed and slides the board. It does not lock a grind. Use it to let a feature go by, or just to slide.

Lane choice commits on the swipe. The board slides over visually after that. You cannot change lanes while you are on a rail or a ledge.

## Tricks

Arm the trick as the lip gets close. The lock grade is how far ahead of the lip you committed. A second grade is the landing, from the board's angle and whether you popped off late:

| Grade   | When                                                                       | Crooked | Nose slide | Kickflip crooked |
| ------- | -------------------------------------------------------------------------- | ------- | ---------- | ---------------- |
| Perfect | A short beat before the lip                                                | 400     | 650        | 1000             |
| Clean   | A little early, or a settled landing                                       | 250     | 400        | 600              |
| Sketchy | Very early, or after the lip but still on the feature, or a wonky set-down | 80      | 120        | 180              |

The names on screen are `CROOKED GRIND`, `NOSE SLIDE`, and `KICKFLIP CROOKED`, with the grade and a `+points` popup. Coming back down adds 150 / 80 / 20 for a perfect, clean, or sketchy landing.

A clean or perfect make starts a combo. The next one is worth x1.5, then x2, up to x5. A sketchy make scores the small number and does not add to the chain. Rolling past a feature in your lane with no grind clears the combo. Three of those misses end the run. A trick input after the late window and a short coyote beat, while the feature is still under the board, bails immediately. Features in the other lanes do not count against you — that is the lane choice.

The score is meters plus those trick points. It is not a S.K.A.T.E. score and it is not written to Firestore. This device remembers your best line in local storage and draws it as a gold ghost on the next run. **Play again** (or R) starts a fresh run immediately, from the same pattern seed.

On a grind, the balance meter walks. Swipe or hold left and right, or the arrow keys, to stay centered. Too far and you bail. Tap or swipe up to pop off. A pop in the later half of the feature, with the board flat, is the perfect landing. Sliding off the end can still be clean.

## Why the board feels like this

The sim runs at a fixed 120 steps a second. The picture blends between those steps, so a 60fps phone and a 120fps phone play the same trick. A tap that lands during the tiny lock freeze is kept for about 140ms and used as soon as the board can take it. A tap a beat late still locks (coyote time). That is the "my finger was there" fairness from the mobile skaters.

A tap is a pop, not a height slider. The tail pivots, the nose comes up, and gravity brings it down on a curve. Near the top, gravity eases off for a moment so the board hangs instead of peaking like a triangle. A kickflip is that same pop plus a roll around the length of the board, one turn, timed to finish as the wheels come back. A crooked grind yaws the board and sets the nose on the rail. A nose slide turns the board 90 degrees and plants the nose on the ledge. The lock eases you onto the feature, then snaps. Speed drops while you grind. The landing squashes the deck and gives a small bounce. A perfect lock holds the world for a fraction of a second. Sparks, a small camera shake on a perfect lock, speed lines, a pop / scrape / land one-shot, and a phone vibration mark the same moments.

Every one of those numbers is in `src/runner/tune.ts`.

The street starts at 6 units per second and adds 0.03 per second up to 9. Balance drift starts gentle and grows as the run goes on, so the first rails are a warm-up and the later ones ask you to steer. Runs stay short: three missed features in your lane and it is over.

**Pause**, Escape, or P pauses. Hiding the tab or app also pauses, and it stays paused until you resume. `prefers-reduced-motion` starts the run paused, and turns off the camera bob, speed lines, grind sparks, landing dust, and the perfect-grind camera shake. The street still moves once you press Play, and the board still poses for each trick so the make stays readable.

On a Capacitor build, a powerslide, a grind lock, and the landing each fire a light haptic. A bail is silent. The browser build stays silent. The in-app Haptics switch in Settings still applies.

Round 2 added 0.06 per second up to 13. The first preview started at 14 and climbed by 0.4 up to 26. The camera sits higher, wider, and further behind the board so the next rails and ledges are in frame. The grind windows are a little wider to match the slower approach. A perfect lock adds a small shake on top of that camera. Reduced motion turns the shake, sparks, dust, and speed lines off. The board still pops, flips, and lands.

## Phone performance

The canvas caps `devicePixelRatio` at 1.5 and turns MSAA off. A phone, or a machine with 4 GB of memory or fewer or 4 cores or fewer, skips the shadow map and keeps the blob under the board. A desktop adds one 512 soft shadow from the warm key light. Lamp glow is baked as an additive card, not a fullscreen bloom pass. Lights are a warm hemisphere plus two directionals, with a 1k dusk HDRI on the environment for reflections once it loads. Road, sidewalk, rails, ledges, and the brick walls use compressed CC0 PBR maps (512 WebP, mipmaps). The asphalt roughness is pulled down so the street reads wet. Griptape and the deck wood grain are still generated. Street slabs, rails, ledges, lamps, the shop, and the dumpsters are created once and recycled. Sparks, landing dust, and speed lines are a fixed pool. The sim pauses when the document is hidden, and the canvas stops drawing while paused or after a bail. An FPS number sits in the corner for device playtests. The texture list, licenses, the SkateHubba logo, and the Skateboard_01 credit are in [RUNNER_ASSETS.md](RUNNER_ASSETS.md).

three.js and React Three Fiber load only when `/play/runner` is opened (`React.lazy` in `App.tsx`). `npm run build` fails if any of that code shows up in the initial JavaScript. The procedural board does not import drei, so the runner chunk does not pull the drei barrel. `@react-three/drei` stays in the project for a later model; import it from a core subpath (`core/Gltf`) if a file is added, not from the package root.

## Drop-in board

There is no skater in this build. The player is the deck, griptape, trucks, and wheels drawn in `src/runner/view/Board.tsx`. Poses live in `src/runner/boardPose.ts` and are applied to the root group (nose toward **-Z**, down the street). `spin` is a 0..1 kickflip turn.

Skateboard_01 by CrazyScans (Sketchfab, CC BY 4.0) is the board on screen. `loadRunnerModel` scales `skateboard-01.glb` into this group and hides `ProceduralBoard` after it loads. A failed load leaves the procedural board. The grind rail is Low Rail | Game Ready | 4K by bralunit (Sketchfab, CC BY 4.0), instanced from `low-rail.glb` at the same length the sim already uses. The box rail shows only if that file fails. Box obstacles use named pieces from Skatepark Obstacles by rhcreations (Sketchfab, CC BY 4.0). Banks, quarterpipes, and kickers from that file sit on the sidewalk and are not obstacles. The pause card shows all three license lines. The Mike White model is still a null slot. The deck graphic slot still paints the SkateHubba logo on the underside plane named `Graphic`, including after the glb replaces the procedural deck. Node names already on the procedural board:

`Deck`, `DeckPly`, `Griptape`, `Graphic`, `LogoDecal`, `TruckNose`, `TruckTail`, `WheelNoseLeft`, `WheelNoseRight`, `WheelTailLeft`, `WheelTailRight`.

`Graphic` sits on the underside of the rig, outside `ProceduralBoard`, so it stays when the glb is showing. `LogoDecal` is the small mark on the procedural deck and hides with that group.

The runner code moves the group. Do not bake root motion into a file. Tricks are these poses, not animation clips: ride, powerslide (yaw), crooked (yaw and roll onto one truck), nose slide (nose down), kickflip (a full roll on the way in, then the crooked pose), bail.

Placeholder geometry is original. It is not a third-party pack. The PBR surfaces under it are CC0 and listed in [RUNNER_ASSETS.md](RUNNER_ASSETS.md).

## What this does not do

No accounts, no leaderboard, no replay log, no letter on a S.K.A.T.E. game, no Firestore rules, no Cloud Functions.

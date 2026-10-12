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

|                       | Phone                                | Keyboard           |
| --------------------- | ------------------------------------ | ------------------ |
| Change lane           | Swipe left or right                  | Arrow keys, A, D   |
| Crooked grind         | Tap once as you reach the lip        | Arrow up, W, F     |
| Nose slide            | Tap twice, quickly                   | The same key twice |
| Kickflip into crooked | Swipe up (extra input on the way in) | Space, K           |
| Powerslide            | Swipe down                           | Arrow down, S      |
| Pause                 | Pause button                         | Escape, P          |

A powerslide cancels a trick you had armed and slides the board. It does not lock a grind. Use it to let a feature go by, or just to slide.

Lane choice commits on the swipe. The board slides over visually after that. You cannot change lanes while you are on a rail or a ledge.

## Tricks

Arm the trick as the lip gets close. The grade is how far ahead of the lip you committed:

| Grade   | When                                                  | Crooked | Nose slide | Kickflip crooked |
| ------- | ----------------------------------------------------- | ------- | ---------- | ---------------- |
| Perfect | A short beat before the lip                           | 400     | 650        | 1000             |
| Good    | A little early or a little tighter                    | 250     | 400        | 600              |
| Sloppy  | Very early, or after the lip but still on the feature | 80      | 120        | 180              |

The names on screen are `CROOKED GRIND`, `NOSE SLIDE`, and `KICKFLIP CROOKED`, with the grade and a `+points` popup.

A good or perfect make starts a combo. The next one is worth x1.5, then x2, up to x5. A sloppy make scores the small number and does not add to the chain. Rolling past a feature in your lane with no grind clears the combo. Three of those misses end the run. A trick input after the late window, while the feature is still under the board, bails immediately. Features in the other lanes do not count against you — that is the lane choice.

The score is meters plus those trick points. Nothing is saved. **Play again** starts a fresh run from the same pattern seed.

**Pause**, Escape, or P pauses. Hiding the tab or app also pauses, and it stays paused until you resume. `prefers-reduced-motion` starts the run paused, and turns off the camera bob, speed lines, and grind sparks. The street still moves once you press Play, and the board still poses for each trick so the make stays readable.

On a Capacitor build, a powerslide, a grind lock, and the landing each fire a light haptic. A bail is silent. The browser build stays silent. The in-app Haptics switch in Settings still applies.

The street starts at 6 units per second (about 30% slower than round 2, which started at 8.5) and adds 0.03 per second up to 9. Round 2 added 0.06 per second up to 13. The first preview started at 14 and climbed by 0.4 up to 26. The camera sits higher, wider, and further behind the board so the next rails and ledges are in frame. The grind windows are a little wider to match the slower approach.

## Phone performance

The canvas caps `devicePixelRatio` at 1.5, turns MSAA off, and does not render shadow maps. The board has a blob shadow. Lights are a hemisphere plus two directionals, with a 1k daytime HDRI on the environment for reflections once it loads. Road, sidewalk, rails, ledges, and the brick walls use compressed CC0 PBR maps (512 WebP, mipmaps). Griptape and the deck wood grain are still generated. Street slabs, rails, and ledges are created once and recycled. Sparks and speed lines are a fixed pool. The sim pauses when the document is hidden, and the canvas stops drawing while paused or after a bail. An FPS number sits in the corner for device playtests. The texture list, licenses, and the empty slots for a deck graphic, a logo, and the Mike White model are in [RUNNER_ASSETS.md](RUNNER_ASSETS.md).

three.js and React Three Fiber load only when `/play/runner` is opened (`React.lazy` in `App.tsx`). `npm run build` fails if any of that code shows up in the initial JavaScript. The procedural board does not import drei, so the runner chunk does not pull the drei barrel. `@react-three/drei` stays in the project for a later model; import it from a core subpath (`core/Gltf`) if a file is added, not from the package root.

## Drop-in board

There is no skater in this build. The player is the deck, griptape, trucks, and wheels drawn in `src/runner/view/Board.tsx`. Poses live in `src/runner/boardPose.ts` and are applied to the root group (nose toward **-Z**, down the street). `spin` is a 0..1 kickflip turn.

A later deck model can parent under that group and hide the procedural meshes. The switch for that file, and for a deck graphic and a logo decal, is `src/runner/artSlots.ts`. Those three are null until the files exist. Node names already on the procedural board:

`Deck`, `DeckPly`, `Griptape`, `Graphic`, `LogoDecal`, `TruckNose`, `TruckTail`, `WheelNoseLeft`, `WheelNoseRight`, `WheelTailLeft`, `WheelTailRight`.

`LogoDecal` stays hidden until `CUSTOM_LOGO_DECAL` is a URL. `Graphic` is the orange placeholder until `CUSTOM_BOARD_GRAPHIC` is set.

The runner code moves the group. Do not bake root motion into a file. Tricks are these poses, not animation clips: ride, powerslide (yaw), crooked (yaw and roll onto one truck), nose slide (nose down), kickflip (a full roll on the way in, then the crooked pose), bail.

Placeholder geometry is original. It is not a third-party pack. The PBR surfaces under it are CC0 and listed in [RUNNER_ASSETS.md](RUNNER_ASSETS.md).

## What this does not do

No accounts, no leaderboard, no replay log, no letter on a S.K.A.T.E. game, no Firestore rules, no Cloud Functions.

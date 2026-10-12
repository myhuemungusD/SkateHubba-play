# Skate Runner

An endless three-lane street. It is a separate game from S.K.A.T.E. A run does not give letters, it does not write to Firestore, and it does not call a Cloud Function. The score exists only until you leave the page.

Phase 1 is a prototype: one street, swipe controls, cones you ollie, bars you duck, one rail that locks into a boardslide, then game over and restart. The skater on screen is placeholder boxes. The real model comes later.

## Turn it on

The switch is `VITE_FEATURE_RUNNER_ENABLED`. It works like Roll Dice: only the literal string `true` enables it. Unset, empty, `TRUE`, and `false` all leave the game hidden.

| Switch | Where | Default | What it does |
| --- | --- | --- | --- |
| `VITE_FEATURE_RUNNER_ENABLED` | Vercel env, inlined at build time | unset | Shows `/play/runner` and the lobby card. Anything except the literal `true` redirects that URL the way other frozen routes redirect. |

`VITE_*` values are baked in at build time. Changing the variable does nothing until that deployment is rebuilt.

### Try it on a Vercel preview

1. Vercel → the SkateHubba project → Settings → Environment Variables.
2. Add `VITE_FEATURE_RUNNER_ENABLED` = `true` for **Preview** only. Leave Production unset.
3. Redeploy the preview (or push a commit so a new preview builds with the variable).
4. Open `https://<preview-host>/play/runner`.

No account is required. Signed-in players also get a **Skate Runner** card on the lobby. Arrow keys work on a desktop. On a phone: swipe left/right to change lanes, swipe up to ollie, swipe down to powerslide. The swipe counts as soon as your finger has moved a short distance, not when you lift it.

The old `/play/*` redirect to `/lobby` still applies to every other `/play/...` path. `/play/runner` is the exception, including at the Vercel edge, so the preview URL is not bounced before the app loads.

## How a run works

- Three lanes. A swipe commits the lane immediately. The body slides over visually after that.
- **Ollie** (swipe up, ArrowUp, W, Space) hops a sine arc and clears cones. It does not clear a tall barrier or an overhead bar.
- **Powerslide** (swipe down, ArrowDown, S) ducks. That is how you get under a bar. It does not clear a cone.
- **Boardslide**: roll onto the rail in its lane while you are on the ground. The game locks you to the rail, ignores lane changes, shows `BOARDSLIDE`, and adds 250 points. The score otherwise is meters traveled.
- Hitting an obstacle ends the run. **Play again** starts a new one. Nothing is saved.
- **Pause**, Escape, or P pauses. Hiding the tab or app also pauses, and it stays paused until you resume.
- `prefers-reduced-motion` starts the run paused and turns off the camera bob. The street still moves once you press Play. The game is motion; the setting removes the extra shake and the auto-start.

Touch targets sit inside a 32px dead zone on both screen edges so an iOS back-swipe or Android system gesture is not stolen. Those strips use `touch-action: pan-y` and are not inside an element with `touch-action: none` (the canvas is). The screen uses `overscroll-behavior: none`. There is no tilt control.

On a Capacitor build, ollie, landing, and locking a boardslide each fire a light haptic. The browser build stays silent. The in-app Haptics switch in Settings still applies.

## Phone performance

The canvas caps `devicePixelRatio` at 1.5, turns MSAA off, and does not cast shadows. Street slabs and obstacle meshes are created once and reused. The sim pauses when the document is hidden, and the canvas stops drawing while paused or after a crash. An FPS number sits in the corner for device playtests.

three.js, React Three Fiber, and drei load only when `/play/runner` is opened (`React.lazy` in `App.tsx`). `npm run build` fails if any of that code shows up in the initial JavaScript. Drei is imported from its core subpaths so the runner chunk does not pull the full drei barrel.

## Drop-in skater

The founder is supplying a skater based on Mike White. Until that file exists, `src/runner/view/SkaterAvatar.tsx` draws boxes. To switch:

1. Export a glTF binary to `public/runner/skater.glb`.
2. In `src/runner/skaterRig.ts`, set `SKATER_GLTF_URL` to `"/runner/skater.glb"`.
3. Keep the names below. A missing clip is skipped; the mesh still shows.

Model space:

- Feet on the origin, +Y up, face toward **-Z** (down the street, away from the camera).
- About 1.6 units tall. If the file is in centimeters, set `SKATER_GLTF_SCALE`.
- In-place animation only. The runner code moves the whole model. Root motion will leave the lane.
- Root node `Skater`. A `Board` node under it (it does not have to be skinned).
- Bones, Mixamo names: `Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand`, `RightShoulder`, `RightArm`, `RightForeArm`, `RightHand`, `LeftUpLeg`, `LeftLeg`, `LeftFoot`, `LeftToeBase`, `RightUpLeg`, `RightLeg`, `RightFoot`, `RightToeBase`.

Clip names, exact:

| Pose | Clip |
| --- | --- |
| Cruise | `Push` |
| Standing still (available, not required for phase 1) | `Idle` |
| Ollie | `Ollie` |
| Powerslide | `Powerslide` |
| Boardslide | `Boardslide` |
| Crash | `Bail` |

`Idle` is reserved so the file can include it. Phase 1 plays `Push` while riding.

Placeholder geometry in this phase is original low-poly (boxes, a cone, a rail). It is not a third-party pack. Kenney or Quaternius CC0 props can replace those meshes later without touching the sim in `src/runner/logic.ts`.

## What this phase does not do

No accounts, no leaderboard, no replay log, no letter on a S.K.A.T.E. game, no Firestore rules, no Cloud Functions. Those are later, if the prototype feels right on a phone.

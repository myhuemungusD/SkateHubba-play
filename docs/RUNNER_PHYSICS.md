# Skate Runner physics

This is the note for Jason on the physics and game-feel brief. The sim is a custom kinematic controller. There is no rigid-body solver. Every starting number from the brief is a named constant in `src/runner/tune.ts`. Values the sim does not run live in `SUGGESTED` in that same file, and they are called out below.

Sources are the ones in the brief. A line with no source is a starting value we picked because the brief did too.

## 1. Custom kinematic controller

Adopted. The board is a state machine: rolling, air, grind, landing, bail. Rails and ledges are line segments with a height. A box is the same kind of segment with a different height. We did not add Rapier or cannon-es.

Why: a lane runner authors the motion. A rigid-body solver fights the lane snap, the ollie arc, and the grind lock. True Skate's feel comes from tuning a purpose-built sim, not from a general solver ([Gamezebo preview](https://www.gamezebo.com/upcoming/true-skate-preview/), [TouchArcade review](https://toucharcade.com/2012/10/17/true-skate-review)).

## 2. Fixed step and interpolation

Adopted, at 1/60 of a second.

The render loop accumulates time and steps while a full 1/60 is available. The picture blends between the previous step and the current one with alpha = leftover / 1/60. That is the Gaffer loop, the same shape react-three-rapier uses ([Physics.tsx](https://github.com/pmndrs/react-three-rapier/blob/c13b7aec/packages/react-three-rapier/src/components/Physics.tsx), [Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)). We do not use a variable step. The rapier docs say `timeStep="vary"` makes the sim unstable and turns interpolation off ([PhysicsProps](https://pmndrs.github.io/react-three-rapier/interfaces/PhysicsProps.html)).

The render loop clamps a hitch to 0.1 seconds (`MAX_FRAME_DT`). Rapier's own clamp is 0.5 seconds and a common pattern uses 0.25. Both of those sit in `SUGGESTED` and are not what we run. 0.1 seconds keeps a stall from skipping a lip. The game already pauses on `visibilitychange`.

Touch is sampled every pointer event. `PointerEvent.getCoalescedEvents()` feeds the gesture grader, so a 120Hz screen contributes the samples the 60Hz frame would have dropped. EA's Skate team found 60Hz polling too coarse for gestures and moved to 120Hz ([Blackwood on Skate's control scheme](https://www.gamedeveloper.com/game-platforms/ea-s-blackwood-text-based-prototype-perfected-i-skate-i-s-control-scheme)).

## 3. Graded trick input

Adopted in our existing gesture map.

Each swipe scores accuracy 1–5 (how straight it is) and speed 1–5 (pixels per millisecond). Speed scales pop height from 62% to 100%. Accuracy leaves leftover roll on a kickflip when the score is low, so a sloppy flick cannot land perfect. That is Flick-It's accuracy and speed scores feeding the trick, not a pass/fail ([Blackwood on Skate and Skate 2](https://www.gamedeveloper.com/design/new-tricks-scott-blackwood-talks-i-skate-i-and-i-skate-2-i-)).

Two modes, from the pause card. Classic is the runner's map: tap crooked, double-tap nose slide, swipe up kickflip, swipe down powerslide, swipe sideways to change lanes. Easy flicks turns a trick tap or a swipe up into a full-height kickflip. Lane changes stay lane changes, because this game has one finger for both steering and tricks. skate. ships Classic and Streamlined, plus a sensitivity slider that defaults to 50 ([EA accessibility notes](https://www.ea.com/able/resources/skate), [Get Control](https://www.ea.com/games/skate/skate/news/get-control)). The slider is on the pause card. 50 keeps the 28px swipe. 100 shortens it. 0 lengthens it.

We did not remap tricks to True Skate's tail-drag and side-flick. The shipped map is tap, double-tap, and swipe up. The angles still follow True Skate's idea that the grind you get depends on how the board meets the feature ([TouchArcade review](https://toucharcade.com/2012/10/17/true-skate-review), [gameplay video note](https://toucharcade.com/2012/10/04/first-proper-true-skate-gameplay-video-released/)).

Lane changes ease over 0.14 seconds. A second swipe while the board is still sliding waits (one pending lane change). Powerslide lasts 0.6 seconds and sheds 30% of speed once.

## 4. Ollie and kickflip

Adopted as a closed-form arc.

Apex height is 1.1 and the symmetric air time is 0.58 seconds, so gravity is 8h/T² and launch speed is 4h/T. The way down uses 1.6× that gravity, so the landing snaps and the real air time is a bit under 0.58 seconds. The nose stays up for 0.14 seconds before the spring levels it. An earlier pass used 0.65 seconds and a 0.11 second nose hold. The shorter air time is the skate pop. The longer nose hold is so the trick still reads. A kickflip is one roll around the board's length, over 0.38 seconds, starting 50ms after the pop, easing out at the end. The last 120ms of a descent levels pitch, yaw, and roll unless a grind is already targeted. A kickflip that locks may finish blending for 80ms after contact.

Rail and ledge heights stayed at 0.30 and 0.34. The brief's 0.6–0.9 band is in `SUGGESTED`. The low-rail mesh and the skatepark coping are fitted to the lower numbers, and raising them would float the grind off the model.

## 5. Grind lock

Adopted in part.

An armed trick eases onto the feature over 90ms (`MAGNET_SNAP`), then the lock pins the lane and the height. 60ms felt like a teleport. 90ms lets the trucks settle and is still fast at these speeds. Lane changes take 0.16 seconds for the same reason: a thumb swipe should have a little weight. Crooked yaw is 32 degrees, inside the 15–35 degree band, nose down. A nose slide is 90 degrees, inside 75–105, nose on the ledge. The gesture picks the trick. The board does not choose the grind from a free yaw measurement, because the player cannot shove the board onto an arbitrary angle in this mode.

We did not pull the player in from the next lane. `SUGGESTED.laneAssist` is 1. Live assist is none. A feature in another lane is a lane choice, not a magnet. The horizontal radius of 0.35 and the vertical band of 0.25 are in `SUGGESTED`. The live window is the approach range already tuned for a street that moves at 6 to 9.

## 6. Balance meter

Adopted, with the short-rail rule.

The needle accelerates as `a = k·θ + noise`. `k` starts at 1.5 per second squared and grows 15% for each earlier grind in the combo, and it grows with time on the rail. Noise is 0.3, signed by the run seed so it stays deterministic. The first 0.5 seconds do not drift. Past 3 seconds on one grind, a needle outside ±1 bails. A swipe or a held finger pushes back.

Our rails are about a second long at these speeds, so a normal crooked grind ends clean and the meter is practice. That matches the brief: auto-dismount at the end of the rail is a clean exit, and only a grind longer than 3 seconds requires active balance.

THPS uses a balance meter on grinds and manuals, resets it some when a new grind starts, and makes repeated tricks harder to hold ([Balance Meter](https://tonyhawkgames.fandom.com/wiki/Balance_Meter), [resetting the meter](https://www.reddit.com/r/THPS/comments/iqtrki/how_do_you_keep_resetting_your_balance_meter_in/), [Tony Hawk tips](https://www.tonyhawkguide.com/tips.html)). We reset the needle on each lock. We do not have manuals or reverts. The combo multiplier is the chain.

## 7. Landing grades

Adopted, and kept SkateHubba's three words.

Perfect is within 10 degrees, a finished flip (at least 95%), a late pop, and a centered needle. Clean is the brief's "OK": within 25 degrees. Past 50 degrees, or a dumped needle, is a bail. Between 25 and 50 degrees scores as sketchy and the run continues. The brief said bail past 25 degrees. A nose slide still has a lot of yaw when it leaves the ledge, and auto-level does not always finish inside 25 degrees, so sketchy is the survived-but-messy grade instead of an instant crash.

A land press within 120ms before the wheels touch, or inside the 100ms coyote after a slide-off, upgrades a clean landing to perfect when the flip is finished and adds 0.35 speed. The brief's timing window is ±80ms (`LAND_PRESS_WINDOW`). The buffer that actually accepts the press is the 120ms trick buffer, so a slightly early finger still gets it.

## 8. Coyote time and input buffer

Adopted.

Coyote time is 100ms. It extends the late lock window, and after a slide-off a tap within 100ms still counts as the pop. An ollie or land press is kept for 120ms. A grind gesture is kept for 150ms, including taps that land during hit-stop. Lane changes queue at most one. Celeste uses both coyote time and jump buffering. The source does not give milliseconds ([Celeste and forgiveness](https://maddymakesgames.com/articles/celeste_and_forgiveness/index.html), [Thorson](https://threadreaderapp.com/thread/1238338574220546049.html)).

The approach window in front of a lip is still wider than 150ms. At 6 units a second the lip has to be readable. 150ms is the minimum the buffer guarantees. The authored arm range is the rest.

## 9. Hit-stop

Adopted, measured in milliseconds.

A grind lock freezes the sim for 50ms. A perfect landing freezes it for 70ms. A bail freezes it for 120ms and then the run ends. Nothing freezes longer than 150ms. Inputs during the lock freeze are buffered. The rule of thumb is about 80ms, 4–6 frames feels right, and a preference study landed around 126–141ms ([LMU thesis](https://digitalcommons.lmu.edu/cgi/viewcontent.cgi?article=2383&context=etd), [hit-stop study](https://dl.acm.org/doi/pdf/10.1145/3772363.3798911), [hit-stop notes](https://design.solhun.com/en/game-ui/hit-stop/)).

## 10. Juice and camera

Juice stays. The camera formula does not.

Sparks, speed lines, and a small shake on a perfect lock are unchanged. The shake fades with the square of the time left, which is the trauma idea, but it is a short deterministic offset on the existing camera, not Perlin noise and not a 0.25 / 0.6 trauma hit. Screen shake should be rare ([Juice it or lose it](https://www.youtube.com/watch?v=Fy0aCDmgnxg), [juicy-breakout](https://github.com/grapefrukt/juicy-breakout), [Eiserloh, Juicing Your Cameras](http://www.mathforgameprogrammers.com/gdc2016/GDC2016_Eiserloh_Squirrel_JuicingYourCameras.pdf)).

The chase camera stays the one from the earlier framing pass: higher and further back so the next rail is readable. True Skate's developers wanted a camera that shows where you are going, which is the same goal ([Gamezebo](https://www.gamezebo.com/upcoming/true-skate-preview/)). The brief's offset (0, 2.2, 4.5), look-ahead, springs, FOV kicks, and trauma amounts are in `SUGGESTED` and are not applied.

## 11. Haptics

Adopted on top of the existing Capacitor wrapper.

Pop and powerslide are a light impact. Grind lock is medium. A grind pulses light every 120ms. A perfect landing is a success notification. A bail is a heavy impact plus an error notification. Anything else that lands is a light impact. Two calls inside 50ms collapse into one. The Settings haptics switch turns the runner off with the rest of the app. The API is `Haptics.impact` and `Haptics.notification` ([Capacitor Haptics](https://capacitorjs.com/docs/apis/haptics)). A browser uses `navigator.vibrate` for the same moments.

## 12. Audio

The mixing idea is partly adopted. The Freesound files were checked and not shipped.

Each of these pages links its license to CC0 1.0 (`http://creativecommons.org/publicdomain/zero/1.0/`):

- [Skateboard_Grinds.wav](https://freesound.org/people/BlackNeon1234/sounds/348326/) by BlackNeon1234. 2.7 MB, 24-bit stereo, about 10 seconds.
- [skateboard ollie](https://freesound.org/people/nolimitkid/sounds/515229/) by nolimitkid. The sound page is CC0. Pack [28982](https://freesound.org/people/nolimitkid/packs/28982/) labels its files Creative Commons 0. We did not download the rest of the pack, so this note only covers the ollie page plus the pack's CC0 badges.
- [Skateboarding Rail Slide](https://freesound.org/people/C-V/sounds/845524/) by C-V. 2.2 MB, 24-bit stereo, 8 seconds.

Those takes are too heavy for the lazy runner chunk. Pop, grind, and land stay the short CC0 one-shots generated for the game. Pop and land pitch wander by ±5%. The roll and the grind are loops synthesized in the audio context from filtered noise, also original and CC0, so they are not extra files. The roll plays while the wheels are down and its gain and playback rate rise from cruise speed to the cap. A lock ducks the roll and brings up the grind loop. A powerslide uses a quieter scrape. The one-shot still marks the moment the lock or the slide starts.

## 13. Mobile WebGL

The phone tier draws at pixel ratio 1, with the blob shadow, no shadow map, no bloom, and one key light. The desktop tier caps pixel ratio at 1.5, draws one 512 soft shadow, and runs a short bloom pass (strength 0.22, radius 0.36, threshold 0.86) on the lamps and the additive sparks. The lamp card stays on both tiers. The road, sidewalks, curbs, brick walls, and lane dashes are instanced. Sparks, dust, and speed lines are one instanced draw call each. Rails and ledges stay a recycled pool that shares the decoded mesh. The frame loop mutates refs and does not call setState per frame. We do not import the drei barrel. The same goals are in [three.js practice notes](https://www.utsubo.com/blog/threejs-best-practices-100-tips) and the [R3F pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls).

Tiling maps are KTX2. Color and normals are UASTC with zstd. Roughness and metalness are ETC1S. The GLB files stay Meshopt geometry plus their existing textures. The loader still accepts Draco and KTX2 when a model ships them.

## 14. Playtest on a phone viewport

Played at 390×844 with an iPhone user agent, so the low tier was the one on screen. Two passes on the feel numbers, then a pass that tried to buy frame rate by hiding meshes and by halving the resolution.

Pass 1, in `tune.ts`: ollie air time 0.65s to 0.58s, nose hold 0.11s to 0.14s, lock ease 60ms to 90ms, lane slide 0.14s to 0.16s. The pop comes back sooner, the nose still reads, and the lock and the lane change settle instead of snapping.

Pass 2, measured here. This machine's WebGL renderer is SwiftShader. The low tier held about 12fps at 1× CPU and about 9fps at a 4× CPU throttle. The throttle barely moved the number, so the frame is waiting on software rasterization. Hiding the skatepark meshes did not change it. Drawing at half resolution (195×422) reached about 24fps at the 4× throttle, still far from 60, and the street went soft. Both of those cuts stayed out. The phone tier keeps the models, pixel ratio 1, and no bloom. The sparks became an additive instanced spray so a grind reads without a fullscreen pass.

A real phone GPU is not SwiftShader. The tier split is what keeps that GPU off the shadow map and the bloom pass. The FPS number in the corner is there so a device check can confirm it.

## 15. What we aimed at

- True Skate: angle decides the grind. Crooked is yawed with the nose down. Nose slide is 90 degrees.
- skate. (Flick-It): gestures scored on accuracy and speed, 120Hz samples, a simpler second mode.
- THPS 1+2: a balance needle that gets harder as the combo stacks, and a clean exit at the end of a short grind.
- Celeste: coyote time and a buffer so a close tap still counts.
- Subway Surfers / Alto: one-gesture inputs and a camera that shows the next obstacle. The camera numbers stayed with the earlier framing pass.
- Session / Skater XL: not the target. The flick score is the only piece we borrowed.

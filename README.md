# Star Chasers · «Звёздные гонщики»

A browser game for **NASA Space Apps 2026**: build a rocket, pilot it yourself, then
walk the Moon and Mars to finish sample-collection tasks. No install, no
account, no server: everything runs client-side, in Russian and English.

Phaser 3 · TypeScript · Vite. Targets a 1280×720 canvas, scaled to fit.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (physics, rocket math, assembly, audio state, minions)
npm run build      # dist/ — a static bundle, deployable anywhere
npm run typecheck  # tsc --noEmit
```

## How the game flows

| Scene | What happens |
|---|---|
| **Menu** | switch language / sound, choose the astronaut, jump into the game |
| **Hub** | walk the base on foot, use the mission board, the sample lab and the pad |
| **Builder** | drag parts onto the stack, watch mass / Δv / TWR / stability update live, or load a ready-made rocket from **Presets** |
| **Flight** | you pilot the rocket in a real 2-D physics sim: engine, throttle, tilt, staging, parachute |
| **Explore** | walk the Moon or Mars (or drive the rover), drill samples to finish the task list, beam the data home |
| **Result** | stars, telemetry, a fun fact, and the next step |

Four missions (`m1` reach 10 km, `m2` reach 70 km and cut the engine, `moon` and `mars`
sample walks) plus a Sandbox that starts from the working preset rocket.

**Rocket presets.** The builder's **Presets** button opens six ready-made rockets
(`src/data/presets.ts`): Basic rocket, Sky Hopper, Space Arrow, Triple Booster, Crew
Capsule and Star Chaser. Each card shows the stars the rocket earns on First Launch
and Reach Space with the simplest flight plan (engine on, straight up, `Q` when a
stage runs dry, engine off above 70 km). Those stars are not hand-typed:
`predictFlight` flies the rocket through the real simulator and the mission's own
check when the picker opens. Presets that use parts a mission forbids are shown
greyed out. Loading one also prints its flight plan in the builder's side panel.

**The rover.** On both planets a rover waits beside the lander. Walk up and press
`E` (or `F`) to climb in; it drives at more than twice walking speed, drills samples
with its arm, and can transmit from beside the lander. `E`/`F` gets out, `H` honks.
Its eight-way art, tyre tracks, boot prints, HUD badge and sounds live in
`public/assets/rover/` (specs in [`roverassets.md`](roverassets.md)). Each file is
optional: drop it from the manifest and that piece falls back to the handoff
`machines_rover` sprite, drawn decals, or silence.

**Sample tasks.** Each planet (`src/data/planets.ts`) scatters ten samples and sets a
checklist: required tasks (e.g. *2 × ice*, *1 × mudstone*) unlock the transmit at the
lander, and a bonus task (*find all 5 types*) is worth a star; the third star is for
finishing under the planet's time limit. Gold rings mark samples a task still needs.
Everything brought home is added to the persistent collection shown at the hub's
**Sample Lab**.

**Controls.** The scheme is detected, not assumed: a phone or tablet gets the
on-screen pads and touch wording, a desktop gets the keyboard and no pads, and a
hybrid device switches to whichever was used last without a reload.

- **Hub & Explore**: WASD / arrows or the bottom-left **virtual thumbstick** to walk; `E`, the bottom-right **action button**, or tapping a nearby station/sample/lander directly to interact/drill/transmit.
- **Rover (Explore)**: `E` or `F` next to the rover to get in; the same keys or thumbstick steer it (it turns toward the direction you hold, then accelerates); `E` drills or transmits when something is in reach and otherwise gets out, `F` always gets out, `H` horn. On touch, the action button does all of it.
- **Builder**: drag or tap palette cards to attach parts; wheel or on-screen `+` / `−` / reset buttons to zoom; right-drag or 1-finger grid drag to pan; `Delete` or the on-screen **✕ Remove part** button to remove the selected part.
- **Flight**: `Space` engine on/off, `W`/`S` throttle, `A`/`D` tilt, `Q` drop stage, `C` parachute (all also on the bottom button row); `P` or pause icon to pause, `[` / `]` or warp icon (cycles 1× → 2× → 5× → 10× → 1×) to warp, `R` or reset icon to restart, `Esc` for the menu, back icon to return to the builder. Steering needs a flight computer or crew pod.

## Layout

```
src/
  core/       state, save, i18n, devtools, walker (player), crew (patrols),
              device (input-mode detection), minionArt (one size for every
              minion), audioState + audioSignals (is sound actually audible),
              rover (the drivable planet rover)
  data/       parts, bodies, mission definitions and their win/lose checks,
              planets (surface look, samples, sample tasks, rover handling),
              presets (ready-made rockets + their predicted flights)
  physics/    the flight sim + rocket stat maths (pure, unit-tested)
  scenes/     boot, menu, hub, builder, flight, explore, result
  ui/         theme (atlas wiring), widgets, touch (mobile joystick/action), drawn part fallbacks,
              rocketArt (one rocket drawing for flight + preset cards),
              flightFx (sky gradient, nozzle glow), surfaceFx (tracks, boot prints, vignette)
  i18n/       en.json, ru.json — every string in the game lives here
public/assets/
  ui/ui.png|json   packed atlas: parts, buttons, panels, icons, effects, logo
  v2/v2.png|json   packed atlas: base buildings, ground tiles, crew walks/idles, bells, fx, plumes, UI v2
  bg/*.webp        painted backdrops
  planets/         optional Moon/Mars art listed in manifest.json (see reqassets.md)
  rover/           optional rover art and sounds listed in manifest.json (see roverassets.md)
  overhaul/        optional art overhaul listed in manifest.json; replaces atlas frames
                   of the same name at boot (see artoverhaul.md, src/ui/overhaul.ts)
  anims/           walk-cycle JSON for the astronauts and the base crew
  atlases/         handoff art (astronauts, minions, terrain, machines, tools)
v2_src/            raw wishlist drop the v2 atlas is cut from (never shipped)
tools/
  cut-sprites.mjs  one-time segmenter: ui_v1 sheets → atlas + backdrops
  cut-v2.mjs       cutter for the v2 wishlist drops → v2 atlas + crew anims
  frame-names.json cutter config: which cut cells get a name
  check-atlas.mjs  verifies the packed atlas (size, alpha, frame list)
  icon-sheet.html  visual contact sheet of the atlas art, by frame name
  crew-check.mjs   QA strip: crops the crew frames out of the v2 atlas
  batch2-check.mjs QA strip: crops batch2 frames (bells, idles, poses, fx)
  batch3-check.mjs QA strip: crops batch3 frames (dialog, minimap, portraits, icons)
  tile-check.mjs   QA strip: 3×3 repeat check of the four ground tiles
```

`public/assets/` from the art handoff is **do not edit**; new UI art goes through the
cutter instead.

## The art pipeline

The `ui_v1/` sheets are irregular collages with no frame metadata, so the cutter
flood-fills the background inward from the border, labels 8-connected components,
crops each one, and repacks the named ones into a single atlas.

```bash
node tools/cut-sprites.mjs     # writes public/assets/ui/ui.{png,json} + bg/*.webp
node tools/check-atlas.mjs     # sanity check
open tools/icon-sheet.html     # eyeball the frames against their names
```

Only cells listed in `tools/frame-names.json` are packed, so every atlas frame is
deliberate. Naming a cell is how new art enters the game — then wire the name in
`src/ui/theme.ts` (`PART_FRAME`, `BG`) or use it directly via `hasFrame()`.

Every art lookup is defensive: if a frame is missing the game falls back to drawn
vector art instead of rendering blank. `tools/cut-frames/` holds the working crops and
is deliberately outside `public/` so it never ships.

### The v2 wishlist drops (batches 1, 2 & 3)

The v2 drops are big studio renders, irregular multi-object sheets, and clean grids, so
they have their own cutter. Raw files live in `v2_src/` (outside `public/`, never shipped).

```bash
node tools/cut-v2.mjs        # → public/assets/v2/v2.{png,json} + anims/crew_walk_anims.json
node tools/crew-check.mjs    # QA strip of the crew frames → tools/crew-check.png
node tools/batch2-check.mjs  # QA strip of the batch2 frames (bells, idles, poses, fx)
node tools/batch3-check.mjs  # QA strip of the batch3 frames (dialog, minimap, portraits, icons)
node tools/tile-check.mjs    # 3×3 repeat check of the four ground tiles
open tools/v2-report.html    # every cut frame, labelled
```

`cut-v2.mjs` handles six kinds of source, and the difference matters:

| Source | Treatment |
|---|---|
| single objects (`base_*.png`, `astro_wave.png`, `astro_point.png`, `ui_dialog.png`, `ui_minimap_frame.png`) | flood-fill the studio background inward from the border, comparing each pixel to its *parent* so the gradient key follows, trim, downscale, bleed the edge colours outward so resampling cannot pull the light background into the outline (`ui_minimap_frame.png` also floods from its centre via `keyCenter` so the viewport is hollow) |
| grid sheets (`minion_walk_*`) | deterministic `cols × 4` slice (`mechanic`/`driller`/`radio` are 4×4, `chemist` is 6×4), then key + trim each cell — the crew art has no separators to segment on |
| `base_crates_sheet.png` | three objects in a row, sliced by column band |
| irregular multi-object sheets (`minion_idle.png`, `engine_bells.png`, `fx_misc.png`, `ui_portraits.png`, `ui_icons.png`) | 8-connected component labelling (`components`), proximity box merging (`mergeBoxes`) so scattered debris/sparkles stay attached to their parent element, row banding (`bandRows`), and **one uniform scale factor per sheet** (derived from the largest element) so size ladders (`fx_cloud_s..xl`, `fx_sparkle_s..l`) keep their relative proportions |
| `fx_flames_sheet.png` | **kept black**, no keying at all: the plumes are drawn with `BlendModes.ADD`, so black is the transparent value |
| ground tiles | full-bleed: downscale only, never trimmed or keyed |

Gotchas worth keeping in mind when the next drop lands:

- **Walk-sheet row order is front / left / right / back**, not front / right / left.
  It's verified by cropping the frames (`crew-check.mjs`) — get it backwards and the
  entire crew moonwalks.
- **Per-sheet column counts (`CREW` table)**: `minion_walk_chemist.png` is 6 columns wide
  while the earlier three sheets are 4 columns wide. Both grid slicing and
  `crew_walk_anims.json` frame counts read `cols` from `CREW`.
- **Uniform scale per sheet (`cutComponents`)**: fitting each element to `maxEdge`
  individually flattens size ladders to the same width; computing a single
  `scale = Math.min(1, maxEdge / biggest)` preserves the progression.
- **Tight gaps & hollow interiors in Batch 3 (`ui_portraits.png`, `ui_icons.png`, `ui_minimap_frame.png`)**:
  the five round portraits sit ~6 px apart, so `ui_portraits.png` uses `mergeDist: 4`
  (larger merge distances fuse all five into one box, and equal-width `cutRow` bands clip
  the outer portraits). Hollow shapes (`ui_minimap_frame`, `ui_star_empty`, `ui_icon_gear`)
  pass interior seed points (`keyCenter` / `extraSeeds`) so their enclosed studio-white
  centres are keyed out cleanly.
- **Blast naming by shape**: row 2 of `fx_misc.png` is three distinct shapes
  (`fx_blast_burst` tall radial flash, `fx_blast_hit` wide debris fireball,
  `fx_blast_ground` flat ground trail), layered together in `FlightScene.explode()`.
- `pad_mark.png` is a full-bleed painted quadrant centred on its bottom-left corner,
  not a cut-out decal. It is used as one slab under the pad plus a drawn ring, because
  four rotated copies of a *square* produce a pinwheel, not a circle.

Frame names are wired in `src/ui/theme.ts` (`BASE_ART`, `GROUND_ART`, `FLAME_ART`,
`FX_ART`, `BELL_ART`, `UI_V2_ART`, `PORTRAIT_ART`) and the crew patrols in
`src/core/crew.ts` pick their anim by movement direction and pause on `minion_idle_*` at
waypoints.

## Dev shortcuts

Add these to the URL:

| Query | Effect |
|---|---|
| `?dev=1` | unlock all missions, show the DEV banner |
| `?scene=builder` | boot straight into a scene (`menu`, `hub`, `builder`, `flight`, `explore`) |
| `?mission=m2` | boot a real mission (pairs with `?scene=`; `moon` / `mars` with `?scene=explore`) |
| `?lang=en` | pin the language for this run |
| `?spawn=pad` | hub only: start next to a station (`board`, `lab`, `pad`) |

Combining them makes screenshots and manual checks one URL, e.g.
`?dev=1&scene=flight&mission=m1&lang=en`.

## Tests

`tests/` covers the parts that must not drift: the flight integrator (staging, drag,
landing), the rocket stat calculator (Δv, TWR, stability warnings), and the audio-state classifier
(which platform signals count as "the sound is off"). Scene code is verified by hand in
the browser.

`PLAN.md` holds the original build plan; `handoff/CORE_SPEC.txt` is the authoritative
spec and `handoff/ASSETS.md` the asset inventory.

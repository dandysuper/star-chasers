# Star Chasers — Implementation Plan & Handover Notes

> Working title: **Star Chasers** / «Звёздные гонщики». Educational space game for NASA Space Apps 2026 (challenge: "Space Mission Design Game"). Phaser 3 + TypeScript + Vite + Blockly, browser-only, RU/EN.
>
> This document is written for the agent taking over implementation. Read it fully before touching code. Authoritative spec is `handoff/CORE_SPEC.txt`; asset inventory is `handoff/ASSETS.md`; new UI art is `ui_v1/`.

---

## 1. Current state (what already exists)

The prototype is **scaffolded and mostly functional**. Verified working end-to-end in a live browser: Menu → Builder → Code (Blockly) → Flight (real physics) → Result → progress saved. `npm install`, `npm run dev`, `npm run build`, `npm test` all pass. 22 Vitest tests green.

### File map

```
index.html                     # #game canvas + #blockly-div + #ui-overlay DOM layers
vite.config.ts / tsconfig.json / package.json
.claude/launch.json            # "dev" config → npm run dev on :5173
public/assets/                 # atlases/anims/maps/audio (copied from handoff, DO NOT EDIT)
src/main.ts                    # Phaser.Game config (1280×720, Scale.FIT, dom container)
src/core/state.ts              # GameState singleton (+ window.__state for debug)
src/core/i18n.ts               # t(key,vars), fmtDist/fmtSpeed/fmtTime
src/core/save.ts               # localStorage "starchasers.save.v1"
src/data/parts.ts              # 13-part catalog (spec §3), PART_W/area, PRESET_BASIC
src/data/bodies.ts             # Earth/Moon constants @ 1/10 scale, MOON_SOI, dominantBody
src/data/missions.ts           # M1/M2/MOON defs + MISSION_ORDER, starter programs
src/data/assembly.ts           # design model: core stack + left/right booster columns (pure)
src/physics/rocket.ts          # splitStages, computeStats, warnings/blocking (pure)
src/physics/sim.ts             # FlightSim: semi-implicit Euler, patched conic, telemetry, preview (pure)
src/rocketscript/compile.ts    # Blockly JSON → AST, loose/missing-input checks (pure)
src/rocketscript/interp.ts     # step interpreter: threads, ops budget, loop guard (pure)
src/rocketscript/blocks.ts     # 13 custom Blockly blocks + toolbox + rsTheme + BUILTIN locales
src/ui/widgets.ts              # makeButton/makePanel/TXT/COL/ensureMusic (all-drawn UI)
src/ui/partArt.ts              # drawPart: side-view stub art for every part kind
src/scenes/BootScene.ts        # preload all assets + anims, then →menu in update()
src/scenes/MenuScene.ts        # bg map, astronaut+minions, buttons, mission list, toast
src/scenes/BuilderScene.ts     # palette cards, drag-ghost, snap top/bottom, live stats
src/scenes/CodeScene.ts        # Blockly in DOM div + right panel + bottom bar
src/scenes/FlightScene.ts      # camera zoom by altitude, Earth/Moon, HUD, interp wiring
src/scenes/ExploreScene.ts     # 40×30 tile Moon map, WASD walk, samples, helpers, transmit
src/scenes/ResultScene.ts      # headline/stars/fact/stats/buttons
src/i18n/ru.json, en.json      # flat key→string, full coverage
tests/rocket.test.ts, sim.test.ts, interp.test.ts   # 22 tests
ui_v1/                          # NEW painted art pack (this handover) — see §3
```

---

## 2. Known bugs / gaps to fix FIRST

These are real, verified issues — address before adding polish.

| # | Issue | Where | Fix |
|---|-------|-------|-----|
| 1 | **`makeButton` interactive order** — `setInteractive` on a Container with no size hit `hitAreaCallback is not a function`. | `src/ui/widgets.ts` | Now passes explicit `Geom.Rectangle` — **keep this pattern** for every new container button. If you replace buttons with sprites (§4), use `Phaser.GameObjects.Sprite` + `setInteractive()` (has natural bounds) and drop the container workaround. |
| 2 | **BootScene auto-transition was flaky** — `scene.start('menu')` inside `create()` can be swallowed while the loader flushes. Currently fixed via `_go` flag checked in `update()`. | `src/scenes/BootScene.ts` | Keep the update-gated transition; don't move `scene.start` back into `create()`. |
| 3 | **`mission` was computed in a field initializer** (`private mission = missionById(state.missionId)`), evaluated at construction → always `null` at boot. Fixed by assigning in `create()`. | `FlightScene`, `ExploreScene` | **Rule: never read `state.*` in field initializers** — Phaser builds scenes at boot before state is set. Compute in `create()`. |
| 4 | **Blockly DOM overlay swallows canvas clicks** near the right edge (Run button was unreachable). A bottom-bar Run was added as a workaround. | `src/scenes/CodeScene.ts` | Decide on layout (§5). If Run stays in the right panel, ensure it sits right of `#blockly-div`'s right edge and that the div has no transparent overhang. |
| 5 | **FlightScene: rocket now drawn into ONE graphics** (was per-part containers → double-offset bug, parts detached). Flame is a separate graphics in the same container. | `src/scenes/FlightScene.ts` | When you swap stub art for real sprites (§4), keep a single container with child images at computed offsets, pivot at centre. |
| 6 | **`rs_wait` advanced frame index on sleep** — fixed (`frame.i++` before sleeping). | `src/rocketscript/interp.ts` | covered by test. |
| 7 | **Interpreter budget guard** — loop boundaries yield each iteration, so a `forever{}`/huge-repeat can't trip the 300-tick guard; only single-tick >200-op work can (e.g. a giant `wait_until` condition). `evalExpr` now throws `BudgetExceeded`. | `src/rocketscript/interp.ts` | Matches spec intent; tests cover it. Don't "fix" loops to yield less — it's correct that legal loops yield per iteration. |
| 8 | **`update()` never ticks in a hidden/headless tab** — RAF is throttled; the game looked "frozen" in preview. | environment | Not a bug. For automated/browser testing, drive `game.step(dt, now)` from JS or keep the tab fronted. `window.__game` and `window.__state` are exposed for this. |
| 9 | **`ExploreScene.update` recentre hack for rings** is a no-op leftover — rings pulse via `setScale` but their `setPosition` math is dead code. | `src/scenes/ExploreScene.ts` | Remove or fix; draw ring centred at (0,0) inside a container positioned at sample x,y. |
| 10 | **Verstайка**: Blockly div is 73% but right panel content can be tight; `errMsg` x=420 may overlap bottom-bar buttons at 1280 width. | `CodeScene` | Re-layout when styling UI (§4). |
| 11 | **Result buttons unclickable** — they drew in the right place but nothing happened. `makeButton` builds its click Zone as a *scene sibling* of the visual container; `ResultScene` did `panel.add(button)`, which re-parented the art into the panel and left the Zone in scene space at x = −150, off the canvas. | `src/scenes/ResultScene.ts` | **Fixed.** Buttons stay scene children and are placed at `panel.x + bx, panel.y + by`. **Rule: never re-parent the container returned by `makeButton` — it moves the art and leaves the hit area behind.** Menu and the in-game menu always obey this. |
| 12 | **Blockly overlay ate clicks after the Code screen** — a Phaser Scene has no `shutdown()` method to override (`Systems.shutdown()` only emits an event), so `CodeScene.shutdown()` was dead code and the `z-index: 10` Blockly div survived any exit that bypassed `leave()`, covering 73% of the canvas and swallowing taps in the following scenes. | `src/scenes/CodeScene.ts` | **Fixed.** Teardown now hangs off `Phaser.Scenes.Events.SHUTDOWN`, so the div is hidden on every exit path. Any other DOM overlay must do the same. |
| 13 | **The builder could only stack straight up, and two parts could never be placed.** The fairing was rejected everywhere (a nose already sat at the top, and the bottom is not the top), *everything* dropped at the top was rejected by "nothing above a nose", and an engine could not go under a trailing engine. | `src/scenes/BuilderScene.ts`, `src/data/assembly.ts` | **Fixed.** The rocket is now a core stack plus a booster column on each side — three abreast — saved as `slots`. Insertion is smart instead of refusing: a part dropped at the top lands under the fairing, one dropped at the bottom lands above a trailing engine, and a fairing dropped on a fairing replaces it. Physics judges an engine against *its own column*. |
| 14 | **The minions had no voice.** The sound prompt sheet existed, but nothing in the game could load a recording, and there was no path from a generated file to a running scene. | `src/core/minionAudio.ts`, `tools/minion-audio.ts`, `MINION_SOUND_PROMPTS.md` | **Fixed.** `npx vite-node tools/minion-audio.ts <folder-or-zip>` classifies each file, copies it to `public/assets/audio/minions/` and rewrites the generated `src/data/minionAudio.ts` manifest. The runtime plays a clip only if it is in the manifest, so an empty batch means silence and no 404s, and gameplay never depends on the audio. |

---

## 3. The new `ui_v1/` art pack

25 hand-painted PNG sheets, all **2752×1536**, thick-outline cartoon style matching the game. Naming: `A*` = sprite sheets (parts/effects), `B*` = full-scene backdrops, `C*` = UI components. `*_v2_*` files are the second, generally better art pass — **prefer v2 where a v1/v2 pair exists** (v1 = `A1_rocket_parts_nose_tanks`, `A2_rocket_parts_engines_decouplers_fins`, `A3_rocket_parts_misc`; keep originals as alternates).

> **Frames are NOT uniform.** Sheets are irregular collages — each part occupies a different-sized region on a mostly-white (or scene) background. There is **no `frames` JSON** in the pack. You must generate frame coordinates.

### 3a. Build a sprite-cutter (one-time, offline-ish)

Write a small Node script (`tools/cut-sprites.mjs`, use `sharp` — `npm i -D sharp`) that:

1. Loads each `A*`/`C*` sheet.
2. Finds connected non-background regions (flood-fill / `sharp` + a pixel loop, or `jimp`; background = near-white `#fff` / transparent for A-sheets; C-sheets may share bg — check corners).
3. Emits each region as its own PNG into `public/assets/ui/` **and** merges entries into a JSON-Hash atlas record (or build a proper `.atlas`/TPack via `free-tex-packer` CLI if you prefer).
4. Gives each sprite a stable `frame` name (see mapping below).

> Alternatively hand-crop a handful — but a cutter is more reliable since regions are irregular. Store the generated `ui.json` atlas in `public/assets/ui/` and load it in BootScene like the existing atlases.

### 3b. Frame → game mapping (fill in after cutting)

Use these semantic names when cutting so scenes can reference them directly:

| Game object | Sheet | Sprite content (from inspection) |
|---|---|---|
| `nose_cone` | A1_v2 / A1 | red-striped pointed nose (v1: red/white tip top-left) |
| `probe_core` | A1 | dome capsule w/ round window + antenna |
| `pod` | A1 / A3_v2 | big crew capsule (A3 has the riveted one) |
| `tank_s` `tank_m` `tank_l` | A1_v2 / A1 | short/mid/tall fuel drums (orange FUEL barrel = tank_l) |
| `engine_spark` `engine_bull` `engine_whisper` | A2_v2 / A2 | small orange bell / big blue bell / thin cyan bell |
| `decoupler` | A2_v2 / A2 | yellow-black striped band / red strap ring |
| `fins` | A2_v2 / A2 | red fin set / gold fin set |
| `parachute` | A4_effects | red-white canopy (bottom-right) |
| `sensor_alt` `sensor_speed` | A3_v2 | small instrument / dish assembly |
| flame stages (S/M/L) | A4_effects | small / medium / large fire plume |
| smoke | A4_effects | grey smoke puff |
| explosion | A4_effects | orange burst w/ smoke |
| menu logo | C6_logo | "STAR CHASERS" wordmark + rocket |
| star 0/1/2/3 badges | C3_stars | three plaque rows |
| buttons (normal/hover/pressed × 6 colours) | C1_buttons | 6×3 grid of pill buttons |
| panels / bars / toggles | C2_panels | big framed panel, HUD bars, gear toggles |
| icons (play, pause, ×2, ×4, gear, back, home, sound, mute, RU, EN, trash, reset) | C4_icons | 13 round icon buttons |
| Blockly block shapes (hat/statement/reporter/hex-bool/round-num/puzzle) | C5_block_palette | block-shaped swatches (see §5 caveat) |
| splash bg | B1_v2_splash | title splash backdrop |
| menu backdrop | B2_main_menu | launchpad scene (sunset) |
| builder backdrop | B3_builder | workshop interior |
| code backdrop | B4_code | mission-control room |
| flight earth | B5_flight_earth | Earth limb + satellites/asteroids |
| flight space | B6_flight_space | deep-space starfield |
| flight moon | B7_flight_moon | lunar surface |
| result win | B8_result_win | minion celebration w/ trophy |
| result fail | B9_result_fail | (inspect) |

Copy the cut PNGs into `public/assets/ui/` and a generated `ui.json` atlas. Keep originals in `ui_v1/` (don't ship 100 MB of sheets in `public/` — only the cut sprites + atlas).

---

## 4. Integration work (replace stubs with real art)

Do this after §3 produces usable frames. Keep the `window.__game`/`__state` debug hooks.

### 4a. Loader & atlas

- `BootScene.preload`: add `this.load.atlas('ui', 'assets/ui/ui.png', 'assets/ui/ui.json')` (or per-image `this.load.image` if you keep separate PNGs).
- Keep a **fallback**: if `ui` atlas missing a frame, fall back to `drawPart` stub so the game never blanks.

### 4b. Rocket parts (Builder + Flight)

- Replace `drawPart` stub calls with `ui` atlas frames keyed by part id.
- Parts still need a **stack height** for layout — keep `partDef(id).h * UNIT_H` for snap/place math, and scale the sprite to `PART_W` wide × that height (preserve aspect where possible; engines/fins may overflow width — allow it visually).
- `BuilderScene.rebuildStack`, `buildPalette`, `startDrag` ghost — swap `drawPart(this,id)` → `this.add.image(0,0,'ui',frameForPart(id))`.
- `FlightScene.buildRocketArt` → build a `Container` of `Image` children stacked like now, pivot at centre.

### 4c. Buttons, panels, HUD, icons

- Replace `makeButton` graphics with a `Sprite` (or `Image`) from `C1_buttons` + a `Text` label; choose a colour per context (accent=yellow, normal=blue, danger=red). `pointerover` → hover frame, `pointerdown` → pressed frame.
- `makePanel` → `C2_panels` big framed panel (slice or scale to size; consider `Phaser.GameObjects.RenderTexture` or 9-slice via `Phaser.GameObjects.NinePatch` if available in v3.90 — else scale).
- HUD bars (fuel, drill progress) → `C2_panels` bar sprites.
- Icons (`C4_icons`): use for pause/warp×1×2×5×10 (you have play/pause/×2/×4/gear — reuse for warp steps), RU/EN language toggles, sound on/off, trash (delete part), reset (restart), back/home (Back/Menu).
- Result stars → `C3_stars` plaques; show 0/1/2/3 filled.
- Speech bubbles / tooltips → `C2_panels` small bubble sprite or keep drawn.

### 4d. Scenes / backdrops

- `MenuScene`: logo `C6_logo` (replace text title — keep i18n subtitle as text), backdrop `B2_main_menu` (replace world_map or keep map for mission select), keep astronaut+minions sprites.
- `BootScene`/splash: `B1_v2_splash`.
- `BuilderScene`: `B3_builder` as dimmed backdrop.
- `CodeScene`: `B4_code` as backdrop behind Blockly (reduce Blockly workspace bg opacity so art shows, or keep dark — judge readability).
- `FlightScene`: ground phase → `B5_flight_earth` low on screen + gradient sky on top; high altitude → `B6_flight_space`; near Moon → `B7_flight_moon`. Blend by altitude (`drawSky` already interpolates colours — lerp backdrop alpha too). Keep drawn Earth arc when zoomed (the B5 art is a backdrop, the sim still needs the live circle/trajectory overlay).
- `ResultScene`: `B8_result_win` on success / `B9_result_fail` on fail, dimmed behind panel.
- `ExploreScene`: could use `B7_flight_moon`-style texture tiles for ground if you want variety, but terrain_v2 tiles already work — optional.

### 4e. Effects

- Engine flame → `A4` flame sprites sized ∝ throttle (swap the 3 stacked-triangle stub; keep a 2-3 sprite flicker via scale/alpha).
- Smoke → `A4` smoke puff, particle emitter in atmosphere.
- Explosion → `A4` burst + screen shake.
- Parachute deployed → `A4` canopy above the rocket.

---

## 5. Blockly / RocketScript notes

- **Custom `rs_*` blocks** are defined in `src/rocketscript/blocks.ts`, labels via `t()` so re-mounting rebuilds in the new language. `defineRocketScriptBlocks()` early-returns if `lastLang === state.lang` — after a lang switch, CodeScene must re-inject the workspace (it re-runs `create` each mount, so OK).
- **Blockly.Msg** for built-ins is set from `BUILTIN_RU/EN` maps in `blocks.ts`.
- **C5_block_palette** sprites are *decorative* block shapes — Blockly renders its own vector blocks; you can't directly skin them with PNGs easily. Options: keep Blockly's vector blocks tinted by `rsTheme` (already themed to match colours), or build a custom `IPathObject`/`ConstantProvider` to use shapes as backgrounds (advanced). **Recommended: keep vector blocks, use C5 only as toolbox-category icons or a decorative flyout header.** Don't burn time skinning Blockly.
- Program buttons (`rs_when_button`) are DOM `.rs-button` in `#ui-overlay`; restyle them to match `C1_buttons` colours.
- Starter programs live in `missions.ts` (`M1_STARTER` reused for M2).

---

## 6. Remaining feature work (spec completeness)

Priority order from `CORE_SPEC` §0 — P1–P5 mostly exist; verify & finish:

1. **P2 Flight details** — verify wobble (`!stable` sinusoidal pitch in atmosphere — implemented in `sim.step`), smoke particles (add `A4` smoke emitter), explosion sequence (currently just `crashed` event → log). Camera zoom curve `1px=1m→1px=2km` exists but check it doesn't get *too* zoomed out to see the rocket (consider clamping min zoom ~0.02 or scaling the rocket sprite with zoom).
2. **P4 M2 specifics** — "engine off by program" uses `control.engineOn===false` once → `engineOffByProgram`. Verify a no-cutoff program actually fails `fail.no_cutoff` (should trigger when `maxAltitude>=70000` and `!engineOffByProgram`). Test the "wait until altitude>60000 → engine off" program e2e.
3. **P5 Explore** — verify: 4-dir walk anims play (idle fallback fixed), helpers follow w/ lag, radio-scout points, sample rings pulse, E-drill 1.5s bar, 3 samples → transmit → Result. The `minions_radio_scout` rotation is a stub (0.15·angle) — make it actually face the sample.
4. **P6 Saves/polish** — `?dev=1` unlocks all (state.dev) — verify mission select respects it. Fail messages kid-friendly (in i18n). Hints shown in Builder/Code for each mission (`hintKeys` defined but only Explore uses them — surface M1/M2 hints in the Code right panel).
5. ~~**Music ducking**~~ — **done.** The soundtrack is now per-scene (`src/core/themeTracks.ts` route map + `src/ui/music.ts` runtime): menu/hub/result share `main_theme`, builder/code/explore share `builder_theme`, flight uses `flight_theme` and ducks to half level. Scene changes crossfade instead of cutting, the win screen plays `victory_jingle` over a lowered bed, and the sound toggle silences and restores the bed for wherever the player is. Add a track by adding one entry to `TRACKS` plus one row in `SCENE_TRACKS`.

---

## 7. i18n / save / mission checklist

- `ru.json`/`en.json` keep **identical keys**. Add keys for any new UI text (fact cards per sample already exist: `sample.*`, `fact.*`).
- Save format `starchasers.save.v1` — `loadSave` validates `version===1`; on change bump version + migrate/reset.
- Missions unlock in `MISSION_ORDER` via `missionUnlocked` (dev bypass). `recordResult` stores stars/bestTime. Design/program persist per mission under `state.designs[designKey()]`, `state.programs[designKey()]`, saved on Builder/Code leave + Result.
- Add any new part → `parts.ts` + `part.<id>.name/desc` keys + `allowedParts` in the mission + a sprite frame + stacking-rule handling in `rocket.ts`/`validatePlace`.

---

## 8. Acceptance (from CORE_SPEC §10) — regression check after UI work

- [ ] `npm i`, `npm run dev`, `npm run build`, `npm test` pass; no console errors on load.
- [ ] Menu: backdrop, music after first click, RU/EN switch changes all text incl. blocks.
- [ ] Builder: drag parts, instant stats match formulas, invalid drops explained, preset works.
- [ ] Code: 20 blocks in toolbox, starter loaded, program persists.
- [ ] Flight: default rocket + starter completes M1; HUD correct; pause & warp work; trajectory above atmosphere.
- [ ] "engine off at 60 km" program + Δv≥3 km/s completes M2; no cutoff → clear fail.
- [ ] `forever {}`/runaway loop → error shown, tab doesn't freeze.
- [ ] Explore: 4-dir walk, helpers follow, 3 samples collect w/ E, transmit ends mission.
- [ ] Result: stars + fact; progress saved; missions unlock.
- [ ] Only provided/handoff + ui_v1 assets; missing visuals are styled stubs.

---

## 9. Suggested build order for the next agent

1. `npm i -D sharp` → write `tools/cut-sprites.mjs` → generate `public/assets/ui/` + `ui.json` (§3a). Verify each expected frame exists.
2. Wire `ui` atlas in `BootScene` + a `frameForPart` map; swap part art in Builder + Flight (§4b). Keep stub fallback.
3. Swap buttons/panels/icons/stars (§4c) — delete `makeButton` container hack once sprites handle input.
4. Backdrops per scene (§4d) + Flight layered sky (earth→space→moon).
5. Effects: flame/smoke/explosion/parachute sprites (§4e).
6. Close spec gaps (§6): M2 cutoff check e2e, Explore polish, music ducking, mission hints.
7. Re-run all tests + the §8 acceptance list; update this file's known-bugs table as fixed.
8. Update `README.md` (see §10) with what changed.

## 10. README status

`README.md` is **not yet written** — create it: how to run (`npm i && npm run dev`), controls (Builder: drag/wheel/right-drag/Delete; Code: drag blocks/Run; Flight: Space/[ ]/R/Esc; Explore: WASD+E), what's done vs. stubbed, and the `?dev=1` flag.

---

*Generated for handover — the prior agent verified the core loop works in-browser; treat §2's table as the living bug list.*

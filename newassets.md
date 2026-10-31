# Art & audio we still need

Updated after **v2 batch 1** (`star_chasers_v2_wishlist.zip`), **v2 batch 2**
(`star_chasers_v2_batch2.zip`), and **v2 batch 3** (`star_chasers_v2_batch3.zip`).
Every visual asset on the wish list has now been delivered, cut by `tools/cut-v2.mjs`
(125 frames total, verified with `tools/crew-check.mjs`, `tools/batch2-check.mjs`,
`tools/batch3-check.mjs`, and `tools/tile-check.mjs`), and wired into the game. Only the
audio effects remain on the wish list below — the game runs without them.

Priorities: `P0` = blocks a feature from looking finished, `P1` = big visual win,
`P2` = polish.

## Delivered in v2 (all wired up)

| Arrived | Where it is used |
|---|---|
| `base_habitat`, `base_control`, `base_tower`, `base_board`, `base_dish`, `base_tanks`, `base_airlock`, `base_crates_sheet` | the walking base (`src/scenes/HubScene.ts`) — habitat, flight computer, gantry, mission board, fuel farm, airlock, supply crates |
| `ground_plate`, `ground_plate_worn`, `ground_hazard`, `ground_road` | the paved apron, its hazard border and the track out to the pad |
| `pad_mark`, `pad_clamp` | landing-pad paint under the pad, and the hold-down clamps around it |
| `minion_walk_mechanic_sheet`, `minion_walk_driller_sheet`, `minion_walk_radio_sheet` (4×4) + `minion_walk_chemist` (6×4) | 4-direction walk cycles (`src/core/crew.ts`, `src/scenes/HubScene.ts`); all four crew members patrol the base |
| `minion_idle` (`minion_idle_mechanic`, `driller`, `radio`, `chemist`) | crew waypoint breathers (`src/core/crew.ts`) — patrols pause on their standing idle frame before resuming |
| `astro_wave`, `astro_point` | standing-still greeting wave in `HubScene` (`WAVE_AFTER_MS = 4500`) and right-panel guide mascot in `CodeScene` |
| `engine_bells` (`bell_spark`, `bell_bull`, `bell_whisper`) | nozzle bells hung under engine bodies in `addPart()` (`src/ui/theme.ts`), with `bellDrop()` offsetting the flight plume and smoke |
| `fx_flames_sheet` | rocket exhaust, drawn additively at three sizes |
| `fx_misc` (`fx_cloud_s..xl`, `fx_blast_burst/hit/ground`, `fx_sparkle_s..l`) | uniform-scaled size ladders: `fx_cloud_m` exhaust smoke, 3-layer + `fx_cloud_xl` crash explosion in `FlightScene`, and gold `fx_sparkle_l` burst on sample collection in `ExploreScene` |
| `ui_dialog` | speech bubble panel (`makeSpeechBubble()` in `src/ui/theme.ts`) used for crew hints in `ExploreScene` and program `say` callouts in `FlightScene` |
| `ui_portraits` (`ui_portrait_mechanic`, `driller`, `radio`, `chemist`, `astronaut`) | round crew portraits paired with `ui_dialog` speech bubbles in `ExploreScene` and `FlightScene`, plus chemist badge on the sample fact card |
| `ui_minimap_frame` | hollow metallic radar bezel (`keyCenter: true`) framing the live top-right radar minimap in `ExploreScene` |
| `ui_icons` (`ui_arrow`, `ui_star_empty`, `ui_star_full`, `ui_cursor_hand`, `ui_icon_wrench`, `ui_icon_fuel`, `ui_icon_gear`, `ui_icon_rocket`) | guide arrows in `HubScene` & `ExploreScene`, 3-star rows (`addStarRow()`) in `HubScene` & `MenuScene`, drag-hand & header icons in `BuilderScene` & `CodeScene`, and fuel gauge badge in `FlightScene` |

Notes for future hand-overs:
- **Walk-sheet rows are front / left / right / back**, and `CREW` in `tools/cut-v2.mjs`
  sets the column count per character (`4` for mechanic/driller/radio, `6` for chemist).
- **Multi-object irregular sheets** (`fx_misc`, `minion_idle`, `engine_bells`,
  `ui_portraits`, `ui_icons`) are cut via 8-connected component detection + proximity box
  merging and scaled with **one uniform scale factor per sheet** (`mergeDist: 4` for the
  closely-spaced portraits; `extraSeeds` / `keyCenter` for hollow interiors).

---

## Remaining wish list: Audio — `P2` (cheap and high impact)

The game currently has one music track (`main_theme.mp3`) and no sound effects.

| File | What it is | Notes |
|---|---|---|
| `sfx_click.mp3` | UI click | short, 60 ms |
| `sfx_footstep_1..4.mp3` | Boots on regolith | 4 variations, randomised |
| `sfx_drill.mp3` | Sample drill loop | 2 s, loopable |
| `sfx_collect.mp3` | Sample collected chime | |
| `sfx_launch.mp3` | Launch rumble bed | 5 s loop |
| `sfx_stage.mp3` | Stage separation thunk | |
| `sfx_win.mp3` / `sfx_fail.mp3` | Result stingers | |
| `amb_base.mp3` | Base ambience (hum, wind, far clanks) | 30 s loop |
| `amb_moon.mp3` | Moon ambience | 30 s loop, near-silent |

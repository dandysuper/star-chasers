# Requested assets: complete art overhaul

> **Status (11 Nov 2026): delivered and in the game**, except the walk sets
> (Tier 3), which the bot left out on purpose. 124 keys are installed in
> `public/assets/overhaul/` by `work/install-overhaul.py`, which copies the
> files and resizes the backdrops (to 1280×720, flight ones to 1440×810) and
> the logos (to 784×396), because the canvas is 1280×720. It also adds
> `ui/stars_0`, an empty plaque derived from `stars_1`. At boot,
> `src/ui/overhaul.ts` packs the images into power-of-two pages (for mipmaps)
> and swaps them in for the atlas frames of the same name. Every file is still
> **optional**: anything missing falls back to today's art.
>
> Delivered but unused: the `resources_*` map icons (every sample has its own
> art) and `ui/fx_flame_m`, `ui/fx_smoke`, `ui/fx_explosion`, `ui/fx_blast`,
> `v2/flame_small`, `v2/flame_medium` (only used as fallbacks).

## The game, in one paragraph

**Star Chasers / «Звёздные гонщики»**, a browser game (Phaser 3, 1280×720,
scaled to fit the window) for kids aged 9–15, in Russian and English. Kids build
a rocket from parts in a hangar (**Builder**), fly it in side view with real
physics (**Flight**: launch pad, sky fading to space, the curve of the Earth,
dropped stages), then walk or drive a rover around the Moon or Mars in a
top-down three-quarter view with four little yellow crew helpers, collecting
science samples (**Explore**). There is also a walkable home base (**Hub**), a
main menu, and win/fail result screens.

## What "better" means here

Today's art comes from three packs made at different times, and it shows:
- **Rocket parts don't match.** The medium tank is a green canister, the large
  tank is an orange barrel, and the small tank has no art at all (it reuses
  the medium one). A stacked rocket looks like a pile of unrelated objects, and
  at the 40 px width the builder draws them, the details turn to mush.
- **Characters are low-resolution.** The astronauts are 128 px tall but shown
  at about 180 px, so they look soft.
- **Explore boulders and craters are code-drawn ellipses.**
- **UI pieces stretch badly.** Buttons and panels are stretched to many widths,
  and their painted edges distort.

The goal is one consistent, polished look across every screen, sharper at the
size it is actually shown, without losing the current identity.

## Style anchors (match these)

The newest deliveries are the target quality and style. Match them.
- `public/assets/rover/rover_*.png`: the white-and-orange six-wheeled rover.
- `public/assets/planets/lander_*.png` and `sample_*.png`.

**Shared style (prepend to every image prompt):**
> Cartoon game asset, thick dark-purple outline (#1d1b2e), bold flat colours
> with soft cel shading, light from the top-left, friendly kids'
> space-adventure style like a hand-painted 2D mobile game (Crashlands-like:
> bright, chunky, a little comedic), centred single object, **transparent
> background**, no text, no logos, no ground shadow (the game draws its own).

**Rules for every image**
1. **No text, letters or numbers baked in.** Every word in the game is
   translated at runtime. The only exception is the logo (last row of C).
2. **Outline weight is judged at display size.** Aim for a 2–3 px outline when
   the asset is shown at the size in the "Shown at" column. Thin outlines
   vanish at small sizes.
3. **Read at display size first.** Silhouette and one or two colour blocks must
   identify the object at the shown size. Put fine detail where it survives.
4. **Clean alpha.** No green or white fringe from chroma-keying, no
   semi-transparent haze around the object, no stray pixels. Check on both a
   dark (#1d1b2e) and a light (#e8e8e8) background.
5. **Same camera and light within a set.** All parts face the same way and are
   lit from the top-left. Top-down sets use the rover's three-quarter angle.
6. **Palette.** Outline #1d1b2e. Hull white/light grey. Accent orange (#f28c28
   family, like the rover). Hazard yellow #ffd23f. UI cyan #59f7ff. Never rely
   on colour alone to tell two things apart: shape must differ too, for
   colour-blind players.
7. **Mirror-safe where noted.** Some art is flipped in code, so it needs no
   one-sided lettering or decals.
8. **Stretchable UI.** Buttons and panels are stretched to many sizes. Keep all
   decoration in the corners and ends, and keep the middle plain and flat, so
   it can be 9-sliced or stretched without distortion.

## How to deliver

One zip per tier: `art-overhaul-tier1.zip`, `-tier2.zip`, `-tier3.zip`. Each
zip has this layout:

```
public/assets/overhaul/
  manifest.json
  <group>/<key>.png        one PNG per asset, named exactly as the Key column
  bg/<key>.webp            full-screen backdrops (WebP, quality ~85)
qa/
  <group>-sheet.png        every asset in the group at "Shown at" size, on the game's
                           own backgrounds (grey Moon #8f8f8f, rust Mars #9a4a2c, hangar #2b2d5c)
  <group>-alpha.png        zoomed edges on dark and light, like the rover pack's alpha-zoom
  tiles-3x3.png            each seamless tile repeated 3×3, to show it has no seams
REQUEST.md                 a copy of this file
```

`manifest.json` lists **only files that exist**:

```json
{
  "images": [
    { "key": "ui/btn_blue", "file": "ui/btn_blue.png" },
    { "key": "bg/builder",  "file": "bg/builder.webp" }
  ]
}
```

- `<group>/<key>` must match the tables exactly. Where a key is an existing
  atlas frame name, the new file **replaces that frame**. Wiring the overrides
  into code happens on our side after delivery: send PNGs, not atlases.
- **Size.** Deliver at the "Deliver" size. It is about 2× the largest size the
  game shows the asset at, so it stays sharp on high-DPI screens. Keep the
  aspect ratio stated, and keep the anchor (the feet, the wheels or a joint) on
  the canvas edge or line the table names.
- **Partial sets are useless for animation.** Every frame of a walk cycle must
  be the same character at the same scale, or leave the whole set out.
- **Don't change code or push to the repo.** The GitHub `main` branch is behind
  the local game: it lacks the rocket presets, the rover and the new flight
  scene. Where the repo and this brief disagree, follow this brief.

---

## Tier 1: the screens kids see most

### A. Rocket parts: one matching family (group `parts`)

The parts stack vertically into a rocket in side view, nose up. The builder
draws a stack **40 px wide per 1.25 m of rocket**. In flight the whole rocket can
shrink to 12–40 px wide. **All hull parts must share the same body width and
the same joint line**: a flat seam exactly on the top and bottom edges of the
canvas, so any two parts stack with no gap or step. Body width is **256 px**
on every hull canvas; the height follows the part's length.

**Family look:** a white/light-grey hull with orange trim, like the rover. Give
each role a distinct shape *and* colour accent:
- tanks: orange bands, more bands on bigger tanks;
- engines: dark steel with a coloured ring;
- decoupler: a yellow/black hazard ring;
- control parts: a cyan window or screen.

| Key | Part | Canvas (w×h) | Shown at | Prompt (after the shared style) |
|---|---|---|---|---|
| `parts/nose_cone` | Nose cone, 1.0 unit | 256×256 | 40×40 | A rounded rocket nose cone, white with an orange tip band and two small rivet lines; flat base on the bottom edge. |
| `parts/probe_core` | Flight computer, 0.6 | 256×154 | 40×24 | A short cylindrical avionics ring with a cyan screen window and two tiny blinking lights. |
| `parts/pod` | Crew pod, 1.2 | 256×307 | 40×48 | A cone-topped crew capsule with a round cyan porthole and a hatch outline, white with orange trim. |
| `parts/tank_s` | Small tank, 1.0 | 256×256 | 40×40 | A short fuel drum: white, **one** orange band, a small fuel-cap detail. (New: no art for this today.) |
| `parts/tank_m` | Medium tank, 2.0 | 256×512 | 40×80 | The same drum design, twice as tall, **two** orange bands. |
| `parts/tank_l` | Large tank, 4.0 | 256×1024 | 40×160 | The same design, four times as tall, **four** orange bands and a ladder of rivets. |
| `parts/decoupler` | Separator, 0.3 | 256×77 | 40×12 | A thin ring with diagonal yellow/black hazard stripes and small explosive-bolt dots. |
| `parts/engine_spark` | Small engine body, 0.8 | 308×205 | 48×32 | A compact engine housing (1.2× hull width), steel grey with a **blue** ring. Its nozzle bell is a separate file. |
| `parts/engine_bull` | Big engine body, 1.2 | 308×307 | 48×48 | A heavy, chunky engine housing with bolts and pipes, steel with a **red** ring. |
| `parts/engine_whisper` | Space engine body, 1.4 | 308×358 | 48×56 | A slim, elegant vacuum-engine housing with gold foil panels and a **purple** ring. |
| `parts/bell_spark` | Spark nozzle bell | 220×352 | 34×55 | A small bell nozzle, steel with heat-tint (blue-gold) near the rim. Top edge is the joint. |
| `parts/bell_bull` | Bull nozzle bell | 290×378 | 45×59 | A wide, short, rugged bell, darker steel, heat-scorched rim. |
| `parts/bell_whisper` | Whisper nozzle bell | 170×400 | 26×62 | A long, narrow, flared vacuum bell, polished, heat-tinted. |
| `parts/fins` | One fin (mirrored in code for the pair) | 160×320 | 24×68 | A single swept tail fin, attached edge on the **right**, white with an orange leading edge. Mirror-safe. |
| `parts/parachute` | Parachute, open (part card and the deployed chute in flight; replaces `ui/fx_chute`) | 384×256 | 64×43 | An open round parachute canopy, orange and white segments, with lines meeting at a point at the bottom centre. |
| `parts/parachute_packed` | Packed chute, 0.5 | 256×128 | 40×20 | A short canister with a cloth top and an orange pull ring. (New key.) |

### B. Backdrops (group `bg`, WebP, 2560×1440, full-bleed, no transparency)

UI sits on top of every backdrop, so keep the composition calm in the middle
third and put the interest at the edges.

| Key | Screen | Prompt |
|---|---|---|
| `bg/builder` | Rocket hangar, shown under a 50% dark overlay | Inside a cosy, cluttered cartoon rocket workshop: gantry, hanging lamps, tool racks, blueprints pinned up. A clear empty vertical space in the centre where the rocket is built. Warm lamplight against a blue-purple shadow palette. |
| `bg/flight_earth` | Launch and lower sky | Wide view of a sunny launch field at the bottom edge, rolling green hills, a soft blue sky fading upward. Few details in the sky so the rocket stands out. |
| `bg/flight_space` | Above the atmosphere | Deep space, purple-navy, soft nebula wisps at the corners, sparse stars. No planets in the centre. |
| `bg/flight_moon` | Approaching the Moon | Deep space with a large cartoon Moon filling the lower-right quarter, grey with soft craters. |
| `bg/menu` | Main menu, logo and buttons centred | A cheerful cartoon spaceport at dusk: a rocket on its pad on the left, the base domes on the right, a big Moon in the sky. |
| `bg/splash` | Loading screen | The rocket lifting off from the pad with a big cloud of exhaust, seen from a distance, at sunrise. |
| `bg/result_win` | Mission success | Confetti-coloured fireworks over the spaceport at night, warm and celebratory. |
| `bg/result_fail` | Mission failed: gentle, not scary | A cosy hangar at night under one lamp, with a slightly singed rocket and a wrench on the floor. Calm blue tones, "let's try again" mood. |

### C. UI kit (group `ui`, stretchable as in rule 8)

| Key | Shown at | Deliver | Prompt / notes |
|---|---|---|---|
| `ui/btn_blue`, `btn_red`, `btn_green`, `btn_orange`, `btn_yellow`, `btn_purple` | 110–520 × 40–60 | 640×160 | A glossy rounded pill button, with a darker bottom lip for a 3D press and a highlight streak on top. Flat middle, so it stretches. No text. |
| `ui/panel_big` | 420–1060 × 170–642 | 1024×640 | A dark-navy (#1d1d3a) rounded panel with a thin cyan inner bevel and small rivets in the four corners only. Plain middle. |
| `ui/ico_gear`, `ico_play`, `ico_pause`, `ico_x2`, `ico_back`, `ico_sound`, `ico_mute`, `ico_reset`, `ico_ru`, `ico_en` | 44–54 | 160×160 | A round purple badge button with a white glyph. `ico_ru` and `ico_en` show flag-colour discs, **no letters**. One consistent badge for all ten. |
| `ui/stars_1`, `stars_2`, `stars_3` | 248×86 | 640×224 | A plaque holding three star slots, with 1, 2 or 3 of them filled in gold. |
| `v2/ui_star_full`, `v2/ui_star_empty` | 16–26 | 120×120 | A single chunky gold star, and the same star empty (dark slot). |
| `v2/ui_dialog` | 240×88 to 290×96 | 640×384 | A speech bubble with a light-cyan screen and a tail at the bottom-left. Screen in the upper 76% of the canvas, matching today's frame. Stretchable. |
| `v2/ui_portrait_astronaut`, `_mechanic`, `_driller`, `_radio`, `_chemist` | ~56 | 256×256 | A round head-and-shoulders portrait inside a ring, one per character, in the same framing. |
| `v2/ui_minimap_frame` | 200 | 480×480 | A round radar bezel, steel-blue, with a small cyan pointer notch at the top. Transparent middle. |
| `v2/ui_icon_wrench`, `ui_icon_gear`, `ui_icon_rocket`, `ui_icon_fuel`, `ui_arrow`, `ui_cursor_hand` | 16–32 | 128×128 | Small HUD glyphs, chunky, readable at 16 px. |
| `ui/logo_en`, `ui/logo_ru` | 392×198 | 1536×776 | The game logo: "STAR CHASERS" and «ЗВЁЗДНЫЕ ГОНЩИКИ», each in a bold chunky cartoon font with a little rocket swooshing through it. The only assets allowed to contain text. Spell the Russian exactly as given. |

### D. Explore: boulders and craters (group `explore`, new keys; code-drawn ellipses today)

| Key | Shown at | Deliver | Prompt |
|---|---|---|---|
| `explore/rock_moon_1` … `rock_moon_4` | 38–64 wide | 256×192 | A rounded grey moon boulder in the rover's three-quarter view, four distinct shapes. Base on the bottom edge. No shadow. |
| `explore/rock_mars_1` … `rock_mars_4` | 38–64 wide | 256×192 | The same, rusty red-brown Martian rocks with dust on top. |
| `explore/crater_moon_s`, `crater_moon_l` | 90 / 220 wide | 512×320 | A shallow impact crater seen from the three-quarter angle: a raised rim lit top-left, a darker bowl, a soft edge that fades into the ground. |
| `explore/crater_mars_s`, `crater_mars_l` | 90 / 220 wide | 512×320 | The same in Martian red dust. |

---

## Tier 2: worlds and effects

### E. Ground (group `ground`, **seamless on all four edges, full-bleed, no alpha**, 256×256)

| Key | Prompt |
|---|---|
| `ground/ground_moon` | Grey lunar regolith from straight above, tiny craters and pebbles, low contrast so it repeats across a big map without a grid. |
| `ground/ground_mars` | Rusty orange Martian sand with soft wind ripples, low contrast. |
| `ground/ground_mars_rock` | Darker red-brown Martian bedrock with cracks, same palette, so it mixes with `ground_mars` without a checkerboard. |
| `ground/ground_plate`, `ground_plate_worn`, `ground_hazard`, `ground_road` | Home-base floor tiles: a metal deck plate, a scuffed plate, a yellow/black hazard plate, a road segment (direction of travel left → right). |

### F. Home base buildings (group `v2`, same three-quarter view as the rover, base on the bottom edge)

Deliver at about 1.5× today's frame size, keeping the aspect ratio: `tower`
(391×720), `habitat` (615×640), `control` (509×620), `tanks` (520×438), `dish`
(281×380), `airlock` (229×320), `board` (250×420), `crate_a`, `crate_b`,
`crate_c` (~220×210), `pad_mark` (512×512, a top-down launch-pad marking),
`pad_clamp` (131×200, mirror-safe). The look is white modules with orange trim
and cyan windows, matching the rover and landers. Group `atlases` adds
`machines_solar_array`, `machines_generator`, `machines_rocket_launchpad`
(256×~240) and `machines_rover` (256×214), which should be the delivered rover
design in its front-left three-quarter view.

### G. Effects (keys keep their atlas group; transparent; most are tinted or scaled in code, so draw them white-to-colour as noted)

| Key | Deliver | Notes |
|---|---|---|
| `v2/flame_small`, `flame_medium`, `flame_large` | 400×840 | A rocket exhaust flame pointing **down**, hot white core to orange to transparent tip, top edge at the nozzle. |
| `ui/fx_flame_m` | 316×512 | The same, shorter and rounder, for the builder preview. |
| `v2/fx_cloud_s`, `fx_cloud_m`, `fx_cloud_l`, `fx_cloud_xl` | 2× current size | Puffy exhaust/dust clouds, **white with grey shading** (tinted per planet in code). |
| `ui/fx_smoke`, `ui/fx_explosion`, `ui/fx_blast` | 512×470 | Cartoon smoke puff, a comic explosion burst, a ground blast ring. |
| `v2/fx_blast_burst`, `fx_blast_hit`, `fx_blast_ground` | 2× current size | Small impact bursts. |
| `v2/fx_sparkle_s`, `fx_sparkle_m`, `fx_sparkle_l` | 2× current size | A four-point twinkle, white-gold. |

---

## Tier 3: characters (only as complete, consistent sets)

The astronauts walk in four directions with four frames each, plus one idle
frame per direction. Frame canvas is **202×256** (today 101×128) with the feet
on the bottom edge. They are shown about 180 px tall.

| Set | Keys | Notes |
|---|---|---|
| Female astronaut | `atlases/astro_female_{front,back,side_right,side_left}` (idle) + `atlases/astro_female_walk_{front,back,side_right,side_left}_{0..3}` | White suit with orange trim, glass helmet showing a friendly face, small backpack. Same character and scale in all 20 frames; a smooth 4-frame walk loop. |
| Male astronaut | the same keys with `astro_male_` | The same suit; a different face and hair. |
| Crew helpers | `v2/minion_{mechanic,driller,radio,chemist}_{front,back,left,right}_{0..3}` (the chemist has 0..5) + `v2/minion_idle_*` | Small round yellow helpers: mechanic (wrench, goggles), driller (helmet lamp, drill), radio scout (headset, antenna, handheld radio), chemist (flask, goggles). Today's frames are ~192 px; deliver at 384 px with the same frame counts. |
| Hub/explore minion stills | `atlases/minions_mechanic`, `minions_miner_driller`, `minions_radio_scout`, `minions_chemist` | One standing pose each, 224 px wide (today 112). |
| Map icons | `atlases/resources_{iron_ore,purple_crystal,ice_cube_bug,magma_rock,bone_shell,gold_nugget}`, `atlases/tools_v2_power_drill` | 128×128 icons, same style as the delivered sample icons. |

## Skip (not used by the game)

Don't spend effort on these frames, which nothing in the code draws:
- **`ui`:** `bar_*`, `booster_stack`, `domed_capsule`, `engine_cluster`,
  `fins_gold`, `fx_flame_s`, `fx_flame_streak`, `fx_flame_xs`, `fx_smoke_puff`,
  `fx_smoke_trail`, `ico_home`, `ico_trash`, `ico_x4`, `nose_blue`,
  `satellite`, `tank_ring`, `tank_side`.
- **`v2`:** `astro_point`.
- **`machines`:** `workbench`, `fabricator`.
- **`resources`:** `alien_vine`, `ewaste_battery`, `glow_mushroom`,
  `green_fuel_canister`, `green_slime`, `scrap_metal`.
- **`terrain` and `terrain_v2`:** `alien_jungle`, `ice_bug`, `lava_*`,
  `sand_bones`, `sand_skull`, `grass`.
- **`tools_v2`:** everything except `power_drill`.
- **`maps/world_map`:** shown only when the menu and result backdrops fail to load.

Already delivered and good, so leave them unless restyling them for
consistency: `public/assets/rover/*`, `public/assets/planets/sample_*` and
`lander_*`.

## QA checklist (send it back filled in)

- [ ] Every file in `manifest.json` exists; no file is missing from it.
- [ ] Every key matches a table row exactly.
- [ ] The rocket parts stack with no gap or step: a QA sheet shows nose, probe,
      tank_l, decoupler, tank_m, engine_bull and bell stacked at 40 px wide.
- [ ] Tiles repeat 3×3 with no visible seam.
- [ ] Alpha edges are clean on dark and light backgrounds.
- [ ] No text in any asset except `ui/logo_en` and `ui/logo_ru`.
- [ ] Walk sets are complete and consistent, or left out entirely.
- [ ] Anything skipped or changed is listed in `REQUEST.md` with the reason.

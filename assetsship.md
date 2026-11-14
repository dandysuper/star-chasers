# Ship interior: gameplay design + art prompts

> **Status:** design and asset requests only. Nothing here is wired into the code yet.
> Generate the art with the Grok bot (`trigger_grok_bot`), one prompt per message,
> and drop the results into `v2_src/ship/` for the cutter.

---

## Part 1. The game design

### The idea

Flights to the Moon and Mars take days. Today the player either sits through the
coast or warps through it. In the new mode, the player **goes inside the rocket**
during the coast. They walk the ship top-down, like in the Hub or in Among Us,
with the yellow crew. Things break, alarms go off, and the player runs to the
right room and fixes the problem with a short puzzle. Every puzzle teaches one
real piece of spaceflight.

### When it happens

- The rocket reaches a stable coast, for example on a transfer to the Moon or Mars
  with the engine off. A big button appears: **«Внутрь корабля / Go inside»**.
- Inside, the trip has a clock: *"Moon arrival in 3 days"*. One real minute is
  about half a day. A typical Moon trip lasts 4–6 minutes and a Mars trip lasts
  8–10 minutes. You can leave at any time with **«К иллюминатору / To the window»**.
- When the clock runs out, the ship arrives. Breakdowns you didn't fix cost
  something on arrival, for example less fuel to land with, a lost star or a
  harder landing. There is never a hard game over.

### The ship map (one screen and a bit, the camera follows the player)

```
            ┌──────────────┐
            │   COCKPIT    │  navigation, comms
            └──────┬───────┘
   ┌────────┐ ┌────┴─────┐ ┌──────────┐
   │ GREEN- │─│  CENTRAL │─│  LAB     │  samples, microscope
   │ HOUSE  │ │  HUB     │ │          │
   └────────┘ └────┬─────┘ └──────────┘
   ┌────────┐ ┌────┴─────┐ ┌──────────┐
   │ LIFE   │─│ CREW     │─│ STORAGE  │  spare parts, crates
   │ SUPPORT│ │ QUARTERS │ │ / AIRLOCK│  spacewalk door
   └────────┘ └────┬─────┘ └──────────┘
            ┌──────┴───────┐
            │ ENGINE ROOM  │  reactor, fuel valves, gyros
            └──────────────┘
```

Eight rooms joined by short corridors. The view is the same 3/4 top-down
as the Hub, and the ship is round-cornered, cozy and full of pipes and blinking lights.

### The breakdown loop (the "Among Us" part)

1. Every 40–70 seconds a **breakdown** starts: a red alarm, a siren, a red arrow
   at the edge of the screen and a line in the task list. Example: *"⚠ O₂ is falling. Life Support."*
2. The player runs there. The broken station sparks, smokes or blinks red.
3. Press `E` or tap the station to open a puzzle panel over the game. Solve it,
   and the station turns green, the crew cheers and a fun fact pops up.
4. Some breakdowns are **urgent** and have a 60-second bar (oxygen, hull leak).
   Others are **slow** and only cost something on arrival (dirty filters, plants).
5. The yellow crew run around too. They sometimes "help" in the wrong room, panic
   during alarms and hold a ladder for you during the spacewalk.

### Breakdowns: station puzzles (main tasks)

Each puzzle takes 15–45 seconds, works with both a mouse and a finger, and has a
**"What happened?"** line in kid language plus a real fact afterwards.

| # | Room | Breakdown | Puzzle mechanic | The real fact it teaches |
|---|---|---|---|---|
| 1 | Life Support | **O₂ is falling** (urgent) | Drag the CO₂ scrubber cartridges out, swap in fresh ones, then turn the O₂ valve so the gauge needle stops in the green band. | The ISS splits water into oxygen and hydrogen; CO₂ is scrubbed out of the air. |
| 2 | Engine Room | **Fuel line pressure** | A pipe maze: rotate pipe tiles so fuel flows from the tank to the engine without passing a leak. | Rocket engines need fuel *and* oxidiser; in space there is no air to burn. |
| 3 | Engine Room | **Gyroscope wobble** | Three spinning wheels. Tap at the right moment to sync each one with a target ring (rhythm timing). | Spacecraft turn with spinning reaction wheels, no wings needed. |
| 4 | Cockpit | **Lost course** | Star alignment: drag the sextant crosshair onto three named guide stars in a small star map. | Spacecraft find their direction with star trackers. |
| 5 | Cockpit | **Comms down** | Turn the dish dial until a wavy signal line matches the target wave (frequency + amplitude sliders). | Radio from Mars takes 4 to 24 minutes to reach Earth. |
| 6 | Central Hub | **Power failure** (lights go dark, the player sees only a small circle) | A wire puzzle: connect coloured wires to matching sockets; one wire is hidden behind a panel you must unscrew first. | Solar panels make less power the farther you are from the Sun. |
| 7 | Storage / Airlock | **Hull hit by a micrometeorite** (urgent) | A short spacewalk: put on the suit, float along the outside rail (hold to move, release to grab), then slap a patch over the hole by tracing its outline. | Tiny space dust hits at 10 km/s, faster than a bullet; the ISS has bumpers called Whipple shields. |
| 8 | Outside (from Airlock) | **Solar panel stuck** | Rotate the panel until the "sunlight" meter is full; the Sun moves slowly, so it has to be readjusted. | Panels face the Sun, and power falls when they are angled away. |
| 9 | Greenhouse | **Plants wilting** | Set the water, light and temperature sliders; plants show happy/sad faces live. | Astronauts grew lettuce and chili peppers on the ISS. |
| 10 | Life Support | **Water recycler clogged** | Sort the floating blobs: drag dirty water into the filter, clean water into the tank, avoid mixing. | On the ISS about 98% of water is recycled, sweat and urine included. |
| 11 | Lab | **Sample freezer warming** | A memory/match game: match the sample labels to the right shelf before the temperature bar reaches red. | Moon and Mars samples are kept cold and clean so Earth germs do not get on them. |
| 12 | Crew Quarters | **Floating mess** (zero-g mode) | Gravity is off for a while: catch floating objects (a sock, a spoon, a sandwich, a minion) and push them into the right storage net. | In zero-g everything floats, so everything is strapped or velcroed down. |

### Side quests (no alarms; done for fun, stars and stickers)

Short optional jobs that the crew give you. A small "!" bubble above a minion
marks one.

| Quest | Giver | What you do | Reward |
|---|---|---|---|
| **Space lunch** | Chemist FIZZ | Pick the right packet order (rehydrate, then heat, then eat) and feed 3 crew members in the galley. A wrong packet makes a crumb cloud that has to be vacuumed. | sticker "Космоповар / Space Chef" |
| **Lost wrench** | Mechanic | The wrench floated away during the last breakdown. Follow clinking sounds and a faint shine through the rooms. | a faster repair speed |
| **Hydroponic tomato** | Greenhouse minion | Grow one tomato: come back 3 times during the trip to water it. At arrival you get a giant tomato. | sticker + fun fact |
| **Exercise time** | Any minion | A treadmill rhythm mini-game: tap left and right in time. | "Strong bones" badge (astronauts exercise 2 h a day) |
| **Photo of Earth** | Radio minion | Go to the cupola window and take a photo when Earth lines up in the frame. | the photo goes to the Sample Lab gallery |
| **Hide and seek** | The youngest minion | Find 5 minions hiding in lockers, under pipes and inside the toilet. | a giggle and a sticker |
| **Space toilet** | — | A comedic tutorial: set the suction switch, buckle the leg straps, press flush. If you get it wrong, a cloud of droplets floats out. | "Gross but true" fact card |
| **Message home** | Radio minion | Record a message, then wait for it: a bar shows the light delay to Earth. | lets the player feel the delay |
| **Sleep shift** | — | Help 3 minions into their wall-mounted sleeping bags and turn the lights to night mode. | the trip clock jumps forward |

### What breakdowns cost on arrival (soft fail)

| Not fixed | On arrival |
|---|---|
| O₂ / hull leak | the crew are tired, so the walk on the surface has 20% less time |
| Fuel line | 10% less fuel for the landing |
| Lost course | the landing spot is off, a longer walk to the samples |
| Comms down | no bonus star for "beam the data home" |
| Plants / water / freezer | no penalty, just a sad face and no sticker |

### Controls

The same as the Hub: WASD, the arrows or the thumbstick to walk, and `E`, a tap or
the action button to use. Esc opens the in-game menu. Every puzzle panel has big
handles (min 56 px) and a **"?" hint** button that shows what to do in one sentence.

---

## Part 2. Art prompts for the Grok bot

### How to generate

1. Send **one prompt per message** to `trigger_grok_bot`. Start each message with
   the **shared style block** below, then the item's prompt.
2. Generate the **reference items first** (`ship_tile_floor`, `ship_station_o2`)
   and attach them to later prompts: *"same style, palette and outline as the attached image"*.
3. Grok does not produce a transparent background. Ask for a **plain flat light
   grey studio background**. `tools/cut-v2.mjs` keys it out like the other v2
   drops. Exceptions: **floor/wall tiles are full-bleed**, and **glow/spark FX are on pure black**
   (they are drawn with ADD blending, as `fx_flames_sheet.png` is).
4. Save the raw files to `v2_src/ship/<file>.png`, never directly into `public/`.

### Shared style block (paste at the start of every prompt)

```
2D cartoon game asset for a kids' space adventure game, Crashlands-like style.
Thick dark-navy outline (#1d1b2e), bold saturated flat colours with soft cel
shading, light from the top-left. Three-quarter top-down camera (looking down
at about 45 degrees), the same view as a cozy top-down RPG. Spaceship interior
palette: off-white and light-grey panels, orange trim (#ff8a2a), teal-cyan
screens and glows (#3fe0d0), dark-grey pipes, small red and green status
lights. Chunky, rounded, friendly shapes, cute and slightly messy, no sharp sci-fi
grit. Single object centred, plain flat light-grey studio background
(#d9d9e0), no text, no letters, no logos, no watermark, no cast shadow on the
background.
```

The **ship design** for every room (add to all room/prop prompts):
*a cozy, round-cornered rocket interior, padded white wall panels with rivets, orange
handrails everywhere (for zero gravity), velcro patches, bundles of cables
zip-tied to the walls, little round portholes showing stars.*

---

### A. Floors, walls and doors (tiles, full-bleed, 512×512, seamless)

Tiles are full-bleed and **must repeat seamlessly** (left edge continues into the
right edge, top into bottom). Seen **straight from above** for floors.

| File | Prompt (after the shared style; replace the last line with "full-bleed seamless tile, fills the whole canvas, no background") |
|---|---|
| `ship_tile_floor` | Metal deck floor plates seen straight from above: light-grey square panels with rounded corners, small rivets in the corners, a thin orange anti-slip stripe, soft scuffs. **Reference tile, generate first.** |
| `ship_tile_floor_grate` | Corridor floor: dark metal grating seen from above with dim teal light and pipes visible underneath. |
| `ship_tile_floor_engine` | Engine-room floor: darker steel plates with yellow-black hazard edges and oil stains. |
| `ship_tile_floor_green` | Greenhouse floor: white panels with a green rubber mat and a few spilled soil crumbs. |
| `ship_wall_straight` | A straight interior wall segment in the 3/4 view, 512×256: padded off-white panels, an orange handrail at waist height, a cable bundle along the top. Must tile left-right. |
| `ship_wall_corner` | The inner rounded corner piece matching `ship_wall_straight`. |
| `ship_door_closed` / `ship_door_open` | A round-cornered sliding bulkhead door in the 3/4 view, orange frame, small green lamp (open) / red lamp (closed). Two images of the **same** door. |
| `ship_door_locked` | The same door with a red X hazard light and a dangling broken wire (used during power failure). |

### B. Stations (interactive consoles; each in 2 states, ~512 px)

Every station needs a **normal** and a **broken** version of the *same* object, and
the same framing in both. Generate the normal one first, then attach it and say
*"exactly the same object, now broken: …"*.

| File (normal / broken) | Room | Prompt |
|---|---|---|
| `ship_station_o2` / `_broken` | Life Support | **Reference station.** A chunky oxygen generator: a tall white tank with a round pressure gauge, two cartridge slots on the front, a big valve wheel, teal bubbling glass tube. *Broken:* the gauge needle in the red, the glass tube empty, a puff of grey smoke, a blinking red lamp. |
| `ship_station_water` / `_broken` | Life Support | A water recycler: a round glass drum with swirling blue water, filters and tubes. *Broken:* brown murky water, a clogged pipe bulging, drips floating upward. |
| `ship_station_fuel` / `_broken` | Engine Room | A fuel valve panel: three colourful pipes (orange fuel, blue oxidiser, grey) meeting at a valve block with dials. *Broken:* one pipe cracked and spraying a cartoon jet of vapour, a dial spinning. |
| `ship_station_gyro` / `_broken` | Engine Room | A gyroscope cabinet with a glass front showing three spinning wheels on gimbals. *Broken:* wheels tilted at wrong angles, wobble lines, small sparks. |
| `ship_reactor` | Engine Room | A big round power core in the middle of the engine room (~768 px): glowing teal heart behind a cage, cables radiating out. A decoration, no broken state. |
| `ship_station_nav` / `_broken` | Cockpit | A pilot console: two chairs facing a curved window, a round star-map screen, a joystick. *Broken:* the star-map screen shows static and a big "?" shape (a symbol, not text), red lights. |
| `ship_station_comms` / `_broken` | Cockpit | A radio desk with a big tuning dial, a microphone on a bendy arm and a little dish model. *Broken:* the screen shows a flat line, the antenna model bent. |
| `ship_station_power` / `_broken` | Central Hub | A fuse/wire box on the wall with its door open, coloured wires and sockets. *Broken:* wires unplugged and dangling, sparks, the box dark. |
| `ship_station_airlock` / `_broken` | Storage | A round airlock hatch with a big wheel handle and a window. *Broken:* a red flashing warning beacon and frost on the window. |
| `ship_station_greenhouse` / `_broken` | Greenhouse | A hydroponic rack with three shelves of lettuce, tomatoes and peppers under purple-pink grow lights. *Broken:* plants drooping with sad wilted leaves, lights off, dry tubes. |
| `ship_station_freezer` / `_broken` | Lab | A sample freezer with a glass door and labelled-looking (no text) sample jars glowing softly. *Broken:* the door open, fog pouring out, a thermometer in the red. |
| `ship_station_microscope` | Lab | A microscope bench with sample trays and a screen. Decoration plus a side-quest spot, no broken state. |

### C. Room props (decoration, ~256–512 px)

Group them as a **sheet**: 6–9 objects in a loose grid with gaps of at least 60 px
between them, like `base_crates_sheet.png`. The cutter separates them.

| Sheet file | Objects |
|---|---|
| `ship_props_quarters` | wall-mounted sleeping bag (zipped, empty), sleeping bag with a sleeping minion, a small floating pillow, a locker (closed), a locker (open, socks floating out), a tiny treadmill with straps, a space toilet (funny, clean, with a suction hose and leg straps) |
| `ship_props_galley` | a galley wall with food packets on velcro, a water dispenser, a small food warmer, a floating tortilla, a floating sandwich, a juice pouch with straw, a crumb cloud |
| `ship_props_storage` | stacked white cargo bags with straps, an orange tool chest, a spare-parts crate, a coiled tether rope, a fire extinguisher, a first-aid box, a spacesuit hanging on a wall rack |
| `ship_props_lab` | a test-tube rack, a glovebox with two rubber gloves, rock samples in clear bags, a small rover model, a beaker with bubbling green goo |
| `ship_props_green` | a tomato plant in a pouch, a lettuce pillow, a watering bottle, a seed tray, a grow light, a ladybug robot |
| `ship_props_generic` | a round porthole with stars (wall item), a cupola window with Earth visible, cable bundles, a pipe junction, a handrail piece, a fan vent, a blinking control panel, a notice board with pinned drawings (pictures only, no text) |

### D. Outside the ship (for the spacewalk, ~512–1024 px)

| File | Prompt |
|---|---|
| `ship_hull_outside` | The outside of the same rocket, side view, a long white hull section with orange trim, handrails along it, rivets, a few panels; space background deep navy with stars. Full-bleed 1920×720, **tiles left-right**. |
| `ship_hull_hole` | A small round puncture in the hull panel: torn metal petals, a tiny jet of white air puffing out. Studio background. |
| `ship_hull_patch` | An orange round patch with tape edges (the fixed state). Studio background. |
| `ship_solar_panel` | A wide deployable solar panel wing on an arm: dark-blue cells in a grid, gold frame. Studio background. |
| `ship_window_view_moon` / `_mars` / `_earth` | What the cupola window shows: a big glowing planet against stars (cratered grey Moon / rust-red Mars / blue-green Earth with clouds). Full-bleed 1280×720, painted backdrop like `bg/flight_moon.webp`. |

### E. The crew inside the ship (sprite sheets)

Use the existing crew art as the reference: attach `v2_src/minion_walk_mechanic.png`
and say *"same characters, same proportions, same outline"*.

| File | Layout | Prompt |
|---|---|---|
| `minion_float_sheet` | 4 columns × 1 row | A yellow crew minion **floating in zero gravity**: arms out and legs dangling, slowly tumbling. Four frames of a gentle spin loop. |
| `minion_panic_sheet` | 4 × 1 | A minion panicking during an alarm: running in place with arms waving, sweat drops, eyes wide. Four-frame loop. |
| `minion_fix_sheet` | 4 × 1 | A minion hammering and screwing at a wall panel with a wrench, sparks. Four-frame loop. |
| `minion_cheer_ship` | 3 × 1 | A minion jumping and cheering with a wrench raised high, confetti. |
| `astro_suit_eva_sheet` | 4 columns × 4 rows (front, left, right, back) | The player astronaut in a **puffy spacewalk suit** with a jetpack backpack and a tether. Walk cycle. Same row order as the crew sheets: front, left, right, back. |
| `astro_float_sheet` | 4 × 1 | The player astronaut floating in zero-g inside the ship, swimming motion. |

### F. Alarms and effects (on **pure black** `#000000` background, ADD blend)

| File | Prompt |
|---|---|
| `fx_alarm_light` | A rotating red alarm beacon glow, a soft round red flare with light rays. Pure black background. |
| `fx_spark_burst` | A sheet of 5 small electric spark bursts, yellow-white with cyan edges, different sizes. Pure black background. |
| `fx_steam_puff` | A sheet of 4 white steam / smoke puffs in cartoon round-bubble style, from small to large. Plain light-grey studio background (keyed, not ADD). |
| `fx_water_blobs` | A sheet of 6 floating water droplets in zero-g: wobbly blue spheres with a white highlight, different sizes. Studio background. |
| `fx_fixed_sparkle` | A green-gold "fixed!" sparkle burst with little stars. Pure black background. |
| `fx_dark_vignette` | A full-bleed 1280×720 black image with a soft round transparent-looking hole in the centre (white centre fading to black), used for the power-failure flashlight. Pure greyscale, no colours. |

### G. Puzzle panels (UI, front view, not 3/4)

The puzzles open as panels over the game. Use the same look as `ui_dialog.png`:
a chunky rounded console frame. **Front-facing, flat, no 3/4 view.**

| File | Prompt |
|---|---|
| `ui_puzzle_frame` | An empty chunky console screen frame, 1280×800: a dark-navy screen area with a subtle grid, a thick off-white bezel with orange corners, four big screws, two small blinking lamps. The centre is empty. **Reference UI, generate first.** |
| `ui_pipe_tiles` | A sheet of pipe tiles for a rotate-the-pipes puzzle, each 128×128 on the same grid: straight, corner, T-junction, cross, a cracked leaking pipe, a start valve, an end nozzle. Chunky orange pipes on a dark-navy tile. 7 tiles in a row with gaps. |
| `ui_wire_set` | A sheet of 5 wire ends with plugs (red, blue, yellow, green, purple) and 5 matching round sockets. Chunky cables. Gaps between objects. |
| `ui_gauge` | A big round pressure gauge, front view: white dial, red / yellow / green bands, separate needle drawn next to it (so the game can rotate it). |
| `ui_valve_wheel` | A big red valve wheel, front view, with a separate centre cap. |
| `ui_slider_set` | A UI slider track and a chunky knob, plus three icons drawn as pictures: a water drop, a sun, a thermometer. |
| `ui_star_map` | A round star-map screen, front view: dark navy with a few bright stars and faint constellation lines, a crosshair drawn separately next to it. |
| `ui_signal_screen` | An oscilloscope screen, front view, empty dark-green grid (the game draws the wave). |
| `ui_scrubber_cartridge` | Two versions of a CO₂ scrubber cartridge side by side: a clean white-and-teal one and a used brown-grey one. |
| `ui_sample_jars` | A sheet of 6 sample jars with different coloured rocks inside (grey, red, gold, blue ice, white salt, black basalt). |

### H. Icons and HUD (128×128, front view)

One sheet, 4 columns × 3 rows, 60 px gaps: `ui_ship_icons`.

| Icon | Picture |
|---|---|
| `ico_task_o2` | a blue O₂ bubble (the bubble shape only, no letters) |
| `ico_task_fuel` | a fuel drop with a flame |
| `ico_task_power` | a lightning bolt |
| `ico_task_nav` | a compass star |
| `ico_task_comms` | a radio dish with waves |
| `ico_task_hull` | a hull plate with a crack |
| `ico_task_plant` | a sprout in a pouch |
| `ico_task_water` | a water drop with a circular arrow |
| `ico_task_freezer` | a snowflake on a jar |
| `ico_alarm` | a red triangle with an exclamation-mark shape |
| `ico_go_inside` | a rocket with a door/hatch opening |
| `ico_trip_clock` | a clock with a small planet next to it |

### I. Sound effects (for a sound-effect generator, `.mp3`, mono, 44.1 kHz)

The music is in `musicinship.md`. These are the one-shot sounds the ship needs.

| File | Length | Prompt |
|---|---|---|
| `ship_alarm_loop` | 2 s, seamless loop | A cartoon spaceship alarm, a soft two-tone "woo-wee" siren, urgent but not scary, kid-friendly. |
| `ship_fixed` | 1 s | A happy repair-complete chime: a quick rising three-note arpeggio with a sparkle. |
| `ship_door` | 0.5 s | A sci-fi sliding door, a soft pneumatic "shhk". |
| `ship_spark` | 0.4 s | A small electric zap, crackly and comedic. |
| `ship_leak_hiss` | 2 s, loop | Air escaping through a small hole, a thin steady hiss. |
| `ship_valve_turn` | 0.6 s | A heavy metal valve wheel squeaking a quarter turn. |
| `ship_pipe_rotate` | 0.2 s | A chunky plastic click, a pipe tile snapping into place. |
| `ship_wire_plug` | 0.2 s | A satisfying plug pushed into a socket, "thunk-click". |
| `ship_puzzle_fail` | 0.5 s | A comedic "bonk" buzz, gentle, not punishing. |
| `ship_hum_room` | 4 s, loop | A quiet ship room tone: a low air-fan hum with a faint electronic beep every few seconds. |
| `ship_footstep_metal` | 4 short variations | Light footsteps on a metal deck, soft and springy. |
| `ship_float_whoosh` | 0.6 s | A soft whoosh when gravity turns off and things float up. |

---

## Part 3. Where it plugs in (for the engineers)

- New scene `ShipScene` (top-down, reuses `walker.ts`, `crew.ts`, the touch pad,
  and the `InGameMenu`). Entered from `FlightScene` during the coast, and returns
  to it with the same sim state.
- `src/data/shipTasks.ts`: the breakdown list (id, room, urgent, timer, puzzle id,
  penalty, fact key). Puzzles are small self-contained panel classes in
  `src/ui/puzzles/`, and the solve rules are pure functions so they can be unit-tested.
- `src/data/shipMap.ts`: rooms, door links and station positions, as plain data.
- Art lands through `tools/cut-v2.mjs` into the v2 atlas (`ship_*` frames). Every
  frame is optional and falls back to drawn shapes, like the rest of the game.
- Every string goes into `en.json` / `ru.json` under `ship.*`.

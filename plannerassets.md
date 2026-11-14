# Requested assets: Mission Control (launch planner)

> **Status:** requests only. Mission Control works today with drawn art: the
> Moon is drawn in code, the cards and panels reuse the UI atlas, and the
> backdrop is `bg/flight_space`. Each file below replaces a drawn piece. The
> wiring is described at the end, and nothing breaks while a file is missing.
>
> The design is in `NASA_GAMEPLAY.md`. Generate images with the Grok bot, one
> prompt per message, and save the raw files in `v2_src/planner/`.

## Shared style (paste at the start of every image prompt)

```
2D cartoon game asset for a kids' space adventure game, Crashlands-like style.
Thick dark-navy outline (#1d1b2e), bold saturated flat colours with soft cel
shading, light from the top-left. Friendly, chunky, rounded shapes. Mission
control palette: deep navy (#0b0b2a), teal screens (#3fe0d0), orange trim
(#ff8a2a), warm yellow highlights (#ffd23f). Single object centred, plain flat
light-grey studio background (#d9d9e0), no text, no letters, no numbers, no
logos, no watermark.
```

## 1. Backdrop (1 file, 1280×720, full-bleed)

| File | Prompt |
|---|---|
| `bg_mission_control` | Painted backdrop of a cozy cartoon mission-control room seen from the back rows: curved rows of desks with glowing teal screens, a giant wall screen at the front showing a starry sky with a big Earth and a small Moon joined by a dashed curved path, a small rocket icon on the path, yellow minion crew sitting at desks. The middle of the image must stay calm and dark (UI panels go on top). **Full-bleed, no studio background, no text.** |

## 2. Moon phases (8 files, 256×256, transparent after keying)

Generate `moon_full` first, then attach it to the other seven prompts with
*"the same Moon, same craters, same size and outline"*. The game shows them at
124 px (the main Moon) and 26 px (day cards), so keep the craters bold.

| File | Lit part (as seen from the northern hemisphere) |
|---|---|
| `moon_new` | Almost all dark, a faint dark-blue disc with a thin rim light |
| `moon_waxing_crescent` | A thin crescent lit on the **right** |
| `moon_first_quarter` | The **right** half lit |
| `moon_waxing_gibbous` | Lit except a thin dark crescent on the **left** |
| `moon_full` | Fully lit, a cream-white Moon with soft grey craters (Tycho, Copernicus, the dark maria). **Reference, generate first.** |
| `moon_waning_gibbous` | Lit except a thin dark crescent on the **right** |
| `moon_last_quarter` | The **left** half lit |
| `moon_waning_crescent` | A thin crescent lit on the **left** |

The prompt for each: *"The Moon as a cartoon game icon, round disc with chunky
craters, {lit part}. The dark part is deep navy with a slight blue rim, not
transparent."*

## 3. Weather and verdict icons (one sheet `ui_weather_icons`, 4 × 3 grid, 60 px gaps, each 128×128)

| Icon | Picture |
|---|---|
| `ico_wx_sun` | a smiling round sun |
| `ico_wx_cloud` | a puffy cloud |
| `ico_wx_cloud_sun` | a cloud with the sun peeking out |
| `ico_wx_rain` | a cloud with three raindrops |
| `ico_wx_storm` | a dark cloud with a yellow lightning bolt |
| `ico_wx_wind` | three curly wind lines |
| `ico_wx_cold` | a snowflake with a thermometer |
| `ico_wx_hot` | a thermometer with a red bulb |
| `ico_go` | a big green round badge with a white tick (a shape, no letters) |
| `ico_nogo` | a big red octagon badge with a white X (a shape, no letters) |
| `ico_caution` | a yellow triangle with an exclamation-mark shape |
| `ico_best_day` | a gold star with a small calendar page |

## 4. Launch sites (3 files, 512×320)

Small picture cards shown on the site button, in the 3/4 view of the base art.

| File | Prompt |
|---|---|
| `site_ksc` | A big cartoon launch pad by the ocean, a tall orange-and-white rocket on a grey tower, palm trees, a huge boxy assembly building in the distance, sunny Florida sky. |
| `site_baikonur` | A cartoon launch pad on a flat golden steppe, a slim white Soyuz-style rocket with four strap-on boosters held by tilted gantry arms, a few camels far away, a wide pale sky. |
| `site_vostochny` | A cartoon launch pad among dark-green taiga forest with low hills, a white rocket on a modern grey tower, light snow on the ground, a crisp blue sky. |

## 5. Artemis II card (2 files)

| File | Size | Prompt |
|---|---|---|
| `artemis2_card` | 640×360 | A cartoon poster scene: a tall orange-and-white SLS-style rocket lifting off at dusk from a Florida pad, a bright full Moon in the sky (the real launch was on a full Moon), four tiny astronaut silhouettes in the corner. No text, no logos, no flags. |
| `artemis2_badge` | 256×256 | A round mission sticker: a small capsule looping around the Moon on a dotted figure-eight path back to Earth. No text. |

## 6. Trajectory pieces (for next step 1 in `NASA_GAMEPLAY.md`, transparent)

| File | Size | Prompt |
|---|---|---|
| `traj_earth` | 256×256 | A cartoon Earth, blue oceans and green-brown continents, white cloud swirls, seen from space. |
| `traj_moon_small` | 128×128 | The same style Moon as `moon_full`, smaller and simpler. |
| `traj_mars` | 256×256 | A cartoon Mars, rust-red with darker patches, white polar caps. |
| `traj_ship_icon` | 96×96 | A tiny chunky capsule icon with a little flame, for a moving marker along a path. |

## 7. Sounds (`.mp3`, mono, 44.1 kHz, peaks around −3 dBFS)

| File | Length | When | Prompt |
|---|---|---|---|
| `ui_day_select` | 0.15 s | tapping a day card | A soft, clean UI tick, like a plastic switch. |
| `ui_go` | 0.8 s | selecting a GO day / launching | A bright two-note "ding-ding" confirm chime. |
| `ui_nogo` | 0.6 s | a NO GO day / a blocked launch | A gentle low "bonk-bonk" buzzer, comedic, not harsh. |
| `mc_room_tone` | 6 s, seamless loop | ambience in Mission Control, under the music | A quiet mission-control room: soft computer hum, distant keyboard taps, the occasional faint beep, far-away muffled radio chatter with no words. |
| `mc_countdown` | 6 s | after **Launch on this day** | A short countdown: five soft beeps getting higher, then a "whoosh" swell. No voice. |
| `mc_radio_go` | 1.5 s | the flight director says GO | A crackly radio squelch, a short cheerful synth blip, and another squelch, with no words (the game shows the text). |
| `wx_wind_gust` | 1.5 s | pad wind in flight while wind > 10 m/s | A gust of wind whooshing past a metal tower. |
| `wx_thunder` | 2 s | a storm day is selected | A distant soft rumble of thunder, kid-friendly. |

## 8. Music (optional)

One extra looping bed. Use the shared identity block from `musicinship.md` so it
matches the other tracks.

| File | Length | Prompt |
|---|---|---|
| `planner_theme.mp3` | 60–90 s, seamless loop, 96 BPM | *(shared identity block)* Focused, hopeful "planning a mission" music: soft synth arpeggios ticking like a clock, warm pads, a gentle kick, the ship motif played once on a glockenspiel like a radio call-sign. Calm and thoughtful, room for UI sounds. |

## Wiring (for the engineers)

- Images go through `tools/cut-v2.mjs` into the v2 atlas. Check for each frame
  with `hasV2()` in `PlannerScene` and fall back to the current drawn art.
  `drawMoonPhase` stays as the fallback for the Moon icons.
- `bg_mission_control` loads like the other backdrops (`BG`, `BG_FILES` in
  `src/ui/theme.ts`).
- Sounds load lazily when Mission Control first opens. A missing file is
  skipped silently.
- `planner_theme` gets a `TrackId` in `src/core/themeTracks.ts`.

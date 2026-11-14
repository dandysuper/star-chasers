# Requested assets: the sample lab (Moon and Mars sample puzzles)

> **Status:** the lab works today with drawn art. The spectrum, the camera
> view, the slider and the grain patterns are all drawn in code
> (`src/scenes/LabScene.ts`). Each file below replaces a drawn piece. The game
> keeps running while any of them is missing.
>
> Generate images with the Grok bot, one prompt per message, and save the raw
> files in `v2_src/lab/`. The science behind each sample is in
> `src/data/labSamples.ts`.

## How the lab plays (what the art must show)

1. **Laser spectrometer** (like SuperCam on Perseverance and ChemCam on
   Curiosity). A laser zaps the rock and the spark's light becomes a spectrum
   with peaks. The player switches on element markers (H, O, Na, Cl, Ca, Mg,
   Si, Fe, Al, Ti) until every peak turns green, then picks the mineral by
   its formula.
2. **Close-up camera** (like WATSON and MAHLI). A blurry round view of the
   rock. The player drags a focus slider until it is sharp, then reads the
   texture: **bubbles mean lava, round grains or layers mean water,
   six-sided crystals mean ice, sharp shards mean an impact.**
3. **Lab report.** The mineral, its formula, how it formed and a real NASA
   finding.

The first visit is a 7-step tutorial on one easy sample (Mars: hematite
Fe₂O₃; Moon: water ice H₂O). After that comes a 150-second challenge with
3 random samples and 1 to 3 stars.

## Shared style (paste at the start of every image prompt)

```
2D cartoon game asset for a kids' space science game, Crashlands-like style.
Thick dark-navy outline (#1d1b2e), bold saturated flat colours with soft cel
shading, light from the top-left. Friendly, chunky, rounded shapes. Lab
palette: deep navy (#0b0b2a), teal screens (#3fe0d0), orange trim (#ff8a2a),
warm yellow (#ffd23f). Single object centred, plain flat light-grey studio
background (#d9d9e0), no text, no letters, no numbers, no logos, no watermark.
```

## 1. Backdrop (1 file, 1280×720, full-bleed)

| File | Prompt |
|---|---|
| `bg_lab` | Painted backdrop of a cozy cartoon geology lab inside a space base: white rounded walls, a glovebox with two rubber gloves, shelves of sample bags with coloured rocks, a big spectrometer machine with a laser arm, a microscope bench, a round window showing either the grey Moon or red Mars. One yellow minion in a lab coat and goggles in the corner. The middle and right of the image must stay calm and dark (panels go on top). **Full-bleed, no studio background, no text.** |

## 2. Instrument frames (UI, front view, flat, not 3/4)

| File | Size | Prompt |
|---|---|---|
| `lab_spectro_frame` | 780×420 | **Reference UI, generate first.** An empty chunky screen frame for a laser spectrometer: a wide dark-navy screen with a faint grid, a thick off-white bezel with orange corners, a small laser emitter on the top-left corner with a red lens, two blinking lamps. The screen centre is empty (the game draws the graph). |
| `lab_camera_ring` | 400×400 | The round lens ring of a close-up camera, front view: a thick dark-grey metal ring with knurled edges, small screws and an orange marker notch. The centre is a **transparent-looking hole** (make it plain white; it is keyed out). |
| `lab_focus_slider` | 80×380 | A vertical focus slider: a rounded teal track with tick marks, and separately next to it a chunky yellow knob with a grip line. |
| `lab_laser_zap` | 256×256, **pure black background** | A cartoon laser beam hitting a rock and making a tiny bright spark: a thin red beam and a white-yellow star-burst plasma with small rainbow-coloured sparkles. Drawn with ADD blending, so black is transparent. |

## 3. Close-up textures (8 files, 512×512, full-bleed, seamless)

What the camera sees when the picture is in focus. They are drawn **full-bleed
and seamless** (the game masks them into the circle), seen straight from above,
in the same cartoon style but with fine detail. Scale reference: the whole tile
is about 3 mm across.

| File | Sample(s) | Prompt |
|---|---|---|
| `tex_vesicles` | Moon mare basalt, Mars basalt | Dark grey volcanic rock surface full of round gas-bubble holes of different sizes, each hole shaded darker inside with a light rim. |
| `tex_layers` | Mars mudstone | Thin flat horizontal layers of reddish-tan and brown mud, very fine grains, a few tiny cracks, like a sliced lake-bottom rock. |
| `tex_spherules` | Mars hematite | Tan sandstone with round dark-blue-grey little balls ("blueberries") sticking out, each with a shiny highlight. |
| `tex_beads` | Moon orange glass | A pile of tiny shiny orange and dark-red glass beads, perfectly round, glinting like candy. |
| `tex_ice` | Moon ice, Mars ice | Pale blue-white six-sided ice crystals packed together, sharp clean edges, a little frost sparkle. |
| `tex_cubes` | Mars salt | Small pinkish-white cube crystals of rock salt stacked at slight angles, flat shiny faces. |
| `tex_laths` | Moon anorthosite | Light grey-white rock full of long interlocking lavender-purple crystal blades (laths) crossing each other. |
| `tex_shards` | Moon ilmenite breccia | Sharp-edged angular rock fragments of grey, black and silver glued together in a darker matrix, like broken glass in concrete. |

## 4. Mineral cards (10 files, 256×256)

Each one is the clean rock specimen the lab report shows. Make them chunky and
readable at 120 px.

| File | Prompt |
|---|---|
| `min_moon_ice` | A frosty chunk of pale blue water ice with a little cold mist. |
| `min_moon_basalt` | A dark grey lava rock with gas-bubble holes. |
| `min_moon_anorthosite` | A pale grey-white rock with sparkling lavender crystal blades (the "Genesis Rock"). |
| `min_moon_ilmenite` | A black, metallic-glinting rock made of sharp glued fragments. |
| `min_moon_orange_glass` | A small heap of shiny orange glass beads (Apollo 17's orange soil). |
| `min_mars_hematite` | A tan rock with round blue-grey "blueberry" balls. |
| `min_mars_mudstone` | A flat reddish slab with thin visible layers. |
| `min_mars_ice` | A chunk of white ice with reddish Martian dust on top. |
| `min_mars_basalt` | A dark rust-tinted lava rock with bubble holes. |
| `min_mars_salt` | A cluster of pinkish-white salt cubes. |

## 5. Element icons (one sheet `lab_elements`, 5 × 2 grid, 60 px gaps, each 128×128)

Round badges. **No letters** (the game writes the symbol on top). Each has its own
colour and a small picture:

| Element | Colour | Picture |
|---|---|---|
| H | red | a tiny bubble of gas |
| O | sky blue | an air swirl |
| Na | yellow | a little salt shaker |
| Cl | green | a swimming-pool wave |
| Ca | pink | a bone |
| Mg | violet | a bright firework spark |
| Si | sand | a grain of sand |
| Fe | orange | a horseshoe magnet |
| Al | silver | a crumpled foil can |
| Ti | mint | a shiny bolt |

## 6. Origin buttons (4 files, 128×128)

| File | Picture |
|---|---|
| `ico_origin_lava` | a cartoon volcano with orange lava |
| `ico_origin_water` | a blue water drop with a little wave |
| `ico_origin_ice` | a white snowflake crystal |
| `ico_origin_impact` | a meteorite with a flame tail hitting the ground |

## 7. Lab minion (sprite sheet `minion_lab_sheet`, 4 × 1)

Attach `v2_src/minion_walk_chemist.png` and say *"same character, same proportions,
same outline"*.

| Frame | Pose |
|---|---|
| 1 | standing in a white lab coat and goggles, holding a rock in tweezers |
| 2 | looking through a microscope |
| 3 | cheering with a test tube raised (correct answer) |
| 4 | scratching its head, puzzled, with a question-mark puff (wrong answer) |

## 8. Sounds (`.mp3`, mono, 44.1 kHz, peaks around −3 dBFS)

| File | Length | When | Prompt |
|---|---|---|---|
| `lab_laser_zap` | 0.4 s | the spectrum appears | A short cartoon laser "pew" followed by a tiny crackle of a spark. |
| `lab_element_on` | 0.15 s | an element marker switches on | A soft high glass "tink". |
| `lab_element_off` | 0.15 s | a marker switches off | The same "tink" but lower and duller. |
| `lab_peaks_done` | 0.8 s | every peak is explained | A rising three-note marimba arpeggio with a sparkle. |
| `lab_focus_loop` | 1 s, seamless loop | while dragging the focus slider | A soft mechanical lens whirr, like a tiny motor turning. |
| `lab_focus_snap` | 0.3 s | the picture becomes sharp | A crisp camera "click" with a little shine sound. |
| `lab_correct` | 0.8 s | a right answer | A happy two-note "ding-ding" with a bubbly pop. |
| `lab_wrong` | 0.5 s | a wrong answer | A gentle comedic "bonk" buzz, not punishing. |
| `lab_challenge_done` | 2 s | the challenge is finished | A short cheerful fanfare on marimba and glockenspiel ending on a ding. |
| `lab_room_tone` | 6 s, seamless loop | ambience in the lab | A quiet lab: soft fan hum, a fridge buzz, the faint bubbling of a beaker. |

## Wiring (for the engineers)

- Images go through `tools/cut-v2.mjs` into the v2 atlas. Textures stay full-bleed,
  like the ground tiles. `drawTexture()` in `LabScene.ts` stays as the
  fallback: if `tex_<texture>` exists, draw it masked into the circle instead,
  and blur it the same way (6 offset copies at low alpha).
- `bg_lab` loads like the other backdrops (`BG` / `BG_FILES` in `src/ui/theme.ts`).
- Sounds load lazily when the lab first opens. A missing file is skipped silently.

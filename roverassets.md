# Requested assets: the drivable rover

> **Status (10 Nov 2026): delivered.** All five directions, both ground marks,
> all four sounds and the `rover_icon` badge are in `public/assets/rover/` and
> listed in its `manifest.json`. Still open: the per-planet variants and the hub
> ROVER BAY under *Nice to have*.
>
> The game still runs without any of these files. Remove an entry from the
> manifest and that piece falls back: the three-quarter `machines_rover` sprite
> mirrored left/right, drawn tyre tracks and boot prints, a 🚙 in place of the
> badge, and no rover sounds.

What the fallback cannot do: the old sprite only faces front-left or (mirrored)
front-right, so a rover driving straight up the screen still shows its front.
The five direction renders below fix that.

## How to drop a file in

1. Save the file to `public/assets/rover/<file>`.
2. List it in `public/assets/rover/manifest.json`:
   ```json
   {
     "images": [ { "key": "rover_e", "file": "rover_e.png" } ],
     "audio":  [ { "key": "rover_motor", "file": "rover_motor.mp3" } ]
   }
   ```
   List only files that exist; the manifest is how the game avoids 404s.
3. Reload. The keys are already wired in `src/core/rover.ts` and `src/ui/surfaceFx.ts`.

## Shared style (prepend to every image prompt)

> Cartoon game asset, thick dark-purple outline (#1d1b2e), bold flat colours
> with soft cel shading, light from the top-left, friendly kids' space-adventure
> style matching a hand-painted 2D mobile game, centred single object,
> **transparent background**, no text, no logos, no ground shadow (the game draws
> its own).

## 1. Rover body, five directions (5 files, 512×512 PNG, transparent)

The game uses these only when **all five** are present. The west-facing views
(south-west, west, north-west) are the east-facing ones mirrored in code, so
keep the design left/right symmetric enough to mirror: no lettering, no
one-sided decals.

Camera for every frame: the same three-quarter top-down view as the astronaut
and the lander (looking down at roughly 45°). Same rover, same scale, same
lighting in all five. The rover fills about 85% of the canvas width, centred;
the game scales each frame to 150 px wide and stands it on its wheels.

**Rover design (use in every prompt):** *a cute chunky six-wheeled planetary
rover with big knobbly balloon tyres on rocker-bogie legs, a white body with
orange trim, a flat solar-panel deck on top, a camera mast with two round
lens "eyes" like a friendly face, a short robotic drill arm folded at the
front, an open seat for one astronaut with a small dashboard and joystick, a
whip antenna with a little flag-coloured tip.*

| Key / file | Facing (screen direction of the nose) | Prompt (after the shared style and the rover design) |
|---|---|---|
| `rover_s` | toward the viewer (down the screen) | Front view from above: we see the drill arm, the camera-mast face and both front wheels head-on. |
| `rover_se` | toward the viewer and to the right | Three-quarter front view, nose pointing down and to the right; we see the front and the right side. |
| `rover_e` | to the right | Side view from above, nose pointing right; all three right-hand wheels visible. |
| `rover_ne` | away from the viewer and to the right | Three-quarter rear view, nose pointing up and to the right; we see the back, the right side and the seat. |
| `rover_n` | away from the viewer (up the screen) | Rear view from above: the back bumper, the seat back and both rear wheels. |

Tip: generate `rover_e` first, then feed it back as the reference image for the
other four so the design stays identical.

## 2. Ground marks (2 files, PNG, transparent, drawn white)

Both are drawn **white or light grey on transparent**: the game tints them per
planet (dark grey on the Moon, rust on Mars) and fades them out over time.

| Key / file | Size | Prompt |
|---|---|---|
| `rover_track` | 40×56 | One short segment of a tyre track pressed into fine dust, seen straight from above: two or three chevron tread bars, soft edges. The direction of travel is **left → right**, and the left edge must continue seamlessly into the right edge, because the game stamps it end to end every 9 px. Stamped 14 px across. |
| `boot_print` | 48×27 | A single astronaut boot print in fine dust, seen straight from above: heel at the left, toe at the right, chunky cross-ribbed tread like the Apollo prints. Stamped 9 px across, alternating left and right feet. |

## 3. Sounds (4 files, `.mp3` or `.ogg`, mono, 44.1 kHz)

Each sound is skipped silently while its file is missing. Keep them short,
friendly and cartoony, normalised so the loudest moment sits around −3 dBFS;
the game sets the final level.

| Key / file | Length | When it plays | Prompt for a sound-effect generator |
|---|---|---|---|
| `rover_motor` | 2–4 s, **seamless loop** | While someone is in the seat. The game raises its volume and playback rate with speed (0.8× parked, 1.3× at top speed). | Cartoon electric rover motor: a soft rising-and-steady electric whine with a gentle rumble of knobbly tyres rolling over gravel, cute and toy-like, no engine combustion, steady level from start to end so it loops cleanly. |
| `rover_bump` | 0.3–0.6 s | Driving into a boulder faster than about a third of top speed. | Cartoon rover bumping into a rock: a short rubbery "boing-thud" with a little metallic rattle of the chassis, comedic, not violent. |
| `rover_door` | 0.3–0.6 s | Climbing in and stepping out. | Seat-belt click followed by a tiny pneumatic hiss, like a cute spacecraft hatch latching, clean and short. |
| `rover_horn` | 0.4–0.8 s | Pressing `H` while driving. | Cute toy-car horn, a double "beep-beep" with a slightly squeaky, friendly tone, like a little cartoon buggy. |

## 4. HUD badge (1 file, 128×128 PNG, transparent)

| Key / file | Where it shows | Prompt |
|---|---|---|
| `rover_icon` | Drawn at 34 px on the left of the speedometer box under the radar while driving; without it the box shows a 🚙. | The rover seen from the front, chunky and readable at small sizes. |

## Nice to have (not wired yet: each needs a little code)

- Per-planet variants (`rover_moon_<dir>`, `rover_mars_<dir>`): a silver-and-gold
  Apollo-style Moon buggy and a dusty Perseverance-style Mars rover. Today one
  design serves both planets.
- The hub's **ROVER BAY** still shows the parked `machines_rover`; the same
  five directions would let the rover drive around the base too.

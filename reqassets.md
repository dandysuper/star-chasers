# Requested assets: Moon & Mars exploration

> **Status:** all 15 files below were delivered and are in `public/assets/planets/`.
> With the painted ground loaded, the game draws plain ground (no mixed tiles)
> and cartoon boulders instead of the square atlas rocks. Only the
> "Nice to have" items at the bottom are still open.

The Moon and Mars walks already run on existing art. Mars reuses the Moon's
icons and tiles with a colour tint, so it looks a bit improvised until these
files land. Every item below is **optional**: if a file is missing, the game
keeps using the tinted fallback.

## How to drop a file in

1. Save the image to `public/assets/planets/<file>`.
2. Add it to `public/assets/planets/manifest.json`:
   ```json
   { "images": [ { "key": "sample_mars_hematite", "file": "sample_mars_hematite.png" } ] }
   ```
   List only files that exist. The manifest is how the game avoids 404s for
   art that has not been made yet.
3. Reload. Nothing else changes: the keys are already wired in
   `src/data/planets.ts`.

## Shared style (prepend to every prompt)

> Cartoon game asset, thick dark-purple outline (#1d1b2e), bold flat colours
> with soft cel shading, light from the top-left, friendly kids' space-adventure
> style matching a hand-painted 2D mobile game, centred single object,
> **transparent background**, no text, no shadow on the ground unless stated.

## Sample icons (10 files, 256×256 PNG, transparent, drawn at about 60 px in game)

| Key / file | Fallback today | Prompt |
|---|---|---|
| `sample_moon_ice` | ice cube bug | A chunk of frosty lunar water ice: pale blue translucent crystals with a little grey regolith dust stuck on, faint inner glow. |
| `sample_moon_basalt` | magma rock | A dark grey lunar mare basalt rock with small round gas holes (vesicles) and a few tiny glinting crystals. |
| `sample_moon_crystal` | purple crystal | A cluster of pale lilac and white anorthosite crystals growing from a grey moon rock. |
| `sample_moon_iron` | iron ore | A grey moon rock with rusty-brown iron grains and metallic silver flecks. |
| `sample_moon_gold` | gold nugget | A small shiny gold nugget half-buried in grey moon dust, with a sparkle. |
| `sample_mars_hematite` | iron ore, red tint | A small pile of dark grey-blue hematite “blueberry” spheres (pea-sized iron balls) on a patch of rusty red Martian soil. |
| `sample_mars_mudstone` | bone shell, tan tint | A flat layered tan-and-ochre mudstone slab with fine horizontal stripes, a drilled round core hole on top. |
| `sample_mars_ice` | ice cube bug, white tint | A chunk of white water ice freshly dug out of red Martian soil, red dust on its edges, a few frost sparkles. |
| `sample_mars_basalt` | magma rock, grey tint | A dark brownish-grey volcanic basalt rock with a dusty red coating on one side. |
| `sample_mars_salt` | purple crystal, cream tint | A cluster of cream-white and pale pink salt crystals (perchlorate/sulfate) on a red rock base. |

## Ground tiles (3 files, 64×64 PNG, **seamless / tileable, full-bleed, no transparency**)

| Key / file | Prompt |
|---|---|
| `ground_moon` | Top-down seamless tile of grey lunar regolith with tiny craters and pebbles, low contrast so it can repeat across a big map without a visible grid. |
| `ground_mars` | Top-down seamless tile of rusty orange-red Martian sand with soft wind ripples and a few small dark pebbles, low contrast, tileable on all four edges. |
| `ground_mars_rock` | Top-down seamless tile of darker red-brown Martian bedrock with cracks and dust, same palette as `ground_mars` so the two mix without a checkerboard look. |

Tip: ask for a 256×256 tile and downscale it. Then check the repeat with
`node tools/tile-check.mjs` after pointing it at the new file.

## Landers (2 files, about 512×512 PNG, transparent, shown 200 px tall)

| Key / file | Prompt |
|---|---|
| `lander_moon` | A cute chunky lunar lander standing on four splayed legs with round foot pads, gold foil base, white crew cabin with a round window, small antenna dish, a little dust kicked up around the feet. Three-quarter top-down view. |
| `lander_mars` | A cute Mars lander on four legs with a white-and-orange heat-shield base, red dust on the lower half, a deployed solar panel on each side and a small communication dish. Three-quarter top-down view, same style as the Moon lander. |

## Nice to have (not wired yet: each needs a little code)

- `bg/flight_mars.webp` (1280×720): painted Mars horizon backdrop for a future Mars flight leg.
- Sample-lab building sign art: the hub still uses the old control shack (`BASE_ART.control`).
  Prompt: *a small domed science lab with a sample airlock, shelves of glowing rock jars visible through a window, roof antenna.*

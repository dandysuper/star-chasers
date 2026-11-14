# Realism pass: NASA data, launch windows, budget

How the brainstorm list ("moon phase via API, NASA data, launch windows, grant,
weather, rocket mass, relive the April Moon flight, Moon position and
trajectory, thrust") maps onto the game. It covers what is built now, what each
NASA source can and can't do, and what to build next.

## 1. What is in the game now

### Mission Control (new scene, `src/scenes/PlannerScene.ts`)

The launch pad at the base now opens **Mission Control** before every launch.
Its **Launch on this day** button leads to the builder for flights and to the
surface for the Moon and Mars walks.

| Piece | What the player sees | Where the numbers come from |
|---|---|---|
| **Moon phase** | The Moon drawn as it looks on the selected day, with its phase name, % lit, distance in km and days since the new Moon. Every day in the strip has a small Moon too. | Computed offline (Meeus, *Astronomical Algorithms*). Unit-tested against the 3 Mar 2026 total lunar eclipse (full Moon) and the 17 Feb 2026 solar eclipse (new Moon). |
| **14 launch days** | One card per day: ✔ GO or ✖ NO GO, plus a 0–100 score. **Best day** picks the top card. Days that broke a launch rule can't be launched. | `src/data/launch.ts` → `evaluateDay`. |
| **Launch weather** | Wind and gusts against the rocket's limit, rain, cloud and temperature, with a line saying where the data came from. Also: *"Past 5 years: 11% of days like this were scrubbed."* | **NASA POWER** daily data for the launch site (MERRA-2 + satellites). |
| **Launch rules** | NO GO for gusts over 15 m/s, storms (rain > 5 mm/day, standing in for lightning), cloud > 90%, or air colder than the rocket allows. | A kid-sized version of NASA's real Launch Commit Criteria. |
| **Launch sites** | Kennedy (USA), Baikonur, Vostochny. Kennedy scrubs below 4 °C, as NASA has since Challenger. Soyuz sites fly down to −40 °C. | `LAUNCH_SITES`. |
| **Moon trip** | Coast time in days, worked out from *your* rocket's spare Δv: more spare Δv means a faster coast. If the rocket can't make it, the shortfall in m/s. | `src/physics/transfer.ts`: vis-viva and Kepler's equation with real Earth constants and the Moon's real distance on that date. |
| **Landing light** | The Sun's height over the landing site when you arrive. NO GO if it's lunar night (−170 °C). The best score goes to a low Sun with long shadows, which is how Apollo landed. | Moon phase on the arrival day. |
| **Mars windows** | Mars can only be launched to for about ±3 weeks around the date when Earth and Mars line up, which happens every 26 months. Outside a window, **Wait for the window (N)** jumps the calendar to the next one. Launching off-window costs more Δv. | Planet positions (JPL mean orbits) and the Hohmann phase angle of 44°. The test confirms the real late-2026 window. |
| **Δv budget** | To orbit, then the burn to the Moon or Mars, then braking and landing, shown in game m/s and real m/s, with a bar for your rocket. | Real figures: about 9.4 km/s to orbit, 3.13 km/s to the Moon, 2.8 km/s to brake and land. The game's 1/10-scale world needs about a third of these. |
| **Budget / grant** | The rocket's price against the mission grant. | `src/data/budget.ts`. |
| **Relive Artemis II** | The calendar jumps to 29 Mar – 11 Apr 2026 at Kennedy, with the weather NASA POWER measured on those days, and selects the real launch day, 1 April. | Real dates: launch 1 Apr 2026, flyby 6 Apr, splashdown 10 Apr. |
| **NASA picture of the day** | Today's APOD title, the start of its explanation, the credit, and an **Open** button. | **APOD API** (`api.nasa.gov`). |

### In the rest of the game

- **Wind in flight.** The flight uses the wind from the chosen day. Wind grows
  with height to a peak around 11 km (the jet stream), up to 3× the surface wind,
  then fades out by 25 km. Drag pushes the rocket downwind, so the player has to
  tilt into the wind. While it matters, the HUD shows `Wind: 12 m/s →`.
- **Cost in the builder.** The stats panel has a **Cost** row: `$25M / $140M`.
  On a mission, a rocket over the grant can't launch: *"Over the grant…"*. Each
  mission's grant fits its recommended preset, and the unit tests check this.
- **Mass → speed.** A lighter rocket has more Δv. More Δv means a shorter coast
  to the Moon, from about 5 days at the bare minimum down to about 1.5 days.
  The Space Arrow preset gets there in about 1.6 days.

### Data sources and how they behave

| Source | Used for | Notes |
|---|---|---|
| [NASA POWER](https://power.larc.nasa.gov/data-access-viewer/) | Launch-site weather | No key needed, and browser calls are allowed (CORS). It has **measurements only, no forecasts**, published a few days late. For future days the game uses the same date in past years, which is also what launch planners look at weeks ahead. Cached for the day. |
| [APOD](https://science.nasa.gov/apod/) via [api.nasa.gov](https://api.nasa.gov/) | Picture of the day | Uses `DEMO_KEY`, which allows about 30 requests an hour per visitor. One request a day is cached. For a public launch, register a free key at api.nasa.gov and put it in `APOD_KEY` in `src/core/nasaData.ts`. |
| NASA SVS Dial-A-Moon | (not used) | The API works, but it only accepts calls from NASA's own partner sites, so a GitHub Pages site can't call it. The Moon is computed in the game instead. That also works offline. |
| [data.nasa.gov](https://data.nasa.gov/), [code.nasa.gov](https://code.nasa.gov/) | Ideas for later (see §3) | Catalogues of data sets and code rather than live APIs. |

If any of these sources can't be reached, the game falls back to an offline
estimate and says so on screen, so the planner always works.

## 2. Notes on the original list

| Idea | Status | Notes |
|---|---|---|
| Moon phase right now, via API | ✅ | Computed offline instead of fetched: the NASA phase API blocks other sites, and computing it is more accurate for any date, Artemis included. |
| NASA data, special windows (e.g. "in 2 days is a good flight") | ✅ | 14-day strip with a score per day and a **Best day** button. Moon windows come from landing light and weather; Mars has real launch windows. |
| Flight budget, grant | ✅ | Part prices and a grant per mission. |
| Meteorological data, weather conditions | ✅ | NASA POWER plus the launch rules, and the wind is felt in flight. |
| Rocket mass | ✅ (already) | Mass already drives Δv and TWR. It now also sets the coast time and the cost. |
| Relive the April Moon flight | ✅ | Artemis II, 1 April 2026, with measured weather. |
| Moon position relative to Earth, trajectory | ◐ | The Moon's real distance on the date sets the Δv and the trip time. The flight sim's Moon still sits at a fixed spot (see §3, item 1). |
| Enough fuel to reach the Moon, lighter = faster | ✅ | Δv budget bar, shortfall in m/s, and coast time from spare Δv. |
| Torque / thrust (тяга) | ✅ (already) | TWR is shown in the builder, and thrust changes with air pressure (sea-level vs vacuum Isp). Rotational torque is suggested in §3, item 4. |

## 3. Next steps (in order of value)

1. **Fly the trajectory.** In the flight sim, put the Moon where it really is
   on the launch date, and add a **Trans-Lunar Injection** step. After reaching
   orbit, the player burns at the right moment, and a dashed predicted path
   shows whether it meets the Moon. Fuel left over after orbit decides the
   coast time the planner already shows. *Needs:* moving the Moon in
   `bodies.ts` and drawing the orbit prediction.
2. **Moon and Mars walks use the plan.** The surface light follows
   `launchPlan.lighting`: long shadows for a low Sun, a flat bright look for
   a high one. Bonus star for landing in "perfect light". On Mars, arriving
   in a dust-storm season gives a short visibility debuff.
3. **The flight result shows the plan.** Add a line like *"Launched 1 April 2026
   from Kennedy · wind 6 m/s · arrived in 1.6 days"*, plus a sticker for
   reliving Artemis II.
4. **Engine torque and gimbal.** Today steering is a fixed 30°/s. Make it
   depend on the engine's gimbal and on the rocket's moment of inertia: a long
   heavy rocket turns slowly, and a strong engine turns it faster. Show it in
   the builder as **Turning: slow / normal / fast**.
5. **Sell science back.** Each sample brought home adds to the next grant:
   *"NASA liked your basalt: +$10M"*. That links the walks to building.
6. **A fail story for each launch rule.** Launching at the edge of the rules
   (gusts near the limit) adds wobble in flight. A lightning-strike animation
   for storm days, if we ever allow a forced launch.
7. **More real missions to relive.** Apollo 11 (16 Jul 1969), Luna 9
   (31 Jan 1966), Perseverance (30 Jul 2020, in the Mars window). The dates are
   data, and POWER weather goes back to 1981.
8. **APOD gallery in the Sample Lab.** Keep every APOD seen as a collectible
   card.
9. **Register an api.nasa.gov key** before the public demo (DEMO_KEY is
   rate-limited per visitor).

Asset requests for all of this are in **`plannerassets.md`**.

## 4. Where things live

| File | Role |
|---|---|
| `src/core/astro.ts` | Moon phase, distance and position, Sun position, Mars windows (pure maths) |
| `src/physics/transfer.ts` | Δv budgets and coast times (vis-viva, Kepler) |
| `src/data/launch.ts` | Launch sites, weather rules, day scoring, Artemis II dates |
| `src/data/budget.ts` | Part prices and grants |
| `src/core/nasaData.ts` | NASA POWER and APOD clients with cache and offline fallback |
| `src/scenes/PlannerScene.ts` | The Mission Control screen |
| `src/physics/sim.ts` | `windAt()` and wind drag in flight |
| `tests/planner.test.ts` | 19 tests: ephemeris against eclipses, transfer physics, launch rules, budget fit, wind |

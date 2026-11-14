# Ship interior: music prompts

> **Status:** requests only, nothing is wired yet. The gameplay these tracks
> serve is described in `assetsship.md`.

The game already has three looping beds: `main_theme`, `builder_theme` and
`flight_theme` in `public/assets/audio/`, routed in `src/core/themeTracks.ts`.
The ship gets its own family of tracks that **share one melody** (the "ship
motif"), so switching between calm, alarm and puzzle feels like the same
piece changing its mood rather than a new song starting.

## The shared musical identity (paste into every prompt)

```
Instrumental soundtrack for a cheerful 2D cartoon space game for kids aged 9-15.
Cozy, curious and warm, like being inside a friendly little spaceship.
Instruments: soft analog synth pads, a plucky marimba / kalimba lead, light
glockenspiel sparkles, a warm bass synth, brushed or soft electronic drums,
occasional playful bleeps and bloops. Key: D major (alarm cues in D minor).
Recurring "ship motif": a short, hummable 5-note rising phrase (D-F#-A-B-A)
that returns in every track. No vocals, no lyrics, no spoken words, no
choir, no aggressive EDM drops, no horror tension, no long silence at the start.
Clean mix, gentle on the ears, leaves room for sound effects on top.
```

## How to deliver

- Format: `.mp3` 192 kbps or `.ogg`, 44.1 kHz, stereo.
- **Loops** must be cut exactly on the bar line, with no fade in or out, so the end
  flows into the start. Ask the generator for a "seamless loop", then trim in an
  editor on the bar. If the generator adds an intro or outro, cut it off.
- Level: loudest moment about −3 dBFS, average around −16 LUFS. The game sets
  the final volume.
- Save to `public/assets/audio/<file>`.

## The tracks

### 1. `ship_theme.mp3`: the calm walk-around bed (main loop)

| | |
|---|---|
| When | the whole time inside the ship while nothing is broken |
| Length | 90–120 s, seamless loop |
| Tempo | 92 BPM, relaxed |
| Mix level | 0.45 |

```
[shared identity block]
Track: the calm main theme for walking around inside the spaceship between
jobs. Mid-tempo 92 BPM, laid-back groove. Starts directly with a soft synth pad
and the marimba playing the ship motif, then a light brushed beat joins.
Middle section: glockenspiel answers the melody, a bubbly bass line walks
around, little computer bleeps like the ship is thinking. Feels like floating
along a cozy corridor with stars passing the portholes. Gentle, curious,
slightly playful. Ends on the same chord it started on so it loops seamlessly.
90-120 seconds.
```

### 2. `ship_alarm.mp3`: something is broken (urgent layer)

| | |
|---|---|
| When | an urgent breakdown is active (oxygen, hull leak). Crossfades from `ship_theme` in 0.5 s and back when it is fixed |
| Length | 30–40 s, seamless loop |
| Tempo | 128 BPM |
| Mix level | 0.5, plus the `ship_alarm_loop` siren SFX on top |

```
[shared identity block, but in D minor]
Track: urgent "something broke on the ship, hurry!" music for kids. 128 BPM,
driving but cartoonish and fun, never scary. A pulsing staccato synth bass on
eighth notes, quick marimba runs, the ship motif played faster and in minor on a
bright square-wave lead, a snappy snare and a ticking hi-hat like a countdown
clock. Comedic tension like a cartoon chase scene. It must leave space in the
mid-range for a siren sound effect. Seamless loop, 30-40 seconds, no ending.
```

### 3. `ship_puzzle.mp3`: thinking music (while a puzzle panel is open)

| | |
|---|---|
| When | a puzzle panel is open for a **non-urgent** task. During urgent tasks, `ship_alarm` keeps playing |
| Length | 60–90 s, seamless loop |
| Tempo | 100 BPM |
| Mix level | 0.35, quieter so clicks and plugs are heard |

```
[shared identity block]
Track: focused, clever "solving a puzzle" music. 100 BPM, light and tidy.
Pizzicato strings and a kalimba playing short repeating patterns that
interlock like gears, soft clicky percussion like a clock mechanism, a warm
bass note every bar. The ship motif appears once, played softly on a
glockenspiel. Feels like tinkering with wires and dials, curious and
concentrated, never stressful. Minimal and steady so it sits behind sound
effects. Seamless loop, 60-90 seconds.
```

### 4. `ship_spacewalk.mp3`: outside the ship

| | |
|---|---|
| When | the spacewalk (hull patch, solar panel) |
| Length | 60–90 s, seamless loop |
| Tempo | free / 70 BPM feel |
| Mix level | 0.4 |

```
[shared identity block]
Track: floating outside the spaceship in open space during a spacewalk. Slow,
wide and dreamy, 70 BPM feel. Huge soft reverb synth pads, a slow heartbeat-like
low pulse, the ship motif stretched out and played very slowly on a warm
electric piano, distant twinkling chimes like stars. A sense of wonder and of
how big space is, but safe and calm, not lonely. Seamless loop, 60-90 seconds.
```

### 5. `ship_zero_g.mp3`: gravity is off (the "floating mess" task and its comedy)

| | |
|---|---|
| When | the zero-g chaos task in the crew quarters |
| Length | 30–45 s, seamless loop |
| Tempo | 110 BPM, waltz (3/4) |
| Mix level | 0.45 |

```
[shared identity block]
Track: a goofy floating waltz for when gravity switches off and everything
drifts around the room. 3/4 time, 110 BPM. A bouncy tuba-like synth bass on
beat one, plucky marimba on beats two and three, a wobbly theremin-like lead
playing the ship motif with silly pitch bends, slide whistle swoops between
phrases. Comedic, cartoonish, light as a soap bubble. Seamless loop, 30-45
seconds.
```

### 6. `ship_night.mp3`: the sleep shift

| | |
|---|---|
| When | after the "sleep shift" side quest: lights go to night mode for a while |
| Length | 60 s, seamless loop |
| Tempo | 60 BPM |
| Mix level | 0.3 |

```
[shared identity block]
Track: a soft spaceship lullaby while the crew sleeps in their sleeping bags.
60 BPM, very gentle. A music-box glockenspiel plays the ship motif slowly, a
warm low pad hums like the ship's air fans, an occasional soft bleep from a
sleeping computer. Peaceful, cozy, a little magical. Seamless loop, 60
seconds.
```

## Short stings (one-shots, no loop)

| File | Length | When | Prompt (after the shared identity block) |
|---|---|---|---|
| `sting_ship_enter.mp3` | 3–4 s | the player goes inside the ship | A short welcoming flourish: the ship motif rising on marimba and glockenspiel with a soft "door opening" synth swell, ends on a bright D major chord. |
| `sting_task_fixed.mp3` | 2 s | an urgent breakdown is fixed | A happy, bouncy "all fixed!" jingle: a quick major arpeggio, a little cymbal sparkle, a cheerful last note. |
| `sting_task_failed.mp3` | 2 s | an urgent timer ran out | A gentle comedic "uh-oh" trombone-like slide down on a synth, not sad, more "oops". |
| `sting_quest_done.mp3` | 2–3 s | a side quest is finished | A sparkly reward jingle: glockenspiel and kalimba play the ship motif in a fast, happy flourish, ending on a ding. |
| `sting_arrival.mp3` | 4–5 s | the trip clock runs out and the ship arrives | A rising, triumphant mini-fanfare: the ship motif on brass-like synths with a drum roll, ending on a big bright chord, like "we made it!". |

## How it plays in the game (for the engineers)

| Situation | Track | Crossfade |
|---|---|---|
| inside the ship, nothing broken | `ship_theme` | 0.9 s (the same as now) |
| an urgent breakdown is active | `ship_alarm` | 0.5 s in, 0.9 s out after the fix |
| a non-urgent puzzle panel is open | `ship_puzzle` | 0.6 s |
| spacewalk | `ship_spacewalk` | 1.2 s |
| zero-g task | `ship_zero_g` | 0.5 s |
| sleep shift | `ship_night` | 2 s |
| back at the window or in flight | `flight_theme` | 0.9 s |

- Add the new ids to `TrackId` and `TRACKS` in `src/core/themeTracks.ts`.
  Loading should stay **lazy**: the ship tracks are fetched only when the
  player first enters the ship, as `prefetchMusic` already does for flight.
- Stings play over the bed, and the bed ducks to `DUCK_FACTOR` while a sting plays.
- Every file is optional. If one is missing, the current bed keeps playing.

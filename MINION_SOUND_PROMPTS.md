# Minion sound prompts — Driller & Chemist

Batch sheet for a sound model. Every row is one job: either a **TTS** job (the
minion mumbling in its own invented language) or an **SFX** job (a physical
sound the minion makes while working).

Two characters are covered:

| In-game id | Who | Role |
|---|---|---|
| `driller` | **GRUBB** — the drilling minion | runs the core drill on the Moon, cracks rocks, hauls samples |
| `chemist` | **FIZZ** — the elixir minion | mixes fuel, oxygen and goo, decants flasks, tests brews |

Both speak languages that are *not* Russian or English. They are fixed
syllable sets so every batch — months apart — produces the same character. Do
not "fix" a syllable into a real word; the unintelligibility is the point.

---

## 1. Voice bible (paste into every job)

### GRUBB — driller

```
VOICE: adult male, small stout creature, chest voice, heavy and slow.
Pitch: low, lands around 90–110 Hz with a gravelly fry at phrase ends.
Texture: wet gravel, dust in the throat, audible breath before speaking.
Pace: slow, 2–3 syllables per second, big pauses, effort in every word.
Prosody: flat and grumpy, then sudden bright excitement when something is found.
No music, no reverb, no cartoon "chipmunk" pitch, no words in any real language.
```

### FIZZ — chemist

```
VOICE: adult, androgynous, light and quick, small creature.
Pitch: high-mid, 210–260 Hz, with quick upward chirps.
Texture: bubbly and breathy, slightly nasal, tiny wet mouth clicks between words.
Pace: fast, 4–6 syllables per second, clipped, always mid-thought.
Prosody: delighted and conspiratorial, tips into a nervous giggle under stress.
No music, no reverb, no words in any real language.
```

**Shared rules for both**

- Mouth is close to the mic: intimate, close-miked, almost ASMR, then a burst of
  volume on the punchline syllable.
- Never sing. Never sound like a narrator. They are talking to themselves.
- The mumble must stay *quiet* — these play under music at 0.5 volume.
- Output: mono, 44.1 kHz, peak −3 dBFS, no clipping, 60 ms of silence at the head
  and tail so the game can trim to zero crossings.

---

## 2. The languages

### Dug-Tongue (GRUBB)

Guttural: stops, rolls, and a lot of air. Built from these syllables only.

```
brok  drukk  grom  hrn  takk  muk  brrm  grak  doon  hmm  nguh  krak  tokk  rrgh  dah  ugg
```

Rules
- Words are 1–3 syllables: `grom-brok`, `takk-muk`, `hrn`.
- Doubling means emphasis: `drukk-drukk!` = "now!", `brok-brok` = "more".
- A trailing `-rrgh` is a complaint or an effort grunt.
- Sentences end falling. Questions end with `nguh?` rising.

Working vocabulary (keep these meanings fixed in every batch):

| Dug-Tongue | Means |
|---|---|
| `grom` | rock / stone |
| `brok` | break / dig |
| `drukk` | now / go |
| `muk` | heavy / tired |
| `takk` | good / found it |
| `hrn` | hmm / thinking |
| `doon` | down / deep |
| `grak` | bad / stuck |
| `brrm` | the drill (onomatopoeic) |
| `ug` | dust / dirty |
| `nguh?` | what? / really? |

### Fizzle (FIZZ)

Fricatives and bubbles: hisses, plosives, liquid pops.

```
fss  bzzt  plip  gloop  tik  pf  shh  wibble  bloob  ssik  fwip  klik  mmm  pop  zzz  glip
```

Rules
- Words are 2–4 syllables, fast: `plip-gloop-fss`, `tik-tik-bzzt`.
- `ss` tails are thinking; `pop` is a conclusion.
- Doubling is excitement: `plip-plip!`, `bzzt-bzzt`.
- Sentences rise at the end — Fizz is always about to ask something.

Working vocabulary:

| Fizzle | Means |
|---|---|
| `fss` | fizz / gas |
| `gloop` | liquid / pour |
| `plip` | drop / drip |
| `bzzt` | heat / reaction |
| `tik` | small / precise |
| `bloob` | bubble / boil |
| `shh` | careful / hush |
| `pop` | done! / it worked |
| `glip` | wrong / spoiled |
| `wibble` | wobble / unstable |
| `mmm` | tasty / promising |
| `ssik` | spark / ignite |

---

## 3. Job table

`Engine` is what to send it to: `tts` = a voice model (feed the literal text in
the *Say* column, with the voice bible as the style prompt), `sfx` = a
sound-effects model (feed the *Prompt* column).

### 3a. GRUBB — voice

| ID | Say (literal, Dug-Tongue) | English meaning | Use in game | Dur |
|---|---|---|---|---|
| `driller_v01` | `hrn… grom-brok. grom-brok. takk!` | thinking, then: dig the rock… got it! | idle while walking near a sample | 3.0 s |
| `driller_v02` | `drukk-drukk! brrm!` | go go! drill! | drill spin-up, the moment the player presses E | 1.5 s |
| `driller_v03` | `brrm-brrm-brrm… muk… muk… rrgh` | drilling, heavy, tired complaint | under the 1.5 s drill loop | 2.5 s |
| `driller_v04` | `takk! takk-takk! doon-doon!` | found it! it's deep! | sample pops out | 2.0 s |
| `driller_v05` | `grak. grak-rrgh.` | stuck. this is bad. | drill jams / wrong spot | 1.8 s |
| `driller_v06` | `ug. ug-brok. hmm.` | dusty. dusty rock. huh. | wiping dust off the visor | 2.2 s |
| `driller_v07` | `nguh? … nguh-nguh?` | what? really? (rising) | sees something odd in the crater | 1.8 s |
| `driller_v08` | `brok-brok! muk-brok! takk!` | more rocks! heavy rock! good! | second and third sample | 2.4 s |
| `driller_v09` | `hrn… mmm… brok.` | hmm… yeah… break it. | thinking out loud, quiet | 2.0 s |
| `driller_v10` | `rrgh. muk. muk.` | ugh. heavy. so heavy. | carrying the sample back | 1.6 s |

### 3b. GRUBB — effects

| ID | Prompt | Use | Dur |
|---|---|---|---|
| `driller_fx01` | Handheld core drill spinning up: electric whine climbing from 0 to a steady buzz, small motor, close mic, dusty air, no music. | drill start | 1.0 s |
| `driller_fx02` | Steady handheld drill loop boring into rock: consistent motor hum, grinding grit, tiny pebble ticks, seamless loop, no fade at the edges. | drill loop (below `driller_v03`) | 2.0 s loop |
| `driller_fx03` | Rock cracking under a drill bit: sharp dry snap, then crumbling grit and small stones skittering on dusty ground. | sample breaks free | 1.2 s |
| `driller_fx04` | Drill jamming: motor pitch drops hard, nasty grinding screech, metal slipping, then dead stop with a clunk. | failed attempt | 1.5 s |
| `driller_fx05` | Small rock sample dropping into a fabric sample pouch: soft thud, gravel shuffle, zip of a flap closing. | pickup confirm | 0.9 s |
| `driller_fx06` | Suit movement in low gravity outside a helmet: fabric creak, muffled boot scuff on dust, faint breathing, quiet. | walking foley | 1.4 s loop |

### 3c. FIZZ — voice

| ID | Say (literal, Fizzle) | English meaning | Use in game | Dur |
|---|---|---|---|---|
| `chemist_v01` | `plip-gloop-fss. mmm… tik-tik.` | drip, pour, fizz… nice… precise, precise | idle at the fuel farm | 3.0 s |
| `chemist_v02` | `bzzt-bzzt! wibble! shh-shh!` | it's reacting! it's unstable! careful! | fuel mix about to blow | 2.2 s |
| `chemist_v03` | `pop! pop-plip! bloob-gloop!` | done! it worked! bubbling liquid! | successful mix | 2.0 s |
| `chemist_v04` | `glip… glip. ssik.` | spoiled… wrong. ignite it anyway. | failed recipe | 1.8 s |
| `chemist_v05` | `tik-tik-tik… plip. plip. plip.` | counting drops under the breath | decanting, precision work | 2.6 s |
| `chemist_v06` | `mmm-bloob! fss-fss! pop!` | promising! more gas! done! | oxygen topped up | 2.0 s |
| `chemist_v07` | `shh… shh… wibble…` | hush… hush… it's wobbling… | tense moment before ignition | 2.4 s |
| `chemist_v08` | `bzzt. gloop-gloop. glip!` | heat. pour pour. spoiled! | pouring into a hot flask | 1.9 s |
| `chemist_v09` | `ssik-plip-fss! plip! pop—` (startles, cuts itself off) | spark-drip-gas! drip! done— | surprise flare | 1.6 s |
| `chemist_v10` | `fss… mmm. plip. bzzt. pop.` | fizz… nice. one drop. heat. done. | calm recipe reading | 3.0 s |

### 3d. FIZZ — effects

| ID | Prompt | Use | Dur |
|---|---|---|---|
| `chemist_fx01` | Liquid pouring into a glass flask, close mic: steady glugging, rising pitch as the flask fills, tiny bubbles at the end. | pouring | 1.6 s |
| `chemist_fx02` | Vigorous chemical fizz in a flask: dense bubbling, wet popping surface, glassy resonance, no music. | active reaction loop | 2.0 s loop |
| `chemist_fx03` | Glass stopper popping out of a flask: small cork pop, sharp glass ring, then a puff of released gas. | flask opened | 0.7 s |
| `chemist_fx04` | Sloshing swirl in a round-bottom flask: liquid rotating, thin glass walls, tiny clink against metal tongs. | mixing | 1.4 s |
| `chemist_fx05` | Small pressure warning from a canister: rising hiss, a metallic ping, then a short vented release. | unstable mix alert | 1.2 s |
| `chemist_fx06` | Single drop landing in a still liquid: bright plip, tiny ripple ring, close and dry, no reverb. | a drop / confirm tick | 0.5 s |

---

## 4. Batch payload (paste-ready)

One array, mixed engines. `voice` selects the character bible; `engine` selects
the model family; `say` is only for TTS rows, `prompt` only for SFX rows.

```json
{
  "voice_bibles": {
    "grubb": "adult male, small stout creature, LOW gravelly chest voice 90-110Hz, wet gravel texture, slow 2-3 syllables/sec, effortful, grumpy then suddenly excited, close-miked, no reverb, speaks only invented guttural syllables, never any real language",
    "fizz": "adult androgynous, small creature, HIGH light voice 210-260Hz, bubbly breathy nasal texture, fast 4-6 syllables/sec, delighted and conspiratorial, tiny wet mouth clicks, close-miked, no reverb, speaks only invented fizzing syllables, never any real language"
  },
  "jobs": [
    { "id": "driller_v01", "engine": "tts", "voice": "grubb", "say": "hrn... grom-brok. grom-brok. takk!", "out": "assets/audio/voice/driller_v01.mp3" },
    { "id": "driller_v02", "engine": "tts", "voice": "grubb", "say": "drukk-drukk! brrm!", "out": "assets/audio/voice/driller_v02.mp3" },
    { "id": "driller_v03", "engine": "tts", "voice": "grubb", "say": "brrm-brrm-brrm... muk... muk... rrgh", "out": "assets/audio/voice/driller_v03.mp3" },
    { "id": "driller_v04", "engine": "tts", "voice": "grubb", "say": "takk! takk-takk! doon-doon!", "out": "assets/audio/voice/driller_v04.mp3" },
    { "id": "driller_v05", "engine": "tts", "voice": "grubb", "say": "grak. grak-rrgh.", "out": "assets/audio/voice/driller_v05.mp3" },
    { "id": "driller_v06", "engine": "tts", "voice": "grubb", "say": "ug. ug-brok. hmm.", "out": "assets/audio/voice/driller_v06.mp3" },
    { "id": "driller_v07", "engine": "tts", "voice": "grubb", "say": "nguh? ... nguh-nguh?", "out": "assets/audio/voice/driller_v07.mp3" },
    { "id": "driller_v08", "engine": "tts", "voice": "grubb", "say": "brok-brok! muk-brok! takk!", "out": "assets/audio/voice/driller_v08.mp3" },
    { "id": "driller_v09", "engine": "tts", "voice": "grubb", "say": "hrn... mmm... brok.", "out": "assets/audio/voice/driller_v09.mp3" },
    { "id": "driller_v10", "engine": "tts", "voice": "grubb", "say": "rrgh. muk. muk.", "out": "assets/audio/voice/driller_v10.mp3" },

    { "id": "chemist_v01", "engine": "tts", "voice": "fizz", "say": "plip-gloop-fss. mmm... tik-tik.", "out": "assets/audio/voice/chemist_v01.mp3" },
    { "id": "chemist_v02", "engine": "tts", "voice": "fizz", "say": "bzzt-bzzt! wibble! shh-shh!", "out": "assets/audio/voice/chemist_v02.mp3" },
    { "id": "chemist_v03", "engine": "tts", "voice": "fizz", "say": "pop! pop-plip! bloob-gloop!", "out": "assets/audio/voice/chemist_v03.mp3" },
    { "id": "chemist_v04", "engine": "tts", "voice": "fizz", "say": "glip... glip. ssik.", "out": "assets/audio/voice/chemist_v04.mp3" },
    { "id": "chemist_v05", "engine": "tts", "voice": "fizz", "say": "tik-tik-tik... plip. plip. plip.", "out": "assets/audio/voice/chemist_v05.mp3" },
    { "id": "chemist_v06", "engine": "tts", "voice": "fizz", "say": "mmm-bloob! fss-fss! pop!", "out": "assets/audio/voice/chemist_v06.mp3" },
    { "id": "chemist_v07", "engine": "tts", "voice": "fizz", "say": "shh... shh... wibble...", "out": "assets/audio/voice/chemist_v07.mp3" },
    { "id": "chemist_v08", "engine": "tts", "voice": "fizz", "say": "bzzt. gloop-gloop. glip!", "out": "assets/audio/voice/chemist_v08.mp3" },
    { "id": "chemist_v09", "engine": "tts", "voice": "fizz", "say": "ssik-plip-fss! plip! pop—", "out": "assets/audio/voice/chemist_v09.mp3" },
    { "id": "chemist_v10", "engine": "tts", "voice": "fizz", "say": "fss... mmm. plip. bzzt. pop.", "out": "assets/audio/voice/chemist_v10.mp3" },

    { "id": "driller_fx01", "engine": "sfx", "prompt": "handheld core drill spinning up, electric whine climbing from zero to a steady buzz, small motor, close mic, dusty air", "dur": 1.0, "out": "assets/audio/sfx/driller_fx01.mp3" },
    { "id": "driller_fx02", "engine": "sfx", "prompt": "steady handheld drill loop boring into rock, consistent motor hum, grinding grit, tiny pebble ticks, seamless loop", "dur": 2.0, "loop": true, "out": "assets/audio/sfx/driller_fx02.mp3" },
    { "id": "driller_fx03", "engine": "sfx", "prompt": "rock cracking under a drill bit, sharp dry snap, then crumbling grit and small stones skittering on dusty ground", "dur": 1.2, "out": "assets/audio/sfx/driller_fx03.mp3" },
    { "id": "driller_fx04", "engine": "sfx", "prompt": "drill jamming, motor pitch drops hard, nasty grinding screech, metal slipping, dead stop with a clunk", "dur": 1.5, "out": "assets/audio/sfx/driller_fx04.mp3" },
    { "id": "driller_fx05", "engine": "sfx", "prompt": "small rock sample dropping into a fabric pouch, soft thud, gravel shuffle, zip of a flap closing", "dur": 0.9, "out": "assets/audio/sfx/driller_fx05.mp3" },
    { "id": "driller_fx06", "engine": "sfx", "prompt": "suit movement in low gravity, fabric creak, muffled boot scuff on dust, faint breathing, quiet, seamless loop", "dur": 1.4, "loop": true, "out": "assets/audio/sfx/driller_fx06.mp3" },

    { "id": "chemist_fx01", "engine": "sfx", "prompt": "liquid pouring into a glass flask, close mic, steady glugging, rising pitch as the flask fills, tiny bubbles at the end", "dur": 1.6, "out": "assets/audio/sfx/chemist_fx01.mp3" },
    { "id": "chemist_fx02", "engine": "sfx", "prompt": "vigorous chemical fizz in a flask, dense bubbling, wet popping surface, glassy resonance, seamless loop", "dur": 2.0, "loop": true, "out": "assets/audio/sfx/chemist_fx02.mp3" },
    { "id": "chemist_fx03", "engine": "sfx", "prompt": "glass stopper popping out of a flask, small cork pop, sharp glass ring, puff of released gas", "dur": 0.7, "out": "assets/audio/sfx/chemist_fx03.mp3" },
    { "id": "chemist_fx04", "engine": "sfx", "prompt": "sloshing swirl in a round-bottom flask, liquid rotating, thin glass walls, tiny clink against metal tongs", "dur": 1.4, "out": "assets/audio/sfx/chemist_fx04.mp3" },
    { "id": "chemist_fx05", "engine": "sfx", "prompt": "small pressure warning from a canister, rising hiss, metallic ping, short vented release", "dur": 1.2, "out": "assets/audio/sfx/chemist_fx05.mp3" },
    { "id": "chemist_fx06", "engine": "sfx", "prompt": "single drop landing in still liquid, bright plip, tiny ripple ring, close and dry, no reverb", "dur": 0.5, "out": "assets/audio/sfx/chemist_fx06.mp3" }
  ]
}
```

---

## 5. Consistency checklist for every batch

1. **Same syllable list.** GRUBB may only use Dug-Tongue syllables, FIZZ only
   Fizzle ones. A new syllable invented to make a line easier breaks the
   character for every future batch.
2. **Same seed voice.** Keep one reference take per character and pass it as the
   voice reference on every later batch, rather than re-describing the voice.
3. **Same mic distance.** Close and intimate for both; these sit under music at
   0.5 volume and get lost if they are recorded "big".
4. **No real words.** If a take accidentally resolves into English or Russian,
   throw it away — that is the one thing that breaks the illusion.
5. **Leave the head and tail silent** (60 ms). The game trims to zero crossings.
6. **Loops must be seamless** — no fade in or out on `*_fx02` and `*_fx06`.
7. **Loudness**: peak −3 dBFS, no clipping, mono.

---

## 6. Where these get wired (once the files exist)

Nothing is loaded yet — this file is the prompt sheet, not the integration.
When the audio lands, these are the hooks:

| File | Scene | Hook |
|---|---|---|
| `driller_v02`, `driller_fx01`, `driller_fx02`, `driller_v03`, `driller_fx03` | `ExploreScene` | drill start → 1.5 s drilling bar → sample pops free |
| `driller_v04`, `driller_fx05` | `ExploreScene` | sample collected |
| `driller_fx06` | `ExploreScene` | walking loop on the Moon |
| `chemist_v01`, `chemist_fx02` | `HubScene` | idle at the fuel farm loop |
| `chemist_fx01`, `chemist_fx03`, `chemist_fx04` | `HubScene` | refuel interaction |
| `chemist_v03` | `BuilderScene` / `HubScene` | fuel or oxygen topped up |
| all `*_fx*` | any scene | load under `assets/audio/sfx/`, play through `scene.sound` (music already crossfades via `src/ui/music.ts` — SFX must **not** go through it) |

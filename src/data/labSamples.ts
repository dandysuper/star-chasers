/**
 * labSamples.ts — the science behind the sample lab.
 *
 * Two real instruments are modelled:
 * - **Laser spectrometer (LIBS)**: SuperCam on Perseverance and ChemCam on
 *   Curiosity fire a laser at a rock, the spark glows, and the light is split
 *   into a spectrum. Every element shines at its own wavelengths, so the
 *   peaks say what the rock is made of. The lines below are real emission
 *   lines (nm, rounded), two per element, as listed in the NIST atomic
 *   spectra database.
 * - **Close-up camera**: WATSON (on SHERLOC, Perseverance) and MAHLI
 *   (Curiosity) photograph grains thinner than a hair. The texture tells
 *   how the rock formed: gas bubbles from lava, round grains and layers from
 *   water, ice crystals, broken shards from an impact.
 *
 * Compositions are simplified to their main elements.
 */
import type { PlanetId } from './planets';

export type L = { en: string; ru: string };
export type ElementId = 'H' | 'O' | 'Na' | 'Cl' | 'Ca' | 'Mg' | 'Si' | 'Fe' | 'Al' | 'Ti';

export interface ElementDef {
  id: ElementId;
  name: L;
  /** Two real emission lines, nm. */
  lines: [number, number];
  color: number;
}

export const ELEMENTS: ElementDef[] = [
  { id: 'H', name: { en: 'Hydrogen', ru: 'Водород' }, lines: [486, 656], color: 0xff6b6b },
  { id: 'O', name: { en: 'Oxygen', ru: 'Кислород' }, lines: [777, 845], color: 0x6bd0ff },
  { id: 'Na', name: { en: 'Sodium', ru: 'Натрий' }, lines: [589, 819], color: 0xffd23f },
  { id: 'Cl', name: { en: 'Chlorine', ru: 'Хлор' }, lines: [726, 838], color: 0x9be36b },
  { id: 'Ca', name: { en: 'Calcium', ru: 'Кальций' }, lines: [393, 423], color: 0xff9ad5 },
  { id: 'Mg', name: { en: 'Magnesium', ru: 'Магний' }, lines: [285, 518], color: 0xb48cff },
  { id: 'Si', name: { en: 'Silicon', ru: 'Кремний' }, lines: [288, 391], color: 0xd9c7a0 },
  { id: 'Fe', name: { en: 'Iron', ru: 'Железо' }, lines: [404, 438], color: 0xff8a2a },
  { id: 'Al', name: { en: 'Aluminium', ru: 'Алюминий' }, lines: [309, 396], color: 0xc0c8d8 },
  { id: 'Ti', name: { en: 'Titanium', ru: 'Титан' }, lines: [335, 498], color: 0x7ee0c8 },
];

export function elementDef(id: ElementId): ElementDef {
  return ELEMENTS.find((e) => e.id === id)!;
}

/** What the close-up camera sees. */
export type Texture = 'vesicles' | 'layers' | 'spherules' | 'ice' | 'cubes' | 'laths' | 'shards' | 'beads';
/** How the rock formed. */
export type Origin = 'lava' | 'water' | 'ice' | 'impact';

export interface LabSample {
  /** The in-game sample id (data/planets.ts). */
  id: string;
  planet: PlanetId;
  /** What the lab says it really is. */
  mineral: L;
  formula: string;
  elements: ElementId[];
  texture: Texture;
  origin: Origin;
  /** Base colour of the rock under the camera, and of its grains. */
  rock: number;
  grain: number;
  /** What the texture means, one sentence. */
  clue: L;
  /** A real NASA finding about this kind of rock. */
  fact: L;
}

export const LAB_SAMPLES: LabSample[] = [
  // ------------------------------------------------------------- Moon ---
  {
    id: 'ice_cube_bug', planet: 'moon',
    mineral: { en: 'Water ice', ru: 'Водяной лёд' }, formula: 'H₂O',
    elements: ['H', 'O'], texture: 'ice', origin: 'ice', rock: 0x9fb8d8, grain: 0xeef6ff,
    clue: { en: 'Sharp six-sided crystals: frozen water.', ru: 'Острые шестигранные кристаллы — замёрзшая вода.' },
    fact: {
      en: 'NASA\'s LCROSS (2009) crashed into Cabeus crater near the lunar south pole and found water ice in the dust it threw up.',
      ru: 'Зонд NASA LCROSS (2009) врезался в кратер Кабеус у южного полюса Луны и нашёл водяной лёд в выбитой пыли.',
    },
  },
  {
    id: 'magma_rock', planet: 'moon',
    mineral: { en: 'Mare basalt', ru: 'Морской базальт' }, formula: 'SiO₂ · FeO · MgO · CaO',
    elements: ['Si', 'Fe', 'Mg', 'Ca', 'O'], texture: 'vesicles', origin: 'lava', rock: 0x4a4a52, grain: 0x1e1e26,
    clue: { en: 'Round holes left by gas bubbles in cooling lava.', ru: 'Круглые дырочки от пузырьков газа в остывающей лаве.' },
    fact: {
      en: 'The dark "seas" of the Moon are old lava flows. Apollo 11 brought the first mare basalts home in 1969.',
      ru: 'Тёмные «моря» Луны — застывшие потоки лавы. Первые морские базальты привёз «Аполлон-11» в 1969 году.',
    },
  },
  {
    id: 'purple_crystal', planet: 'moon',
    mineral: { en: 'Anorthosite', ru: 'Анортозит' }, formula: 'CaAl₂Si₂O₈',
    elements: ['Ca', 'Al', 'Si', 'O'], texture: 'laths', origin: 'lava', rock: 0xd8d2e8, grain: 0xa58ad6,
    clue: { en: 'Long interlocking crystals that grew while magma cooled slowly.', ru: 'Длинные сросшиеся кристаллы: магма остывала медленно.' },
    fact: {
      en: 'Apollo 15 found the "Genesis Rock", an anorthosite about 4 billion years old, from the Moon\'s first crust.',
      ru: '«Аполлон-15» нашёл «Камень Бытия» — анортозит возрастом около 4 млрд лет из первой коры Луны.',
    },
  },
  {
    id: 'iron_ore', planet: 'moon',
    mineral: { en: 'Ilmenite breccia', ru: 'Ильменитовая брекчия' }, formula: 'FeTiO₃',
    elements: ['Fe', 'Ti', 'O'], texture: 'shards', origin: 'impact', rock: 0x5c5a60, grain: 0x2a2a30,
    clue: { en: 'Broken sharp-edged pieces glued together by a meteorite impact.', ru: 'Острые обломки, спаянные ударом метеорита.' },
    fact: {
      en: 'Ilmenite holds oxygen. NASA studies baking it to make air and rocket fuel for future Moon bases.',
      ru: 'В ильмените есть кислород. NASA изучает, как получать из него воздух и топливо для будущих лунных баз.',
    },
  },
  {
    id: 'gold_nugget', planet: 'moon',
    mineral: { en: 'Orange volcanic glass', ru: 'Оранжевое вулканическое стекло' }, formula: 'SiO₂ · TiO₂ · FeO · MgO',
    elements: ['Si', 'Ti', 'Fe', 'Mg', 'O'], texture: 'beads', origin: 'lava', rock: 0x8a5a2a, grain: 0xffa53a,
    clue: { en: 'Tiny glass beads sprayed out by a lava fountain.', ru: 'Крошечные стеклянные бусинки из лавового фонтана.' },
    fact: {
      en: 'Not gold! On Apollo 17 (1972) geologist Harrison Schmitt found orange soil: beads of volcanic glass.',
      ru: 'Это не золото! На «Аполлоне-17» (1972) геолог Харрисон Шмитт нашёл оранжевый грунт — бусинки вулканического стекла.',
    },
  },
  // ------------------------------------------------------------- Mars ---
  {
    id: 'mars_hematite', planet: 'mars',
    mineral: { en: 'Hematite', ru: 'Гематит' }, formula: 'Fe₂O₃',
    elements: ['Fe', 'O'], texture: 'spherules', origin: 'water', rock: 0xc98a62, grain: 0x5a4a5a,
    clue: { en: 'Round little balls that grew inside wet rock.', ru: 'Круглые шарики, выросшие внутри мокрой породы.' },
    fact: {
      en: 'In 2004 the Opportunity rover found hematite "blueberries" at Meridiani Planum: signs of ancient water.',
      ru: 'В 2004 году марсоход Opportunity нашёл гематитовые «черничины» на плато Меридиана — следы древней воды.',
    },
  },
  {
    id: 'mars_mudstone', planet: 'mars',
    mineral: { en: 'Clay mudstone', ru: 'Глинистый аргиллит' }, formula: 'Al₂Si₂O₅(OH)₄ + Fe',
    elements: ['Al', 'Si', 'H', 'O', 'Fe'], texture: 'layers', origin: 'water', rock: 0xc48a5e, grain: 0x8a5a3e,
    clue: { en: 'Thin flat layers of mud that settled at the bottom of a lake.', ru: 'Тонкие ровные слои ила со дна озера.' },
    fact: {
      en: 'Curiosity found mudstone in Gale crater: an old lake. Perseverance is collecting samples in Jezero crater, an old lake and river delta.',
      ru: 'Curiosity нашёл аргиллит в кратере Гейл — на месте древнего озера. Perseverance собирает образцы в кратере Езеро, где было озеро с дельтой реки.',
    },
  },
  {
    id: 'mars_ice', planet: 'mars',
    mineral: { en: 'Water ice', ru: 'Водяной лёд' }, formula: 'H₂O',
    elements: ['H', 'O'], texture: 'ice', origin: 'ice', rock: 0xb08c78, grain: 0xf2f6ff,
    clue: { en: 'Six-sided ice crystals.', ru: 'Шестигранные кристаллы льда.' },
    fact: {
      en: 'In 2008 the Phoenix lander dug a trench and watched bright chunks of ice vanish into the thin air within days.',
      ru: 'В 2008 году посадочный модуль Phoenix выкопал канавку и увидел, как кусочки льда за несколько дней испарились.',
    },
  },
  {
    id: 'mars_basalt', planet: 'mars',
    mineral: { en: 'Martian basalt', ru: 'Марсианский базальт' }, formula: 'SiO₂ · FeO · MgO · CaO',
    elements: ['Si', 'Fe', 'Mg', 'Ca', 'O'], texture: 'vesicles', origin: 'lava', rock: 0x5a4846, grain: 0x2a1e1e,
    clue: { en: 'Gas-bubble holes: this was lava.', ru: 'Дырочки от пузырьков газа — это была лава.' },
    fact: {
      en: 'Mars has Olympus Mons, the biggest volcano in the Solar System, about 22 km tall.',
      ru: 'На Марсе гора Олимп — самый большой вулкан Солнечной системы, высотой около 22 км.',
    },
  },
  {
    id: 'mars_salt', planet: 'mars',
    mineral: { en: 'Rock salt', ru: 'Каменная соль' }, formula: 'NaCl',
    elements: ['Na', 'Cl'], texture: 'cubes', origin: 'water', rock: 0xd8b4a0, grain: 0xfbe8dc,
    clue: { en: 'Little cubes: salt left behind when salty water dried up.', ru: 'Маленькие кубики — соль, оставшаяся от высохшей солёной воды.' },
    fact: {
      en: 'NASA\'s Mars Odyssey orbiter mapped chloride salt deposits where lakes dried out billions of years ago.',
      ru: 'Орбитальный аппарат NASA Mars Odyssey нашёл залежи хлоридных солей там, где миллиарды лет назад высохли озёра.',
    },
  },
];

export function labSamplesFor(planet: PlanetId): LabSample[] {
  return LAB_SAMPLES.filter((s) => s.planet === planet);
}

export const ORIGINS: { id: Origin; icon: string; name: L }[] = [
  { id: 'lava', icon: '🌋', name: { en: 'Lava', ru: 'Лава' } },
  { id: 'water', icon: '💧', name: { en: 'Water', ru: 'Вода' } },
  { id: 'ice', icon: '❄️', name: { en: 'Frozen ice', ru: 'Лёд' } },
  { id: 'impact', icon: '☄️', name: { en: 'Impact', ru: 'Метеорит' } },
];

/** The instruments shown for each world, with what the real ones do. */
export const INSTRUMENTS: Record<PlanetId, { spectro: L; camera: L; spectroFact: L; cameraFact: L }> = {
  mars: {
    spectro: { en: 'SuperCam laser (Perseverance)', ru: 'Лазер SuperCam (Perseverance)' },
    camera: { en: 'WATSON close-up camera (Perseverance)', ru: 'Камера WATSON (Perseverance)' },
    spectroFact: {
      en: 'SuperCam zaps rocks with a laser from up to 7 m away and splits the light of the spark: the method is called LIBS. ChemCam on Curiosity does the same.',
      ru: 'SuperCam бьёт лазером по камню с расстояния до 7 м и раскладывает свет искры в спектр — это метод ЛИЭС (LIBS). Так же работает ChemCam на Curiosity.',
    },
    cameraFact: {
      en: 'WATSON sits on the rover\'s arm and sees grains thinner than a human hair. Curiosity\'s MAHLI camera works the same way.',
      ru: 'WATSON стоит на «руке» марсохода и видит зёрна тоньше волоса. Так же работает камера MAHLI на Curiosity.',
    },
  },
  moon: {
    spectro: { en: 'Laser spectrometer (NASA lunar lab)', ru: 'Лазерный спектрометр (лунная лаборатория NASA)' },
    camera: { en: 'Lab microscope (NASA lunar lab)', ru: 'Микроскоп (лунная лаборатория NASA)' },
    spectroFact: {
      en: 'Apollo brought back 382 kg of Moon rock. NASA\'s lunar sample lab in Houston still studies them, reading element lines in their light.',
      ru: '«Аполлоны» привезли 382 кг лунного грунта. Лаборатория NASA в Хьюстоне до сих пор изучает его, читая линии элементов в спектре.',
    },
    cameraFact: {
      en: 'Thin slices of Moon rock under a microscope show how they formed: bubbles, crystals, glass beads or impact shards.',
      ru: 'Тонкие срезы лунных камней под микроскопом показывают, как они появились: пузырьки, кристаллы, стеклянные бусинки или осколки от ударов.',
    },
  },
};

/** Tutorial sample for each world: the one with the simplest spectrum. */
export const TUTORIAL_SAMPLE: Record<PlanetId, string> = { moon: 'ice_cube_bug', mars: 'mars_hematite' };

/** The elements the spectrum shows, compared with what the player picked. */
export function spectrumMatch(sample: LabSample, picked: ReadonlySet<ElementId>): { missing: ElementId[]; extra: ElementId[] } {
  const missing = sample.elements.filter((e) => !picked.has(e));
  const extra = [...picked].filter((e) => !sample.elements.includes(e));
  return { missing, extra };
}

/** Stars for a finished challenge. */
export function labStars(mistakes: number, seconds: number, limit: number): number {
  if (mistakes <= 1 && seconds <= limit * 0.75) return 3;
  return mistakes <= 3 ? 2 : 1;
}

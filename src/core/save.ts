import { state, type RocketDesign } from './state';
import { isKnownPart } from '../data/parts';

const KEY = 'starchasers.save.v1';

interface SaveData {
  version: 1;
  lang: 'ru' | 'en';
  music: boolean;
  astronaut: 'female' | 'male';
  progress: typeof state.progress;
  /** `slots` is optional: saves written before sideways building reopen as the
   *  plain top-to-bottom stack they already were. */
  designs: Record<string, RocketDesign>;
  /** Sample id → count. Absent on saves from before the sample collection. */
  collection?: Record<string, number>;
  /** Launch site picked in Mission Control. Absent on older saves. */
  site?: string;
}

/** Saves from the coding era can hold parts that no longer exist (the sensor
 *  parts). Drop them; the slot layout no longer lines up, so such a design
 *  reopens as a plain stack. */
function cleanDesigns(raw: Record<string, RocketDesign>): Record<string, RocketDesign> {
  const out: Record<string, RocketDesign> = {};
  for (const [key, d] of Object.entries(raw)) {
    if (!d || !Array.isArray(d.parts)) continue;
    const parts = d.parts.filter(isKnownPart);
    out[key] = parts.length === d.parts.length ? d : { parts };
  }
  return out;
}

export function loadSave(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== 1) return false;
    state.lang = data.lang === 'en' ? 'en' : 'ru';
    state.music = data.music !== false;
    state.astronaut = data.astronaut === 'male' ? 'male' : 'female';
    state.progress = data.progress ?? {};
    state.designs = cleanDesigns((data.designs ?? {}) as typeof state.designs);
    state.collection = data.collection ?? {};
    state.site = data.site === 'baikonur' || data.site === 'vostochny' ? data.site : 'ksc';
    return true;
  } catch {
    return false;
  }
}

export function saveGame(): void {
  try {
    const data: SaveData = {
      version: 1,
      lang: state.lang,
      music: state.music,
      astronaut: state.astronaut,
      progress: state.progress,
      designs: state.designs,
      collection: state.collection,
      site: state.site,
    };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full / private mode — ignore
  }
}

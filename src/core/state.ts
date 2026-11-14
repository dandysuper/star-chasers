import type { DesignSlot } from '../data/assembly';

export type Lang = 'ru' | 'en';
export type Astronaut = 'female' | 'male';

export interface RocketDesign {
  /** Part ids, index 0 = top of the rocket. Always the flattened list, so the
   *  physics and the flight scene keep working without knowing about layout. */
  parts: string[];
  /** Where each part sits: spine, or bolted to the left/right of one. Absent
   *  on saves made before the builder could build sideways — those reopen as a
   *  plain stack, which is exactly what they were. */
  slots?: DesignSlot[];
}

export interface MissionProgress {
  done: boolean;
  stars: number;
  bestTime: number | null;
}

export type Mode = 'mission' | 'sandbox';

/** The launch day picked in Mission Control; lives for the session only. */
export interface LaunchPlan {
  missionId: string | null;
  /** ISO date of the launch day. */
  date: string;
  site: 'ksc' | 'baikonur' | 'vostochny';
  /** Surface wind toward the east the flight will meet, m/s. */
  windEast: number;
  windMax: number;
  go: boolean;
  /** Moon trips: coast time and how the landing site is lit on arrival. */
  tripDays?: number;
  lighting?: 'good' | 'ok' | 'harsh' | 'dark';
  /** Where the weather came from. */
  source: 'power' | 'offline' | 'history';
  /** Re-living a real mission (Artemis II). */
  historic?: 'artemis2';
}

/** Global game state singleton. Persisted parts live in save.ts. */
class GameState {
  lang: Lang = 'ru';
  music = true;
  astronaut: Astronaut = 'female';

  /** Current mission id ('m1' | 'm2' | 'moon' | 'mars') or null in sandbox. */
  missionId: string | null = null;
  mode: Mode = 'mission';

  design: RocketDesign = { parts: [] };

  progress: Record<string, MissionProgress> = {};
  designs: Record<string, RocketDesign> = {};
  /** Launch site chosen in Mission Control (saved). */
  site: LaunchPlan['site'] = 'ksc';
  /** The launch day picked in Mission Control, if any (not saved). */
  launchPlan: LaunchPlan | null = null;
  /** Sample id → how many the player has ever brought home, across all walks. */
  collection: Record<string, number> = {};

  readonly dev: boolean;

  constructor() {
    this.dev = typeof location !== 'undefined' && /[?&]dev=1/.test(location.search);
  }

  /** Storage key under which designs are kept for the current context. */
  designKey(): string {
    return this.mode === 'sandbox' ? 'sandbox' : (this.missionId ?? 'sandbox');
  }

  missionDone(id: string): boolean {
    return this.dev || !!this.progress[id]?.done;
  }

  missionUnlocked(id: string, order: string[]): boolean {
    if (this.dev) return true;
    const idx = order.indexOf(id);
    if (idx <= 0) return true;
    return this.missionDone(order[idx - 1]);
  }

  /** Add one walk's haul to the permanent sample collection. */
  addToCollection(samples: readonly string[]): void {
    for (const id of samples) this.collection[id] = (this.collection[id] ?? 0) + 1;
  }

  recordResult(missionId: string, stars: number, time: number): void {
    const p = this.progress[missionId] ?? { done: false, stars: 0, bestTime: null };
    p.done = true;
    p.stars = Math.max(p.stars, stars);
    if (p.bestTime === null || time < p.bestTime) p.bestTime = time;
    this.progress[missionId] = p;
  }
}

export const state = new GameState();
// debug handle for the browser console; guarded so the module also imports
// under node, where the unit tests load it
if (typeof window !== 'undefined') {
  (window as unknown as { __state?: GameState }).__state = state;
}

export type Lang = 'ru' | 'en';
export type Astronaut = 'female' | 'male';

export interface RocketDesign {
  /** Part ids, index 0 = top of the rocket. */
  parts: string[];
}

export interface MissionProgress {
  done: boolean;
  stars: number;
  bestTime: number | null;
}

export type Mode = 'mission' | 'sandbox';

/** Global game state singleton. Persisted parts live in save.ts. */
class GameState {
  lang: Lang = 'ru';
  music = true;
  astronaut: Astronaut = 'female';

  /** Current mission id ('m1' | 'm2' | 'moon') or null in sandbox. */
  missionId: string | null = null;
  mode: Mode = 'mission';

  design: RocketDesign = { parts: [] };
  /** Blockly serialization JSON for the current program. */
  program: unknown = null;
  /** Last compile stats for result screen. */
  blockCount = 0;
  /** Last compile errors → highlight in Code scene. */
  errorBlockId: string | null = null;

  progress: Record<string, MissionProgress> = {};
  designs: Record<string, RocketDesign> = {};
  programs: Record<string, unknown> = {};

  readonly dev: boolean;

  constructor() {
    this.dev = typeof location !== 'undefined' && /[?&]dev=1/.test(location.search);
  }

  /** Storage key under which designs/programs are kept for the current context. */
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

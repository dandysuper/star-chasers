import { state } from './state';

const KEY = 'starchasers.save.v1';

interface SaveData {
  version: 1;
  lang: 'ru' | 'en';
  music: boolean;
  astronaut: 'female' | 'male';
  progress: typeof state.progress;
  designs: Record<string, { parts: string[] }>;
  programs: Record<string, unknown>;
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
    state.designs = (data.designs ?? {}) as typeof state.designs;
    state.programs = data.programs ?? {};
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
      programs: state.programs,
    };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full / private mode — ignore
  }
}

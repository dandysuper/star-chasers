import ru from '../i18n/ru.json';
import en from '../i18n/en.json';
import { state } from './state';

const dicts: Record<string, Record<string, string>> = { ru, en };

/** Translate a key, interpolating {var} placeholders. Falls back to EN, then the key itself. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = state.lang;
  let s = dicts[lang]?.[key] ?? dicts.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

/** Format a distance in metres for HUD (m below 10 km, km above). */
export function fmtDist(m: number): string {
  if (!isFinite(m)) return '—';
  if (Math.abs(m) < 10000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function fmtSpeed(v: number): string {
  if (!isFinite(v)) return '—';
  return `${Math.round(v)} m/s`;
}

export function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

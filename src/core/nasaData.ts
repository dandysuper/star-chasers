/**
 * nasaData.ts — live NASA open data for the mission planner.
 *
 * - **NASA POWER** (power.larc.nasa.gov, no key, CORS open): daily measured
 *   weather at the launch site from the MERRA-2 reanalysis and satellites.
 *   POWER records the past (with a few days' lag); it has no forecast. So the
 *   planner does what launch weather officers do weeks ahead: it looks at the
 *   same dates in past years. Each upcoming day shows last year's measured
 *   weather on that date and the share of the last five years that would
 *   have scrubbed. A past date (Artemis II) gets its real measured weather.
 * - **APOD** (api.nasa.gov, Astronomy Picture of the Day). DEMO_KEY allows
 *   about 30 requests an hour per visitor; the result is cached for the day.
 *
 * Every call has a timeout and a localStorage cache, and every failure falls
 * back to an offline estimate, so the planner never blocks on the network.
 */
import { weatherVerdict, type LaunchSite, type Weather } from '../data/launch';

const POWER_URL = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const APOD_URL = 'https://api.nasa.gov/planetary/apod';
/**
 * api.nasa.gov key, injected at build time from VITE_NASA_API_KEY (.env.local
 * locally, a GitHub Actions secret on deploy). A static site cannot hide it:
 * it ends up in the shipped JS, which NASA's per-key rate limit is built for.
 * Without it the shared DEMO_KEY is used (~30 requests an hour per visitor).
 */
const APOD_KEY: string = import.meta.env.VITE_NASA_API_KEY || 'DEMO_KEY';
const FILL = -999;
const DAY_MS = 86400000;
const CACHE_PREFIX = 'starchasers.nasa.';

/** yyyymmdd → weather, as measured. */
export type WeatherHistory = Record<string, Weather>;

export interface SiteWeather {
  source: 'power' | 'offline';
  history: WeatherHistory;
}

export function ymd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

/**
 * Store `value`, first dropping older entries of the same family (the part of
 * the key before its date), so a year of daily visits cannot fill storage.
 */
function writeCache(key: string, value: unknown): void {
  try {
    const family = CACHE_PREFIX + key.slice(0, key.lastIndexOf('.') + 1);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(family) && k !== CACHE_PREFIX + key) localStorage.removeItem(k);
    }
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch { /* full or private */ }
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

interface PowerResponse {
  properties?: { parameter?: Record<string, Record<string, number>> };
}

/** Turn POWER's parameter-by-date tables into one weather record per date. */
export function parsePower(json: PowerResponse): WeatherHistory {
  const p = json.properties?.parameter ?? {};
  const out: WeatherHistory = {};
  for (const date of Object.keys(p.WS10M_MAX ?? {})) {
    const v = (k: string): number | null => {
      const x = p[k]?.[date];
      return typeof x === 'number' && x !== FILL ? x : null;
    };
    const windMax = v('WS10M_MAX');
    const wind = v('WS10M');
    const rainMm = v('PRECTOTCORR');
    const tempC = v('T2M');
    if (windMax === null || rainMm === null || tempC === null) continue;
    const dir = v('WD10M');
    out[date] = {
      windMax, wind: wind ?? windMax * 0.6, rainMm, tempC,
      cloudPct: v('CLOUD_AMT') ?? 40,
      ...(dir === null ? {} : { dirDeg: dir }),
    };
  }
  return out;
}

/**
 * Five years of daily weather at the site, from POWER, cached for the day.
 * Falls back to an offline estimate when the network or the API fails.
 */
export async function loadSiteWeather(site: LaunchSite, today = new Date()): Promise<SiteWeather> {
  const key = `power.${site.id}.${ymd(today)}`;
  const cached = readCache<WeatherHistory>(key);
  if (cached && Object.keys(cached).length > 100) return { source: 'power', history: cached };

  const start = new Date(Date.UTC(today.getUTCFullYear() - 5, 0, 1));
  const end = new Date(today.getTime() - 2 * DAY_MS);
  const url = `${POWER_URL}?parameters=WS10M_MAX,WS10M,WD10M,PRECTOTCORR,T2M,CLOUD_AMT&community=RE`
    + `&latitude=${site.lat}&longitude=${site.lon}&start=${ymd(start)}&end=${ymd(end)}&format=JSON`;
  try {
    const history = parsePower((await fetchJson(url, 20000)) as PowerResponse);
    if (Object.keys(history).length < 100) throw new Error('too little data');
    writeCache(key, history);
    return { source: 'power', history };
  } catch {
    return { source: 'offline', history: {} };
  }
}

/** Measured weather on that exact date, if POWER has it. */
export function measuredOn(sw: SiteWeather, date: Date): Weather | null {
  return sw.history[ymd(date)] ?? null;
}

/** The most recent past year's weather on the same calendar date. */
export function sameDateLastYear(sw: SiteWeather, date: Date): Weather | null {
  for (let back = 1; back <= 5; back++) {
    const d = new Date(Date.UTC(date.getUTCFullYear() - back, date.getUTCMonth(), date.getUTCDate()));
    const w = sw.history[ymd(d)];
    if (w) return w;
  }
  return null;
}

/**
 * Share of past days within ±3 days of this calendar date that would have
 * scrubbed for weather, 0..1 — a small launch-weather climatology.
 */
export function scrubChance(sw: SiteWeather, site: LaunchSite, date: Date): number | null {
  let n = 0;
  let bad = 0;
  for (let back = 1; back <= 5; back++) {
    for (let k = -3; k <= 3; k++) {
      const d = new Date(Date.UTC(date.getUTCFullYear() - back, date.getUTCMonth(), date.getUTCDate() + k));
      const w = sw.history[ymd(d)];
      if (!w) continue;
      n++;
      if (weatherVerdict(w, site).reasons.length) bad++;
    }
  }
  return n ? bad / n : null;
}

// ------------------------------------------------------------- offline ---

/** Small deterministic hash → 0..1, so offline weather is stable per day. */
function rand01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * A plausible day of weather when POWER is out of reach: seasonal
 * temperature for the site's latitude, Florida's summer storms, steppe wind.
 */
export function offlineWeather(site: LaunchSite, date: Date): Weather {
  const s = `${site.id}${ymd(date)}`;
  const month = date.getUTCMonth();
  const summer = Math.cos(((month - 6) / 12) * 2 * Math.PI); // +1 July, −1 January
  const base = site.id === 'ksc' ? 22 + 5 * summer : site.id === 'baikonur' ? 10 + 18 * summer : 0 + 20 * summer;
  const stormy = site.id === 'ksc' ? 0.12 + 0.25 * Math.max(0, summer) : 0.08;
  const windy = site.id === 'ksc' ? 0.08 : 0.15;
  return {
    windMax: rand01(s + 'w') < windy ? 15 + rand01(s + 'W') * 8 : 3 + rand01(s + 'v') * 9,
    wind: 2 + rand01(s + 'm') * 5,
    rainMm: rand01(s + 'r') < stormy ? 6 + rand01(s + 'R') * 20 : rand01(s + 'd') * 2,
    cloudPct: Math.round(rand01(s + 'c') * 100),
    tempC: Math.round(base + (rand01(s + 't') - 0.5) * 8),
    dirDeg: Math.round(rand01(s + 'a') * 360),
  };
}

// ---------------------------------------------------------------- APOD ---

export interface Apod {
  date: string;
  /** Empty when NASA's feed sent a placeholder title instead of the real one. */
  title: string;
  explanation: string;
  mediaType: 'image' | 'video' | 'other';
  /** The picture or video itself; empty when the feed sent the NASA logo. */
  url: string;
  /** The day's page on apod.nasa.gov: what "Open" shows. */
  pageUrl: string;
  copyright?: string;
}

/** apod.nasa.gov/apod/apYYMMDD.html for an ISO date. */
export function apodPageUrl(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `https://apod.nasa.gov/apod/ap${y.slice(2)}${m}${d}.html`;
}

/**
 * Since the APOD site moved to science.nasa.gov the API sometimes fills a day
 * with site boilerplate: title "NASA Science" and the NASA logo as the image.
 * The explanation is still the real one, so only the title and URL are dropped.
 */
function isPlaceholder(j: Record<string, string>): { title: boolean; url: boolean } {
  return {
    title: !j.title || /^nasa science$/i.test(j.title.trim()),
    url: !j.url || /nasa-logo/i.test(j.url),
  };
}

/** Today's Astronomy Picture of the Day (or yesterday's, if today's is not out). */
export async function loadApod(today = new Date()): Promise<Apod | null> {
  const key = `apod.${ymd(today)}`;
  const cached = readCache<Apod>(key);
  if (cached && cached.pageUrl) return cached;
  for (const back of [0, 1, 2]) {
    const d = new Date(today.getTime() - back * DAY_MS);
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    try {
      const j = (await fetchJson(`${APOD_URL}?api_key=${APOD_KEY}&date=${iso}`, 10000)) as Record<string, string>;
      if (!j.explanation) continue;
      const bad = isPlaceholder(j);
      const date = j.date ?? iso;
      const apod: Apod = {
        date,
        title: bad.title ? '' : j.title,
        explanation: j.explanation.trim(),
        mediaType: j.media_type === 'image' ? 'image' : j.media_type === 'video' ? 'video' : 'other',
        url: bad.url ? '' : j.url ?? '',
        pageUrl: apodPageUrl(date),
        copyright: j.copyright?.trim(),
      };
      writeCache(key, apod);
      return apod;
    } catch { /* try the day before */ }
  }
  return null;
}

// ----------------------------------------------------------- translate ---

const TRANSLATE_URL = 'https://api.mymemory.translated.net/get';
/** MyMemory takes up to 500 bytes per request. */
const CHUNK = 450;

/** Split on sentence ends so each request stays under the size limit. */
function chunks(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > CHUNK && cur) { out.push(cur.trim()); cur = ''; }
    cur += p.length > CHUNK ? p.slice(0, CHUNK) : p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * English → Russian through the free MyMemory API (CORS open, no key).
 * Cached per text; returns null when the service is out of reach or over
 * its daily quota, and the caller keeps the English.
 */
export async function translateToRu(text: string): Promise<string | null> {
  if (!text.trim()) return '';
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  const key = `ru.${(h >>> 0).toString(36)}`;
  const cached = readCacheRaw(key);
  if (cached) return cached;
  try {
    const out: string[] = [];
    for (const c of chunks(text)) {
      const j = (await fetchJson(`${TRANSLATE_URL}?q=${encodeURIComponent(c)}&langpair=en%7Cru`, 10000)) as {
        responseStatus?: number; responseData?: { translatedText?: string };
      };
      const tr = j.responseData?.translatedText;
      if (j.responseStatus !== 200 || !tr || /MYMEMORY WARNING/i.test(tr)) return null;
      out.push(tr);
    }
    const result = out.join(' ');
    try { localStorage.setItem(CACHE_PREFIX + key, result); } catch { /* full */ }
    return result;
  } catch {
    return null;
  }
}

function readCacheRaw(key: string): string | null {
  try { return localStorage.getItem(CACHE_PREFIX + key); } catch { return null; }
}

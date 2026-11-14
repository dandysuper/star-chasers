/**
 * PlannerScene — Mission Control: pick a launch day the way NASA does.
 *
 * The player sees the Moon as it is right now, two weeks of launch days at a
 * real launch site, and for each day: go / no-go from the weather rules,
 * where the Moon will be, how long the coast takes with *their* rocket, how
 * the landing site is lit on arrival, the Δv budget and what the rocket
 * costs against the mission grant. Weather is NASA POWER data; the
 * picture of the day is NASA APOD; the Moon and Mars are computed offline.
 *
 * "Relive Artemis II" swaps the two weeks for the real launch fortnight of
 * April 2026, with the weather NASA POWER measured on those days.
 */
import Phaser from 'phaser';
import { state, type LaunchPlan } from '../core/state';
import { saveGame } from '../core/save';
import { t } from '../core/i18n';
import { moonState, daysToMarsWindow, type MoonState } from '../core/astro';
import {
  LAUNCH_SITES, SITE_ORDER, evaluateDay, bestDay, windTowardEast, ARTEMIS_II,
  type DayPlan, type Target, type Weather,
} from '../data/launch';
import {
  loadSiteWeather, measuredOn, sameDateLastYear, scrubChance, offlineWeather, loadApod, translateToRu,
  type SiteWeather, type Apod,
} from '../core/nasaData';
import { moonBudget, marsBudget } from '../physics/transfer';
import { windAt } from '../physics/sim';
import { designCost, missionGrant } from '../data/budget';
import { computeAssemblyStats } from '../physics/rocket';
import { assemblyFromDesign, assemblyFromIds } from '../data/assembly';
import { PRESET_BASIC } from '../data/parts';
import { PRESETS, presetParts, presetStats } from '../data/presets';
import { isExploreMission, missionById } from '../data/missions';
import { makeButton, makePanel, drawBar, ensureMusic, TXT } from '../ui/widgets';
import { BG } from '../ui/theme';

const DAY_MS = 86400000;
const DAYS = 14;
const LIT = 0xf2f0e6;
const DARK = 0x2a2a44;
const OUTLINE = 0x1d1b2e;

type WeatherKind = 'measured' | 'climate' | 'offline';

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
}

/** Draw the Moon's lit shape. Northern-hemisphere view: waxing = lit on the right. */
export function drawMoonPhase(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, m: MoonState): void {
  g.fillStyle(DARK, 1).fillCircle(x, y, r);
  const start = m.waxing ? -Math.PI / 2 : Math.PI / 2;
  g.fillStyle(LIT, 1);
  g.slice(x, y, r, start, start + Math.PI, false);
  g.fillPath();
  // the terminator is an ellipse: dark over the lit half for a crescent,
  // lit over the dark half for a gibbous Moon
  const ew = r * Math.abs(1 - 2 * m.illumination);
  g.fillStyle(m.illumination > 0.5 ? LIT : DARK, 1).fillEllipse(x, y, ew * 2, r * 2);
  g.lineStyle(Math.max(2, r / 20), OUTLINE, 1).strokeCircle(x, y, r);
}

export class PlannerScene extends Phaser.Scene {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private weather: SiteWeather | null = null;
  private apod: Apod | null | undefined = undefined;
  /** Russian title and text of the APOD, once translated. */
  private apodRu: { title: string; text: string } | null = null;
  private plans: DayPlan[] = [];
  private kinds: WeatherKind[] = [];
  private selected = 0;
  private start = utcMidnight(new Date());
  private reliving = false;
  private sandboxTarget: Target = 'moon';
  private alive = false;
  private loadingSite: string | null = null;

  constructor() { super('planner'); }

  create(): void {
    this.alive = true;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.alive = false; });
    ensureMusic(this, state.music);
    this.objs = [];
    this.reliving = false;
    this.start = utcMidnight(new Date());
    this.weather = null;
    this.loadWeather();
    if (this.apod === undefined) {
      void loadApod().then((a) => { this.apod = a; if (this.alive) this.render(); this.translateApod(); });
    } else {
      this.translateApod();
    }
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('hub'));
    this.input.keyboard?.on('keydown-ENTER', () => this.launch());
    this.input.keyboard?.on('keydown-LEFT', () => this.select(this.selected - 1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.select(this.selected + 1));
    this.recompute();
  }

  // ------------------------------------------------------------ model ---

  private get target(): Target {
    const m = missionById(state.missionId);
    if (!m) return this.sandboxTarget;
    return m.planet === 'mars' ? 'mars' : m.planet === 'moon' ? 'moon' : 'earth';
  }

  private get site() { return LAUNCH_SITES[state.site]; }

  /**
   * The rocket the plan is checked against: the player's last design, or for
   * a Moon / Mars walk (which has no build step) the cheapest preset that can
   * make the trip inside the grant, so the numbers describe a real option.
   */
  private rocket(): { parts: string[]; dv: number; presetId?: string } {
    const design = state.design.parts.length ? state.design : state.designs.sandbox;
    const asm = design?.parts.length ? assemblyFromDesign(design) : assemblyFromIds(PRESET_BASIC);
    const own = { parts: design?.parts.length ? design.parts : PRESET_BASIC, dv: computeAssemblyStats(asm).dvTotal };
    if (!isExploreMission(state.missionId)) return own;
    const need = this.target === 'mars' ? marsBudget(0).total : moonBudget(384400).total;
    if (own.dv >= need) return own;
    const grant = missionGrant(state.missionId) ?? Infinity;
    const fits = PRESETS
      .map((p) => ({ parts: presetParts(p), dv: presetStats(p).dvTotal, presetId: p.id }))
      .filter((r) => r.dv >= need && designCost(r.parts) <= grant)
      .sort((a, b) => designCost(a.parts) - designCost(b.parts));
    return fits[0] ?? own;
  }

  private loadWeather(): void {
    const site = this.site;
    this.loadingSite = site.id;
    void loadSiteWeather(site).then((sw) => {
      if (!this.alive || this.loadingSite !== site.id) return;
      this.weather = sw;
      this.loadingSite = null;
      this.recompute();
    });
  }

  private weatherFor(date: Date): { w: Weather; kind: WeatherKind } {
    const sw = this.weather;
    if (sw && sw.source === 'power') {
      if (date.getTime() < Date.now() - 3 * DAY_MS) {
        const m = measuredOn(sw, date);
        if (m) return { w: m, kind: 'measured' };
      }
      const ly = sameDateLastYear(sw, date);
      if (ly) return { w: ly, kind: 'climate' };
    }
    return { w: offlineWeather(this.site, date), kind: 'offline' };
  }

  private recompute(): void {
    const dv = this.rocket().dv;
    this.plans = [];
    this.kinds = [];
    for (let i = 0; i < DAYS; i++) {
      const date = new Date(this.start.getTime() + i * DAY_MS);
      const { w, kind } = this.weatherFor(date);
      this.kinds.push(kind);
      const chance = this.weather?.source === 'power' && kind !== 'measured'
        ? scrubChance(this.weather, this.site, date) : null;
      this.plans.push(evaluateDay({ date, site: this.site, target: this.target, weather: w, scrubChance: chance, rocketDv: dv }));
    }
    if (this.reliving) {
      const idx = this.plans.findIndex((p) => utcMidnight(p.date).getTime() === utcMidnight(ARTEMIS_II.launch).getTime());
      this.selected = idx >= 0 ? idx : 0;
    } else {
      const b = bestDay(this.plans);
      this.selected = b >= 0 ? b : 0;
    }
    this.render();
  }

  private select(i: number): void {
    if (i < 0 || i >= this.plans.length) return;
    this.selected = i;
    this.render();
  }

  // ----------------------------------------------------------- actions ---

  private launch(): void {
    const p = this.plans[this.selected];
    if (!p) return;
    if (!p.go) { this.toast(t('plan.blocked')); return; }
    const w = p.weather;
    const plan: LaunchPlan = {
      missionId: state.missionId,
      date: p.date.toISOString(),
      site: state.site,
      windEast: w ? windTowardEast(w) : 0,
      windMax: w?.windMax ?? 0,
      go: p.go,
      tripDays: p.trip?.enough ? p.trip.tripDays : undefined,
      lighting: p.lighting,
      source: this.kinds[this.selected] === 'offline' ? 'offline' : this.reliving ? 'history' : 'power',
      historic: this.reliving ? 'artemis2' : undefined,
    };
    state.launchPlan = plan;
    saveGame();
    this.scene.start(isExploreMission(state.missionId) ? 'explore' : 'builder');
  }

  private cycleSite(): void {
    const i = SITE_ORDER.indexOf(state.site);
    state.site = SITE_ORDER[(i + 1) % SITE_ORDER.length];
    saveGame();
    this.weather = null;
    this.loadWeather();
    this.recompute();
  }

  private toggleArtemis(): void {
    this.reliving = !this.reliving;
    if (this.reliving) {
      state.site = ARTEMIS_II.site;
      this.start = utcMidnight(new Date(ARTEMIS_II.launch.getTime() - 3 * DAY_MS));
      if (!this.weather) this.loadWeather();
    } else {
      this.start = utcMidnight(new Date());
    }
    this.recompute();
  }

  private waitForMars(): void {
    const ahead = daysToMarsWindow(this.start);
    this.start = utcMidnight(new Date(this.start.getTime() + Math.max(0, ahead - 6) * DAY_MS));
    this.reliving = false;
    this.recompute();
  }

  /** NASA writes APOD in English; fetch a Russian version for the RU game. */
  private translateApod(): void {
    const a = this.apod;
    if (!a || state.lang !== 'ru' || this.apodRu) return;
    const text = this.apodExcerpt(a);
    void Promise.all([a.title ? translateToRu(a.title) : Promise.resolve(''), translateToRu(text)]).then(([title, tr]) => {
      if (tr === null) return;
      this.apodRu = { title: title ?? a.title, text: tr };
      if (this.alive) this.render();
    });
  }

  /** The first sentences of the explanation, up to ~260 characters. */
  private apodExcerpt(a: Apod): string {
    if (a.explanation.length <= 260) return a.explanation;
    const cut = a.explanation.slice(0, 260);
    const end = cut.lastIndexOf('. ');
    return end > 120 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }

  private toast(msg: string): void {
    const { width } = this.scale;
    const txt = this.add.text(width / 2, 640, msg, {
      ...TXT.warn, fontSize: '17px', backgroundColor: '#3a1020', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(300);
    this.tweens.add({ targets: txt, alpha: 0, delay: 2200, duration: 400, onComplete: () => txt.destroy() });
  }

  // ------------------------------------------------------------ render ---

  private add2<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.objs.push(o);
    return o;
  }

  private text(x: number, y: number, s: string, style: Phaser.Types.GameObjects.Text.TextStyle = TXT.small, ox = 0): Phaser.GameObjects.Text {
    return this.add2(this.add.text(x, y, s, style).setOrigin(ox, 0));
  }

  private fmtDate(d: Date, opts: Intl.DateTimeFormatOptions): string {
    return d.toLocaleDateString(state.lang === 'ru' ? 'ru-RU' : 'en-GB', { ...opts, timeZone: 'UTC' });
  }

  private render(): void {
    for (const o of this.objs) o.destroy();
    this.objs = [];
    const { width, height } = this.scale;

    if (this.textures.exists(BG.flightSpace)) {
      this.add2(this.add.image(width / 2, height / 2, BG.flightSpace).setDisplaySize(width, height));
    }
    this.add2(this.add.rectangle(width / 2, height / 2, width, height, 0x0b0b2a, 0.6));

    // ---- header ----
    this.text(30, 18, `🛰 ${t('plan.title')}`, { ...TXT.h2, fontSize: '28px' });
    const m = missionById(state.missionId);
    const sub = `${m ? t(m.titleKey) : t('menu.sandbox')} · ${t('plan.target')}: ${t(`target.${this.target}`)} · ${t(`site.${state.site}`)}`;
    this.text(32, 56, sub, { ...TXT.small, fontSize: '15px', color: '#ffd23f' });
    if (!m) {
      this.add2(makeButton(this, width - 130, 40, `${t('plan.target')}: ${t(`target.${this.sandboxTarget}`)}`, {
        w: 220, h: 44, fontSize: 16, variant: 'purple',
        onClick: () => {
          const order: Target[] = ['moon', 'mars', 'earth'];
          this.sandboxTarget = order[(order.indexOf(this.sandboxTarget) + 1) % order.length];
          this.recompute();
        },
      }));
    }
    if (this.loadingSite) this.text(width - 260, 76, t('plan.loading'), { ...TXT.small, color: '#9ad0ff' }, 0);

    this.renderMoonPanel();
    this.renderApod();
    this.renderStrip();
    this.renderDetails();

    // ---- bottom bar ----
    const y = height - 34;
    this.add2(makeButton(this, 100, y, t('plan.back'), { w: 170, h: 46, variant: 'purple', onClick: () => this.scene.start('hub') }));
    this.add2(makeButton(this, 320, y, `🚀 ${t(`site.${state.site}`)}`, {
      w: 250, h: 46, fontSize: 16, variant: 'blue', onClick: () => this.cycleSite(),
    }));
    if (this.target === 'moon') {
      this.add2(makeButton(this, 580, y, this.reliving ? t('plan.today') : t('plan.artemis'), {
        w: 290, h: 46, fontSize: 15, variant: 'orange', onClick: () => this.toggleArtemis(),
      }));
    } else if (this.target === 'mars' && bestDay(this.plans) < 0) {
      const d = Math.round(daysToMarsWindow(this.start));
      this.add2(makeButton(this, 580, y, `${t('plan.wait_mars')} (${d})`, {
        w: 290, h: 46, fontSize: 16, variant: 'orange', onClick: () => this.waitForMars(),
      }));
    }
    this.add2(makeButton(this, 830, y, t('plan.best'), {
      w: 180, h: 46, fontSize: 16, variant: 'green',
      onClick: () => { const b = bestDay(this.plans); if (b >= 0) this.select(b); else this.toast(t('plan.blocked')); },
    }));
    const go = this.plans[this.selected]?.go;
    this.add2(makeButton(this, width - 150, y, t('plan.go'), {
      w: 270, h: 50, fontSize: 18, variant: go ? 'yellow' : 'red', onClick: () => this.launch(),
    }));
  }

  private renderMoonPanel(): void {
    const x = 24;
    const y = 90;
    const w = 400;
    const day = this.plans[this.selected]?.date ?? new Date();
    const moon = moonState(day);
    this.add2(makePanel(this, x, y, w, 230));
    this.text(x + 20, y + 16, `${t('plan.moon_on')} ${this.fmtDate(day, { day: 'numeric', month: 'long', year: 'numeric' })}`, { ...TXT.body, fontStyle: 'bold' });
    const g = this.add2(this.add.graphics());
    drawMoonPhase(g, x + 90, y + 125, 62, moon);
    const tx = x + 175;
    this.text(tx, y + 62, t(`phase.${moon.phase}`), { ...TXT.body, fontSize: '18px', color: '#ffd23f', fontStyle: 'bold', wordWrap: { width: 210 } });
    this.text(tx, y + 112, t('plan.lit', { p: Math.round(moon.illumination * 100) }), { ...TXT.small, fontSize: '15px' });
    this.text(tx, y + 136, t('plan.dist', { km: Math.round(moon.distanceKm).toLocaleString('ru-RU') }), { ...TXT.small, fontSize: '15px' });
    this.text(tx, y + 160, t('plan.age', { d: moon.ageDays.toFixed(1) }), { ...TXT.small, fontSize: '15px', wordWrap: { width: 210 } });
  }

  private renderApod(): void {
    const x = 24;
    const y = 332;
    const w = 400;
    const h = 300;
    this.add2(makePanel(this, x, y, w, h));
    this.text(x + 20, y + 16, `🔭 ${t('plan.apod')}`, { ...TXT.body, fontStyle: 'bold' });
    const a = this.apod;
    if (a === undefined) { this.text(x + 20, y + 52, t('plan.loading'), TXT.small); return; }
    if (!a) { this.text(x + 20, y + 52, t('plan.apod_none'), { ...TXT.small, wordWrap: { width: w - 40 } }); return; }
    const ru = state.lang === 'ru' ? this.apodRu : null;
    const title = (ru?.title || a.title) || t('plan.apod_untitled');
    this.text(x + 20, y + 48, title, { ...TXT.body, fontSize: '17px', color: '#ffd23f', fontStyle: 'bold', wordWrap: { width: w - 40 } });
    const expl = ru?.text ?? this.apodExcerpt(a);
    this.text(x + 20, y + 98, expl, { ...TXT.small, fontSize: '13px', color: '#cfd2ff', wordWrap: { width: w - 40 } });
    const note = state.lang === 'ru' ? (ru ? t('plan.apod_translated') : t('plan.apod_english')) : '';
    const credit = `${a.date} · NASA APOD${a.copyright ? ` · © ${a.copyright}` : ''}${note ? `\n${note}` : ''}`;
    this.text(x + 20, y + h - 44, credit, { ...TXT.small, fontSize: '12px', color: '#9a9ad0', wordWrap: { width: w - 160 } });
    this.add2(makeButton(this, x + w - 70, y + h - 30, t('plan.apod_open'), {
      w: 110, h: 38, fontSize: 15, variant: 'blue',
      // the day's APOD page: the picture, its full story and credits
      onClick: () => window.open(a.pageUrl, '_blank', 'noopener'),
    }));
  }

  private renderStrip(): void {
    const x0 = 440;
    const y = 90;
    const cw = 56;
    const gap = 2;
    this.plans.forEach((p, i) => {
      const x = x0 + i * (cw + gap);
      const sel = i === this.selected;
      const bg = this.add2(this.add.graphics());
      bg.fillStyle(sel ? 0x3a3a7a : 0x1d1d3a, 0.95).fillRoundedRect(x, y, cw, 132, 10);
      bg.lineStyle(sel ? 3 : 1, sel ? 0xffd23f : 0x3a3a66, 1).strokeRoundedRect(x, y, cw, 132, 10);
      this.text(x + cw / 2, y + 6, this.fmtDate(p.date, { weekday: 'short' }), { ...TXT.small, fontSize: '12px' }, 0.5);
      this.text(x + cw / 2, y + 22, this.fmtDate(p.date, { day: 'numeric', month: 'numeric' }), { ...TXT.small, fontSize: '13px', color: '#ffffff', fontStyle: 'bold' }, 0.5);
      drawMoonPhase(this.add2(this.add.graphics()), x + cw / 2, y + 62, 13, p.moon);
      this.text(x + cw / 2, y + 82, p.go ? '✔' : '✖', { ...TXT.body, fontSize: '20px', color: p.go ? '#7ac74f' : '#ff6b6b', fontStyle: 'bold' }, 0.5);
      this.text(x + cw / 2, y + 108, p.go ? String(p.score) : '—', { ...TXT.small, fontSize: '13px', color: p.go ? '#c8ffd0' : '#ffb3b3' }, 0.5);
      const zone = this.add2(this.add.zone(x, y, cw, 132).setOrigin(0, 0).setInteractive({ useHandCursor: true }));
      zone.on('pointerup', () => this.select(i));
    });
  }

  private renderDetails(): void {
    const p = this.plans[this.selected];
    if (!p) return;
    const x = 440;
    const y = 234;
    const w = 812;
    const h = 398;
    this.add2(makePanel(this, x, y, w, h));
    const site = this.site;
    const kind = this.kinds[this.selected];

    // ---- left column: weather and the verdict ----
    const lx = x + 20;
    let ly = y + 16;
    const row = (s: string, color = '#cfd2ff', size = 15): void => {
      const tx = this.text(lx, ly, s, { ...TXT.small, fontSize: `${size}px`, color, wordWrap: { width: 370 } });
      ly += tx.height + 6;
    };
    this.text(lx, ly, `${t('plan.weather')} · ${this.fmtDate(p.date, { day: 'numeric', month: 'long', year: 'numeric' })}`, { ...TXT.body, fontStyle: 'bold' });
    ly += 32;
    const w0 = p.weather;
    if (w0) {
      row(t('plan.wind', { w: w0.wind.toFixed(1), g: w0.windMax.toFixed(1), l: site.windLimit }));
      row(t('plan.rain', { mm: w0.rainMm.toFixed(1) }));
      row(t('plan.cloud', { p: Math.round(w0.cloudPct) }));
      row(t('plan.temp', { c: Math.round(w0.tempC), l: site.coldLimit }));
    }
    const year = p.date.getUTCFullYear() - 1;
    row(kind === 'measured' ? t('plan.src_measured') : kind === 'climate' ? t('plan.src_climate', { y: year }) : t('plan.src_offline'), '#9ad0ff', 13);
    if (p.scrubChance !== null) row(t('plan.scrub_chance', { p: Math.round(p.scrubChance * 100) }), '#9ad0ff', 13);
    ly += 6;
    row(p.go ? `✔ ${t('plan.go_day')}` : `✖ ${t('plan.nogo_day')}`, p.go ? '#7ac74f' : '#ff6b6b', 20);
    for (const r of p.reasons) row(`• ${t(`reason.${r}`)}`, '#ffb3b3');
    for (const c of p.cautions) row(`• ${t(`caution.${c}`)}`, '#ffe8a3');

    // ---- right column: the trip ----
    const rx = x + 420;
    let ry = y + 16;
    const rrow = (s: string, color = '#cfd2ff', size = 15): void => {
      const tx = this.text(rx, ry, s, { ...TXT.small, fontSize: `${size}px`, color, wordWrap: { width: 372 } });
      ry += tx.height + 6;
    };
    const rocket = this.rocket();
    this.text(rx, ry, `🚀 ${t(`target.${this.target}`)}`, { ...TXT.body, fontStyle: 'bold' });
    ry += 32;

    let budget: { label: string; game: number; real: number }[] = [];
    let total = 0;
    if (this.target === 'moon' && p.trip) {
      const b = moonBudget(p.moon.distanceKm);
      budget = [
        { label: t('plan.dv_orbit'), game: b.toOrbit, real: b.real.toOrbit },
        { label: t('plan.dv_tli'), game: b.transLunar, real: b.real.transLunar },
        { label: t('plan.dv_land'), game: b.landing, real: b.real.landing },
      ];
      total = b.total;
      if (p.trip.enough) rrow(t('plan.trip', { d: p.trip.tripDays.toFixed(1) }), '#c8ffd0', 16);
      else rrow(t('plan.trip_short', { dv: Math.round(p.trip.shortBy) }), '#ffb3b3', 16);
      if (p.arrivalMoon && p.arrivalSunElev !== undefined) {
        rrow(t('plan.arrive', { phase: t(`phase.${p.arrivalMoon.phase}`), e: Math.round(p.arrivalSunElev) }));
        rrow(t(`light.${p.lighting}`), p.lighting === 'good' ? '#7ac74f' : p.lighting === 'dark' ? '#ff6b6b' : '#ffe8a3');
      }
      if (this.reliving) rrow(t('plan.artemis_note'), '#ffd23f', 13);
    } else if (this.target === 'mars' && p.mars) {
      const b = p.mars;
      budget = [
        { label: t('plan.dv_orbit'), game: b.toOrbit, real: b.real.toOrbit },
        { label: t('plan.dv_tmi'), game: b.transMars, real: b.real.transMars },
        { label: t('plan.dv_land'), game: b.landing, real: b.real.landing },
      ];
      total = b.total;
      const off = Math.round(p.marsOffsetDays ?? 0);
      rrow(b.inWindow ? t('plan.mars_open', { d: Math.abs(off) }) : t('plan.mars_window', { d: Math.round(daysToMarsWindow(p.date)) }), b.inWindow ? '#7ac74f' : '#ffb3b3', 16);
      rrow(t('plan.mars_trip'));
    } else {
      const surface = p.weather ? windTowardEast(p.weather) : 0;
      rrow(t('plan.earth_note', { w: Math.abs(windAt(11000, surface)).toFixed(0) }));
    }

    if (budget.length) {
      ry += 4;
      rrow(t('plan.budget'), '#ffffff', 14);
      for (const b of budget) {
        rrow(`${b.label}: ${Math.round(b.game)} · ${Math.round(b.real)}`, '#cfd2ff', 14);
      }
      const g = this.add2(this.add.graphics());
      const frac = rocket.dv / total;
      drawBar(g, rx, ry + 2, 360, 16, frac, frac >= 1 ? 0x7ac74f : 0xff9a3d);
      ry += 26;
      rrow(t('plan.dv_rocket', { dv: Math.round(rocket.dv), need: Math.round(total) }), frac >= 1 ? '#7ac74f' : '#ffb3b3', 14);
    }
    if (rocket.presetId) rrow(t('plan.rocket_preset', { name: t(`preset.${rocket.presetId}.name`) }), '#9ad0ff', 13);
    const cost = designCost(rocket.parts);
    const grant = missionGrant(state.missionId);
    ry += 4;
    rrow(grant === null ? t('plan.cost_free', { c: cost }) : t('plan.cost', { c: cost, g: grant }),
      grant !== null && cost > grant ? '#ffb3b3' : '#ffe8a3', 14);
  }
}

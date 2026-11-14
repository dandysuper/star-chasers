/**
 * LabScene — examine Moon and Mars samples with two real NASA techniques.
 *
 * Each sample goes through two instruments:
 * 1. **Laser spectrometer** (LIBS, like SuperCam / ChemCam): the spectrum
 *    has peaks at real emission lines. The player switches on element
 *    markers until every peak is explained and no marker hangs over empty
 *    spectrum, then names the mineral from its formula.
 * 2. **Close-up camera** (like WATSON / MAHLI): the picture starts blurred.
 *    The player focuses it, reads the texture, and says how the rock formed.
 *
 * The first visit runs a guided tutorial on one easy sample; after that the
 * lab gives a timed challenge of three random samples. Spectra, focus and
 * grain patterns are random every round.
 */
import Phaser from 'phaser';
import { state } from '../core/state';
import { saveGame } from '../core/save';
import { makeButton, makePanel, ensureMusic, TXT, type LabelButton, type ButtonVariant } from '../ui/widgets';
import { BG } from '../ui/theme';
import type { PlanetId } from '../data/planets';
import {
  ELEMENTS, ORIGINS, INSTRUMENTS, TUTORIAL_SAMPLE, labSamplesFor, spectrumMatch, labStars, elementDef,
  type ElementId, type LabSample, type L, type Origin,
} from '../data/labSamples';

type Stage = 'spectrum' | 'identify' | 'micro' | 'origin' | 'report';
type Mode = 'tutorial' | 'challenge' | 'done';

interface Round {
  sample: LabSample;
  stage: Stage;
  picked: Set<ElementId>;
  /** Peak height per element, 0.35..1. */
  strength: Partial<Record<ElementId, number>>;
  noise: number[];
  options: LabSample[];
  focus: number;
  target: number;
  grains: { x: number; y: number; r: number; a: number; k: number }[];
}

/** One step of the guided tutorial: what to say and what the player must do. */
interface Step {
  text: L;
  /** `el:Fe` tap that element · `pick` choose the mineral · `focus` · `origin` · `next` press Next. */
  expect: string;
}

const CHALLENGE_SAMPLES = 3;
const CHALLENGE_SECONDS = 150;
const NM_MIN = 260;
const NM_MAX = 860;
const PLOT = { x: 40, y: 150, w: 700, h: 230 };
const MICRO = { x: 300, y: 330, r: 165 };
const SLIDER = { x: 560, y0: 170, y1: 490 };
const SEEN_KEY = 'lab_tutorial';

const UI: Record<string, L> = {
  title: { en: '🔬 Sample lab', ru: '🔬 Лаборатория образцов' },
  tutorial: { en: 'Tutorial', ru: 'Обучение' },
  challenge: { en: 'Challenge', ru: 'Испытание' },
  sample_n: { en: 'Sample {n} of {t}', ru: 'Образец {n} из {t}' },
  unknown: { en: 'Unknown sample', ru: 'Неизвестный образец' },
  back: { en: '← Base', ru: '← База' },
  next: { en: 'Next →', ru: 'Дальше →' },
  next_sample: { en: 'Next sample →', ru: 'Следующий образец →' },
  finish: { en: 'See results →', ru: 'Результаты →' },
  start: { en: 'Start the challenge →', ru: 'Начать испытание →' },
  replay_tut: { en: 'Tutorial again', ru: 'Обучение заново' },
  again: { en: 'Play again', ru: 'Ещё раз' },
  what_mineral: { en: 'All peaks explained! What mineral is it?', ru: 'Все пики объяснены! Что это за минерал?' },
  what_origin: { en: 'Sharp! How did this rock form?', ru: 'Резко! Как появился этот камень?' },
  focus_hint: { en: 'Drag the focus slider until the picture is sharp', ru: 'Двигай ползунок фокуса, пока картинка не станет резкой' },
  focus_label: { en: 'FOCUS', ru: 'ФОКУС' },
  peaks: { en: 'Peaks explained: {a} of {b}', ru: 'Объяснено пиков: {a} из {b}' },
  extra: { en: 'No peak under {e}: switch it off', ru: 'Под {e} нет пика — выключи его' },
  wrong: { en: 'Not quite. Look again!', ru: 'Не совсем. Посмотри ещё раз!' },
  report: { en: 'Lab report', ru: 'Отчёт лаборатории' },
  composition: { en: 'Made of', ru: 'Состав' },
  formed: { en: 'Formed by', ru: 'Образовался' },
  nasa: { en: 'Real NASA science', ru: 'Настоящая наука NASA' },
  time: { en: 'Time', ru: 'Время' },
  mistakes: { en: 'Mistakes', ru: 'Ошибки' },
  done: { en: 'Challenge complete!', ru: 'Испытание пройдено!' },
  timeout: { en: 'Time is up! The samples go back to the freezer.', ru: 'Время вышло! Образцы вернулись в морозилку.' },
  stars: { en: 'Stars', ru: 'Звёзды' },
  wavelength: { en: 'wavelength, nm', ru: 'длина волны, нм' },
  tool: { en: 'Instrument', ru: 'Прибор' },
};

function tutorialSteps(planet: PlanetId): Step[] {
  const [a, b] = planet === 'mars' ? ['Fe', 'O'] : ['H', 'O'];
  const an = elementDef(a as ElementId).name;
  return [
    {
      expect: 'next',
      text: {
        en: 'The laser hits the rock and makes a tiny spark. Its light is split into colours: this is the spectrum. Every peak is light from one chemical element.',
        ru: 'Лазер бьёт по камню, вспыхивает крошечная искра. Её свет раскладывают на цвета — это спектр. Каждый пик — свет одного химического элемента.',
      },
    },
    {
      expect: `el:${a}`,
      text: {
        en: `Each element shines at its own wavelengths. Tap ${an.en} (${a}): its marker lines will appear. Do they sit on peaks?`,
        ru: `Каждый элемент светится на своих длинах волн. Нажми «${an.ru}» (${a}) — появятся его линии. Попадают ли они на пики?`,
      },
    },
    {
      expect: `el:${b}`,
      text: {
        en: `Green lines mean "this peak is explained". Some peaks are still white. Now tap Oxygen (${b}).`,
        ru: `Зелёная линия — пик объяснён. Остались белые пики. Теперь нажми «Кислород» (${b}).`,
      },
    },
    {
      expect: 'pick',
      text: {
        en: `Every peak is green, so the rock is made of ${a} and ${b}. Pick the mineral whose formula has exactly these elements.`,
        ru: `Все пики зелёные: камень состоит из ${a} и ${b}. Выбери минерал, в формуле которого именно эти элементы.`,
      },
    },
    {
      expect: 'focus',
      text: {
        en: 'Now the close-up camera. The picture is blurry: drag the FOCUS slider up and down until it is sharp.',
        ru: 'Теперь камера крупного плана. Картинка размыта — двигай ползунок ФОКУС вверх и вниз, пока она не станет резкой.',
      },
    },
    {
      expect: 'origin',
      text: {
        en: 'Look at the shapes. Bubbles mean lava, round grains or layers mean water, six-sided crystals mean ice, sharp shards mean an impact. How did it form?',
        ru: 'Посмотри на форму. Пузырьки — лава, круглые зёрна или слои — вода, шестигранные кристаллы — лёд, острые обломки — удар метеорита. Как он появился?',
      },
    },
    {
      expect: 'next',
      text: {
        en: 'That is how real geologists work: chemistry first, then the shapes. Now try three unknown samples against the clock!',
        ru: 'Так работают настоящие геологи: сначала химия, потом форма. Теперь три неизвестных образца на время!',
      },
    },
  ];
}

export class LabScene extends Phaser.Scene {
  private planet: PlanetId = 'moon';
  private mode: Mode = 'tutorial';
  private round!: Round;
  private queue: LabSample[] = [];
  private index = 0;
  private mistakes = 0;
  private startedAt = 0;
  private finishedSec = 0;
  private timedOut = false;
  private step = 0;
  private steps: Step[] = [];
  private objs: Phaser.GameObjects.GameObject[] = [];
  private microG?: Phaser.GameObjects.Graphics;
  private knob?: Phaser.GameObjects.Arc;
  private toastObj?: Phaser.GameObjects.Text;
  private clock?: Phaser.GameObjects.Text;
  private rng = new Phaser.Math.RandomDataGenerator([String(Date.now())]);

  constructor() { super('lab'); }

  init(data: { planet?: PlanetId }): void {
    this.planet = data?.planet === 'mars' ? 'mars' : data?.planet === 'moon' ? 'moon' : this.planet;
  }

  create(): void {
    ensureMusic(this, state.music);
    this.objs = [];
    this.microG = undefined;
    this.knob = undefined;
    this.rng = new Phaser.Math.RandomDataGenerator([String(Date.now())]);
    this.input.keyboard?.on('keydown-ESC', () => this.leave());
    if (state.progress[SEEN_KEY]?.done && !state.dev) this.startChallenge();
    else this.startTutorial();
  }

  override update(): void {
    if (this.mode !== 'challenge' || !this.clock) return;
    const left = CHALLENGE_SECONDS - (this.time.now - this.startedAt) / 1000;
    this.clock.setText(`⏱ ${Math.max(0, Math.ceil(left))} s`);
    this.clock.setColor(left < 20 ? '#ff6b6b' : '#ffffff');
    if (left <= 0) {
      this.timedOut = true;
      this.finish();
    }
  }

  // ---------------------------------------------------------------- flow ---

  private tr(l: L, vars?: Record<string, string | number>): string {
    let s = l[state.lang];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }

  private ui(key: string, vars?: Record<string, string | number>): string {
    return this.tr(UI[key], vars);
  }

  private startTutorial(): void {
    this.mode = 'tutorial';
    this.steps = tutorialSteps(this.planet);
    this.step = 0;
    this.mistakes = 0;
    const s = labSamplesFor(this.planet).find((x) => x.id === TUTORIAL_SAMPLE[this.planet])!;
    this.queue = [s];
    this.index = 0;
    this.round = this.makeRound(s);
    this.render();
  }

  private startChallenge(): void {
    this.mode = 'challenge';
    this.mistakes = 0;
    this.timedOut = false;
    this.queue = this.rng.shuffle([...labSamplesFor(this.planet)]).slice(0, CHALLENGE_SAMPLES);
    this.index = 0;
    this.startedAt = this.time.now;
    this.round = this.makeRound(this.queue[0]);
    this.render();
  }

  private makeRound(sample: LabSample): Round {
    const strength: Partial<Record<ElementId, number>> = {};
    for (const e of sample.elements) strength[e] = this.rng.realInRange(0.4, 1);
    const others = this.rng.shuffle(labSamplesFor(this.planet).filter((s) => s.id !== sample.id)).slice(0, 3);
    const grains = Array.from({ length: 46 }, () => ({
      x: this.rng.realInRange(-1, 1), y: this.rng.realInRange(-1, 1),
      r: this.rng.realInRange(0.3, 1), a: this.rng.realInRange(0, Math.PI * 2), k: this.rng.frac(),
    }));
    let target = this.rng.realInRange(0.15, 0.85);
    let focus = this.rng.realInRange(0, 1);
    if (Math.abs(focus - target) < 0.35) focus = target > 0.5 ? target - 0.45 : target + 0.45;
    return {
      sample, stage: 'spectrum', picked: new Set(), strength,
      noise: Array.from({ length: 240 }, () => this.rng.frac()),
      options: this.rng.shuffle([sample, ...others]), focus, target, grains,
    };
  }

  /** In the tutorial only the expected action counts; anything else gets a nudge. */
  private allowed(action: string): boolean {
    if (this.mode !== 'tutorial') return true;
    const want = this.steps[this.step]?.expect;
    if (want === action) return true;
    this.toast(this.tr(this.steps[this.step].text).split('.')[0] + '…');
    return false;
  }

  private advanceTutorial(action: string): void {
    if (this.mode !== 'tutorial') return;
    if (this.steps[this.step]?.expect === action) this.step++;
  }

  private toggleElement(id: ElementId): void {
    const r = this.round;
    if (r.stage !== 'spectrum') return;
    if (!this.allowed(`el:${id}`)) return;
    if (r.picked.has(id)) r.picked.delete(id); else r.picked.add(id);
    this.advanceTutorial(`el:${id}`);
    const m = spectrumMatch(r.sample, r.picked);
    if (m.missing.length === 0 && m.extra.length === 0) r.stage = 'identify';
    this.render();
  }

  private pickMineral(s: LabSample): void {
    const r = this.round;
    if (r.stage !== 'identify' || !this.allowed('pick')) return;
    if (s.id !== r.sample.id) { this.wrong(); return; }
    this.advanceTutorial('pick');
    r.stage = 'micro';
    this.render();
  }

  private pickOrigin(o: Origin): void {
    const r = this.round;
    if (r.stage !== 'origin' || !this.allowed('origin')) return;
    if (o !== r.sample.origin) { this.wrong(); return; }
    this.advanceTutorial('origin');
    r.stage = 'report';
    this.render();
  }

  private wrong(): void {
    this.mistakes++;
    this.cameras.main.shake(180, 0.004);
    this.toast(this.ui('wrong'));
  }

  private nextSample(): void {
    if (this.mode === 'tutorial') {
      if (this.steps[this.step]?.expect === 'next' && this.step < this.steps.length - 1) {
        this.step++;
        this.render();
        return;
      }
      state.recordResult(SEEN_KEY, 1, 0);
      saveGame();
      this.startChallenge();
      return;
    }
    this.index++;
    if (this.index >= this.queue.length) { this.finish(); return; }
    this.round = this.makeRound(this.queue[this.index]);
    this.render();
  }

  private finish(): void {
    if (this.mode !== 'challenge') return;
    this.mode = 'done';
    this.finishedSec = (this.time.now - this.startedAt) / 1000;
    if (!this.timedOut) {
      const stars = labStars(this.mistakes, this.finishedSec, CHALLENGE_SECONDS);
      state.recordResult(`lab_${this.planet}`, stars, Math.round(this.finishedSec));
      saveGame();
    }
    this.render();
  }

  private leave(): void {
    this.scene.start('hub');
  }

  // -------------------------------------------------------------- render ---

  private keep<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.objs.push(o);
    return o;
  }

  private text(x: number, y: number, s: string, style: Phaser.Types.GameObjects.Text.TextStyle = TXT.small, ox = 0, oy = 0): Phaser.GameObjects.Text {
    return this.keep(this.add.text(x, y, s, style).setOrigin(ox, oy));
  }

  private button(x: number, y: number, label: string, w: number, variant: ButtonVariant, onClick: () => void, h = 46, fontSize = 16): LabelButton {
    return this.keep(makeButton(this, x, y, label, { w, h, fontSize, variant, onClick }));
  }

  private toast(msg: string): void {
    this.toastObj?.destroy();
    const txt = this.add.text(400, 676, msg, {
      ...TXT.warn, fontSize: '16px', backgroundColor: '#3a1020', padding: { x: 12, y: 6 }, wordWrap: { width: 640 },
    }).setOrigin(0.5).setDepth(300);
    this.toastObj = txt;
    this.tweens.add({ targets: txt, alpha: 0, delay: 1800, duration: 400, onComplete: () => txt.destroy() });
  }

  private render(): void {
    // frees the camera's mask from the previous frame
    this.events.emit('lab-rerender');
    for (const o of this.objs) o.destroy();
    this.objs = [];
    this.microG = undefined;
    this.knob = undefined;
    this.clock = undefined;
    const { width, height } = this.scale;
    if (this.textures.exists(BG.flightSpace)) {
      this.keep(this.add.image(width / 2, height / 2, BG.flightSpace).setDisplaySize(width, height));
    }
    this.keep(this.add.rectangle(width / 2, height / 2, width, height, 0x0b0b2a, 0.7));

    // ---- header ----
    this.text(28, 16, this.ui('title'), { ...TXT.h2, fontSize: '26px' });
    const sub = this.mode === 'tutorial' ? this.ui('tutorial')
      : `${this.ui('challenge')} · ${this.ui('sample_n', { n: Math.min(this.index + 1, this.queue.length), t: this.queue.length })}`;
    this.text(30, 52, `${this.planet === 'mars' ? '🔴' : '🌕'} ${sub}`, { ...TXT.small, fontSize: '15px', color: '#ffd23f' });
    for (const [i, p] of (['moon', 'mars'] as PlanetId[]).entries()) {
      const b = this.button(width - 270 + i * 130, 36, p === 'moon' ? (state.lang === 'ru' ? 'Луна' : 'Moon') : (state.lang === 'ru' ? 'Марс' : 'Mars'), 110, p === this.planet ? 'yellow' : 'purple', () => {
        if (p === this.planet) return;
        this.planet = p;
        this.scene.restart({ planet: p });
      }, 40, 20);
      void b;
    }
    if (this.mode === 'challenge') {
      this.clock = this.text(width - 470, 22, '', { ...TXT.h2, fontSize: '22px' });
      this.text(width - 470, 52, `${this.ui('mistakes')}: ${this.mistakes}`, { ...TXT.small, fontSize: '14px' });
    }

    this.button(100, height - 34, this.ui('back'), 170, 'purple', () => this.leave());

    if (this.mode === 'done') { this.renderDone(); return; }

    const r = this.round;
    const left = this.keep(makePanel(this, 20, 86, 740, 560));
    void left;
    if (r.stage === 'spectrum' || r.stage === 'identify') this.renderSpectrum();
    else if (r.stage === 'micro' || r.stage === 'origin') this.renderMicro();
    else this.renderReport();
    this.renderSide();
  }

  // ---- spectrometer ----

  private nmToX(nm: number): number {
    return PLOT.x + ((nm - NM_MIN) / (NM_MAX - NM_MIN)) * PLOT.w;
  }

  private renderSpectrum(): void {
    const r = this.round;
    const inst = INSTRUMENTS[this.planet];
    this.text(40, 100, `${this.ui('tool')}: ${this.tr(inst.spectro)}`, { ...TXT.body, fontStyle: 'bold' });
    const name = this.mode === 'tutorial' ? this.ui('unknown') : `${this.ui('unknown')} #${this.index + 1}`;
    this.text(40, 124, name, { ...TXT.small, color: '#9ad0ff' });

    const g = this.keep(this.add.graphics());
    // rainbow strip under the plot: what each wavelength looks like
    for (let px = 0; px < PLOT.w; px += 4) {
      const nm = NM_MIN + (px / PLOT.w) * (NM_MAX - NM_MIN);
      g.fillStyle(nmColor(nm), nm < 380 || nm > 750 ? 0.25 : 0.7).fillRect(PLOT.x + px, PLOT.y + PLOT.h + 4, 4, 8);
    }
    g.fillStyle(0x05051a, 1).fillRect(PLOT.x, PLOT.y, PLOT.w, PLOT.h);
    g.lineStyle(1, 0x2a2a55, 1);
    for (let nm = 300; nm <= 850; nm += 50) {
      const x = this.nmToX(nm);
      g.lineBetween(x, PLOT.y, x, PLOT.y + PLOT.h);
      if (nm % 100 === 0) this.text(x, PLOT.y + PLOT.h + 16, String(nm), { ...TXT.small, fontSize: '11px', color: '#8a8ab0' }, 0.5);
    }
    this.text(PLOT.x + PLOT.w, PLOT.y + PLOT.h + 30, this.ui('wavelength'), { ...TXT.small, fontSize: '11px', color: '#8a8ab0' }, 1);

    // the spectrum itself: narrow Gaussian peaks on a noisy baseline
    const peaks: { nm: number; h: number; el: ElementId }[] = [];
    for (const e of r.sample.elements) {
      const def = elementDef(e);
      def.lines.forEach((nm, i) => peaks.push({ nm, h: (r.strength[e] ?? 0.7) * (i === 0 ? 1 : 0.6), el: e }));
    }
    g.lineStyle(2, 0xffffff, 1);
    g.beginPath();
    const steps = 480;
    for (let i = 0; i <= steps; i++) {
      const nm = NM_MIN + (i / steps) * (NM_MAX - NM_MIN);
      let v = 0.04 + 0.03 * r.noise[i % r.noise.length];
      for (const p of peaks) v += p.h * Math.exp(-((nm - p.nm) ** 2) / (2 * 1.6 * 1.6));
      const x = PLOT.x + (i / steps) * PLOT.w;
      const y = PLOT.y + PLOT.h - Math.min(1.05, v) * (PLOT.h - 14);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokePath();

    // marker lines for the switched-on elements
    let explained = 0;
    for (const p of peaks) if (r.picked.has(p.el)) explained++;
    for (const e of r.picked) {
      const def = elementDef(e);
      const real = r.sample.elements.includes(e);
      for (const nm of def.lines) {
        const x = this.nmToX(nm);
        const col = real ? 0x7ac74f : 0xff6b6b;
        for (let y = PLOT.y; y < PLOT.y + PLOT.h; y += 10) g.lineStyle(2, col, 0.9).lineBetween(x, y, x, y + 6);
        this.text(x, PLOT.y + 4, e, { ...TXT.small, fontSize: '12px', fontStyle: 'bold', color: real ? '#7ac74f' : '#ff6b6b' }, 0.5);
      }
    }
    // a white tick over every peak nobody has explained yet
    for (const p of peaks) {
      if (r.picked.has(p.el)) continue;
      const x = this.nmToX(p.nm);
      const y = PLOT.y + PLOT.h - Math.min(1.05, p.h + 0.05) * (PLOT.h - 14) - 14;
      this.text(x, y, '▼', { ...TXT.small, fontSize: '11px', color: '#ffffff' }, 0.5);
    }
    const m = spectrumMatch(r.sample, r.picked);
    this.text(40, 412, this.ui('peaks', { a: explained, b: peaks.length }), { ...TXT.body, color: explained === peaks.length ? '#7ac74f' : '#ffffff' });
    if (m.extra.length) this.text(330, 412, this.ui('extra', { e: m.extra.join(', ') }), { ...TXT.small, fontSize: '14px', color: '#ff9a9a' });

    // element buttons, two rows of five
    ELEMENTS.forEach((def, i) => {
      const x = 106 + (i % 5) * 140;
      const y = 462 + Math.floor(i / 5) * 54;
      const on = r.picked.has(def.id);
      const b = this.button(x, y, `${def.id} · ${this.tr(def.name)}`, 132, on ? 'green' : 'blue', () => this.toggleElement(def.id), 46, 14);
      if (this.isTarget(`el:${def.id}`)) this.pulse(x, y, 136, 50);
      void b;
    });

    if (r.stage === 'identify') this.renderMineralChoice();
  }

  private renderMineralChoice(): void {
    const r = this.round;
    const d = this.keep(this.add.rectangle(390, 366, 740, 560, 0x08081a, 0.72).setInteractive());
    void d;
    this.text(390, 230, this.ui('what_mineral'), { ...TXT.h2, fontSize: '22px', color: '#7ac74f' }, 0.5);
    this.text(390, 262, `${this.ui('composition')}: ${r.sample.elements.join(' · ')}`, { ...TXT.body, color: '#ffd23f' }, 0.5);
    r.options.forEach((s, i) => {
      const x = 210 + (i % 2) * 360;
      const y = 340 + Math.floor(i / 2) * 100;
      this.button(x, y, `${this.tr(s.mineral)}\n${s.formula}`, 330, 'blue', () => this.pickMineral(s), 80, 17);
      if (this.isTarget('pick') && s.id === r.sample.id) this.pulse(x, y, 334, 84);
    });
  }

  // ---- microscope ----

  private renderMicro(): void {
    const r = this.round;
    const inst = INSTRUMENTS[this.planet];
    this.text(40, 100, `${this.ui('tool')}: ${this.tr(inst.camera)}`, { ...TXT.body, fontStyle: 'bold' });
    this.text(40, 124, `${this.tr(r.sample.mineral)} · ${r.sample.formula}`, { ...TXT.small, color: '#9ad0ff' });

    // the round field of view, masked
    const ring = this.keep(this.add.graphics());
    ring.fillStyle(0x000000, 1).fillCircle(MICRO.x, MICRO.y, MICRO.r + 12);
    this.microG = this.keep(this.add.graphics());
    const maskG = this.make.graphics({}, false);
    maskG.fillStyle(0xffffff).fillCircle(MICRO.x, MICRO.y, MICRO.r);
    this.microG.setMask(maskG.createGeometryMask());
    this.events.once('lab-rerender', () => maskG.destroy());
    const rim = this.keep(this.add.graphics());
    rim.lineStyle(10, 0x3a3a5a, 1).strokeCircle(MICRO.x, MICRO.y, MICRO.r + 4);
    rim.lineStyle(3, 0x1d1b2e, 1).strokeCircle(MICRO.x, MICRO.y, MICRO.r + 9);
    // scale bar: 1 mm
    rim.lineStyle(3, 0xffffff, 1).lineBetween(MICRO.x + 60, MICRO.y + MICRO.r - 26, MICRO.x + 120, MICRO.y + MICRO.r - 26);
    this.text(MICRO.x + 90, MICRO.y + MICRO.r - 44, '1 mm', { ...TXT.small, fontSize: '12px', color: '#ffffff', fontStyle: 'bold' }, 0.5);

    // the focus slider
    const sg = this.keep(this.add.graphics());
    sg.fillStyle(0x1d1d3a, 1).fillRoundedRect(SLIDER.x - 10, SLIDER.y0 - 10, 20, SLIDER.y1 - SLIDER.y0 + 20, 10);
    sg.lineStyle(2, 0x3fe0d0, 1).strokeRoundedRect(SLIDER.x - 10, SLIDER.y0 - 10, 20, SLIDER.y1 - SLIDER.y0 + 20, 10);
    for (let i = 0; i <= 10; i++) {
      const y = SLIDER.y0 + (i / 10) * (SLIDER.y1 - SLIDER.y0);
      sg.lineStyle(1, 0x8a8ab0, 1).lineBetween(SLIDER.x + 14, y, SLIDER.x + 22, y);
    }
    this.text(SLIDER.x, SLIDER.y0 - 36, this.ui('focus_label'), { ...TXT.small, fontSize: '13px', fontStyle: 'bold', color: '#3fe0d0' }, 0.5);
    this.knob = this.keep(this.add.circle(SLIDER.x, this.focusToY(r.focus), 20, 0xffd23f).setStrokeStyle(4, 0x1d1b2e));
    const zone = this.keep(this.add.zone(SLIDER.x - 60, SLIDER.y0 - 30, 120, SLIDER.y1 - SLIDER.y0 + 60).setOrigin(0, 0).setInteractive({ useHandCursor: true }));
    const drag = (p: Phaser.Input.Pointer): void => {
      if (!p.isDown || this.round.stage !== 'micro') return;
      this.round.focus = Phaser.Math.Clamp((p.y - SLIDER.y0) / (SLIDER.y1 - SLIDER.y0), 0, 1);
      this.knob?.setY(this.focusToY(this.round.focus));
      this.drawMicro();
    };
    zone.on('pointerdown', drag);
    zone.on('pointermove', drag);
    zone.on('pointerup', () => this.checkFocus());
    zone.on('pointerout', () => this.checkFocus());
    if (this.isTarget('focus')) this.pulse(SLIDER.x, (SLIDER.y0 + SLIDER.y1) / 2, 70, SLIDER.y1 - SLIDER.y0 + 60);
    if (r.stage === 'micro') this.text(675, 300, `↕\n${this.ui('focus_hint')}`, { ...TXT.small, fontSize: '13px', color: '#cfd2ff', align: 'center', wordWrap: { width: 130 } }, 0.5);

    this.drawMicro();

    if (r.stage === 'origin') {
      this.text(390, 530, this.ui('what_origin'), { ...TXT.h2, fontSize: '20px', color: '#7ac74f' }, 0.5);
      ORIGINS.forEach((o, i) => {
        const x = 120 + i * 180;
        this.button(x, 590, `${o.icon} ${this.tr(o.name)}`, 168, 'blue', () => this.pickOrigin(o.id), 52, 16);
        if (this.isTarget('origin') && o.id === r.sample.origin) this.pulse(x, 590, 172, 56);
      });
    }
  }

  private focusToY(f: number): number {
    return SLIDER.y0 + f * (SLIDER.y1 - SLIDER.y0);
  }

  private checkFocus(): void {
    const r = this.round;
    if (r.stage !== 'micro') return;
    if (Math.abs(r.focus - r.target) <= 0.045) {
      r.focus = r.target;
      if (this.mode === 'tutorial' && this.steps[this.step]?.expect !== 'focus') return;
      this.advanceTutorial('focus');
      r.stage = 'origin';
      this.render();
    }
  }

  /** Redraw the camera view; blur grows with the distance from perfect focus. */
  private drawMicro(): void {
    const g = this.microG;
    if (!g) return;
    const r = this.round;
    const s = r.sample;
    const defocus = Math.min(1, Math.abs(r.focus - r.target) / 0.6);
    g.clear();
    g.fillStyle(s.rock, 1).fillCircle(MICRO.x, MICRO.y, MICRO.r + 2);
    const copies = defocus < 0.06 ? 1 : 6;
    const spread = defocus * 26;
    for (let c = 0; c < copies; c++) {
      const a = (c / copies) * Math.PI * 2;
      const ox = copies === 1 ? 0 : Math.cos(a) * spread;
      const oy = copies === 1 ? 0 : Math.sin(a) * spread;
      drawTexture(g, s, r.grains, MICRO.x + ox, MICRO.y + oy, MICRO.r, copies === 1 ? 1 : 0.22);
    }
    if (defocus > 0.02) g.fillStyle(s.rock, defocus * 0.55).fillCircle(MICRO.x, MICRO.y, MICRO.r + 2);
  }

  // ---- report and side panel ----

  private renderReport(): void {
    const s = this.round.sample;
    this.text(40, 104, `📋 ${this.ui('report')}`, { ...TXT.h2, fontSize: '24px', color: '#7ac74f' });
    this.text(40, 150, this.tr(s.mineral), { ...TXT.h2, fontSize: '30px', color: '#ffd23f' });
    this.text(40, 192, s.formula, { ...TXT.body, fontSize: '22px' });
    const origin = ORIGINS.find((o) => o.id === s.origin)!;
    this.text(40, 240, `${this.ui('composition')}: ${s.elements.map((e) => `${e} (${this.tr(elementDef(e).name)})`).join(', ')}`, { ...TXT.body, wordWrap: { width: 690 } });
    this.text(40, 300, `${this.ui('formed')}: ${origin.icon} ${this.tr(origin.name)} — ${this.tr(s.clue)}`, { ...TXT.body, wordWrap: { width: 690 } });
    this.text(40, 380, `🚀 ${this.ui('nasa')}`, { ...TXT.body, fontStyle: 'bold', color: '#c8ffd0' });
    this.text(40, 410, this.tr(s.fact), { ...TXT.body, fontSize: '17px', color: '#c8ffd0', wordWrap: { width: 690 } });
    const last = this.mode === 'challenge' && this.index >= this.queue.length - 1;
    const label = this.mode === 'tutorial' ? this.ui('next') : last ? this.ui('finish') : this.ui('next_sample');
    this.button(560, 600, label, 300, 'yellow', () => this.nextSample(), 50, 18);
    if (this.mode === 'tutorial') this.pulse(560, 600, 304, 54);
  }

  private renderSide(): void {
    const x = 780;
    const y = 86;
    const w = 480;
    this.keep(makePanel(this, x, y, w, 560));
    const inst = INSTRUMENTS[this.planet];
    const r = this.round;
    const spectro = r.stage === 'spectrum' || r.stage === 'identify';
    let ty = y + 18;
    if (this.mode === 'tutorial') {
      const st = this.steps[this.step];
      this.text(x + 20, ty, `🎓 ${this.ui('tutorial')} ${this.step + 1}/${this.steps.length}`, { ...TXT.h2, fontSize: '20px', color: '#ffd23f' });
      ty += 36;
      const tt = this.text(x + 20, ty, this.tr(st.text), { ...TXT.body, fontSize: '17px', wordWrap: { width: w - 40 } });
      ty += tt.height + 16;
      if (st.expect === 'next' && r.stage !== 'report') {
        this.button(x + w / 2, ty + 24, this.step === this.steps.length - 1 ? this.ui('start') : this.ui('next'), 280, 'yellow', () => this.nextSample(), 48, 17);
        this.pulse(x + w / 2, ty + 24, 284, 52);
        ty += 70;
      }
    }
    this.text(x + 20, ty, `🛰 ${this.tr(spectro ? inst.spectro : inst.camera)}`, { ...TXT.body, fontStyle: 'bold', color: '#9ad0ff', wordWrap: { width: w - 40 } });
    ty += 30;
    this.text(x + 20, ty, this.tr(spectro ? inst.spectroFact : inst.cameraFact), { ...TXT.small, fontSize: '14px', color: '#cfd2ff', wordWrap: { width: w - 40 } });
    if (this.mode === 'challenge') {
      this.button(x + w - 110, y + 560 - 34, this.ui('replay_tut'), 190, 'purple', () => this.startTutorial(), 40, 14);
    }
  }

  private renderDone(): void {
    const { width } = this.scale;
    this.keep(makePanel(this, width / 2 - 340, 120, 680, 460));
    if (this.timedOut) {
      this.text(width / 2, 200, this.ui('timeout'), { ...TXT.h2, fontSize: '24px', color: '#ff9a9a', align: 'center', wordWrap: { width: 600 } }, 0.5);
    } else {
      const stars = labStars(this.mistakes, this.finishedSec, CHALLENGE_SECONDS);
      this.text(width / 2, 180, `🏆 ${this.ui('done')}`, { ...TXT.h2, fontSize: '30px', color: '#ffd23f' }, 0.5);
      this.text(width / 2, 250, '★'.repeat(stars) + '☆'.repeat(3 - stars), { ...TXT.title, fontSize: '64px', color: '#ffd23f' }, 0.5);
      this.text(width / 2, 330, `${this.ui('time')}: ${Math.round(this.finishedSec)} s   ·   ${this.ui('mistakes')}: ${this.mistakes}`, { ...TXT.body, fontSize: '20px' }, 0.5);
      this.text(width / 2, 380, this.queue.map((s) => `${this.tr(s.mineral)} (${s.formula})`).join('  ·  '), { ...TXT.small, fontSize: '15px', color: '#c8ffd0', align: 'center', wordWrap: { width: 620 } }, 0.5);
    }
    this.button(width / 2 - 150, 520, this.ui('again'), 260, 'yellow', () => this.startChallenge(), 50, 18);
    this.button(width / 2 + 150, 520, this.ui('replay_tut'), 260, 'blue', () => this.startTutorial(), 50, 18);
  }

  // ---- tutorial highlight ----

  private isTarget(action: string): boolean {
    return this.mode === 'tutorial' && this.steps[this.step]?.expect === action;
  }

  private pulse(x: number, y: number, w: number, h: number): void {
    const g = this.keep(this.add.graphics().setDepth(50));
    g.lineStyle(4, 0xffd23f, 1).strokeRoundedRect(x - w / 2, y - h / 2, w, h, 14);
    this.tweens.add({ targets: g, alpha: 0.25, duration: 520, yoyo: true, repeat: -1 });
  }
}

/** Approximate visible colour of a wavelength, for the rainbow strip. */
function nmColor(nm: number): number {
  const c = Phaser.Display.Color.HSVToRGB(Phaser.Math.Clamp((700 - nm) / 400, 0, 0.8), 0.85, 1) as Phaser.Types.Display.ColorObject;
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
}

/** Draw one sample's texture into the round field of view. */
function drawTexture(
  g: Phaser.GameObjects.Graphics, s: LabSample, grains: Round['grains'],
  cx: number, cy: number, R: number, alpha: number,
): void {
  const at = (q: { x: number; y: number }) => ({ x: cx + q.x * R, y: cy + q.y * R });
  const dark = Phaser.Display.Color.IntegerToColor(s.grain).darken(30).color;
  switch (s.texture) {
    case 'vesicles':
      for (const q of grains) {
        const p = at(q);
        const r = 4 + q.r * 13;
        g.fillStyle(s.grain, alpha).fillCircle(p.x, p.y, r);
        g.lineStyle(2, 0x9a9aa8, alpha * 0.8).beginPath();
        g.arc(p.x, p.y, r, Math.PI * 0.9, Math.PI * 1.6);
        g.strokePath();
      }
      break;
    case 'layers': {
      for (let i = -8; i <= 8; i++) {
        const y = cy + i * (R / 7.5);
        g.fillStyle(i % 2 === 0 ? s.grain : s.rock, alpha).fillRect(cx - R, y, R * 2, R / 7.5);
      }
      for (const q of grains) {
        const p = at(q);
        g.fillStyle(dark, alpha * 0.7).fillCircle(p.x, p.y, 1.5 + q.r * 2);
      }
      break;
    }
    case 'spherules':
      for (const q of grains.slice(0, 26)) {
        const p = at(q);
        const r = 7 + q.r * 9;
        g.fillStyle(s.grain, alpha).fillCircle(p.x, p.y, r);
        g.fillStyle(0xffffff, alpha * 0.45).fillCircle(p.x - r * 0.35, p.y - r * 0.35, r * 0.3);
      }
      break;
    case 'beads':
      for (const q of grains) {
        const p = at(q);
        const r = 4 + q.r * 6;
        g.fillStyle(s.grain, alpha).fillCircle(p.x, p.y, r);
        g.fillStyle(0xfff0c0, alpha * 0.7).fillCircle(p.x - r * 0.3, p.y - r * 0.3, r * 0.35);
      }
      break;
    case 'ice':
      for (const q of grains.slice(0, 22)) {
        const p = at(q);
        const r = 10 + q.r * 16;
        const pts: Phaser.Math.Vector2[] = [];
        for (let k = 0; k < 6; k++) pts.push(new Phaser.Math.Vector2(p.x + Math.cos(q.a + (k * Math.PI) / 3) * r, p.y + Math.sin(q.a + (k * Math.PI) / 3) * r));
        g.fillStyle(s.grain, alpha * 0.85).fillPoints(pts, true);
        g.lineStyle(2, 0x6aa0e0, alpha).strokePoints(pts, true);
      }
      break;
    case 'cubes':
      for (const q of grains.slice(0, 30)) {
        const p = at(q);
        const r = 6 + q.r * 11;
        g.fillStyle(s.grain, alpha).fillRect(p.x - r, p.y - r, r * 2, r * 2);
        g.lineStyle(2, dark, alpha).strokeRect(p.x - r, p.y - r, r * 2, r * 2);
        g.lineStyle(1, 0xffffff, alpha * 0.8).lineBetween(p.x - r, p.y - r, p.x + r, p.y - r);
      }
      break;
    case 'laths':
      for (const q of grains.slice(0, 30)) {
        const p = at(q);
        const len = 18 + q.r * 26;
        const wid = 4 + q.k * 4;
        const dx = Math.cos(q.a);
        const dy = Math.sin(q.a);
        const pts = [
          new Phaser.Math.Vector2(p.x - dx * len - dy * wid, p.y - dy * len + dx * wid),
          new Phaser.Math.Vector2(p.x + dx * len - dy * wid, p.y + dy * len + dx * wid),
          new Phaser.Math.Vector2(p.x + dx * len + dy * wid, p.y + dy * len - dx * wid),
          new Phaser.Math.Vector2(p.x - dx * len + dy * wid, p.y - dy * len - dx * wid),
        ];
        g.fillStyle(s.grain, alpha).fillPoints(pts, true);
        g.lineStyle(1, 0xffffff, alpha * 0.6).strokePoints(pts, true);
      }
      break;
    case 'shards':
      for (const q of grains.slice(0, 28)) {
        const p = at(q);
        const r = 9 + q.r * 18;
        const pts: Phaser.Math.Vector2[] = [];
        const n = 3 + Math.floor(q.k * 2);
        for (let k = 0; k < n; k++) {
          const a = q.a + (k / n) * Math.PI * 2 + q.k;
          const rr = r * (0.6 + ((k * 37) % 10) / 25);
          pts.push(new Phaser.Math.Vector2(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr));
        }
        g.fillStyle(q.k > 0.5 ? s.grain : 0x8a8890, alpha).fillPoints(pts, true);
        g.lineStyle(2, 0x111118, alpha).strokePoints(pts, true);
      }
      break;
  }
}

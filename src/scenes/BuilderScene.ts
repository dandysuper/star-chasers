import Phaser from 'phaser';
import { state } from '../core/state';
import { saveGame } from '../core/save';
import { t } from '../core/i18n';
import { partDef, PART_IDS, PRESET_BASIC } from '../data/parts';
import { missionById } from '../data/missions';
import { computeStats, MAX_PARTS } from '../physics/rocket';
import { makeButton, makeIconButton, makePanel, ensureMusic, TXT, drawBar, type LabelButton } from '../ui/widgets';
import { addPart, partMetrics, makePartInteractive, BG, V2, UI_V2_ART, hasV2 } from '../ui/theme';

type PartGO = Phaser.GameObjects.Image | Phaser.GameObjects.Container;

interface PlacedPart {
  id: string;
  go: PartGO | null;
  index: number;
}

const PAL_W = 272;          // palette panel width
const CELL_W = 124;         // palette card
const CELL_H = 86;
const COLS = 2;
const WORK_X = 620;         // workspace anchor on screen
const WORK_Y = 90;
const STATS_W = 306;

export class BuilderScene extends Phaser.Scene {
  private placed: PlacedPart[] = [];   // index 0 = TOP
  private statsPanel?: Phaser.GameObjects.Container;
  private stagePanel?: Phaser.GameObjects.Container;
  private warnPanel?: Phaser.GameObjects.Container;
  private workspace!: Phaser.GameObjects.Container;
  private selected: PlacedPart | null = null;
  private removeBtn?: LabelButton;
  private dragGhost?: PartGO;
  private snapHi?: Phaser.GameObjects.Graphics;
  private camZoom = 1;
  private camPan = { x: 0, y: 0 };
  private stackTopY = 0;
  private snapTopY = 0;
  private snapBottomY = 0;
  private isPanningBg = false;

  constructor() { super('builder'); }

  create(): void {
    ensureMusic(this, state.music);
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(0x12122b);

    // ---- workshop backdrop ----
    if (this.textures.exists(BG.builder)) {
      this.add.image(width / 2, height / 2, BG.builder).setDisplaySize(width, height).setAlpha(0.5);
      this.add.rectangle(width / 2, height / 2, width, height, 0x0d0d22, 0.45);
    }

    // workspace = pannable/zoomable container holding grid + parts
    this.workspace = this.add.container(WORK_X, WORK_Y);
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x252549, 0.7);
    for (let x = -700; x <= 700; x += 40) grid.lineBetween(x, -120, x, height + 400);
    for (let y = -120; y <= height + 400; y += 40) grid.lineBetween(-700, y, 700, y);
    this.workspace.add(grid);

    // load saved design
    const key = state.designKey();
    const saved = state.designs[key];
    const mission = missionById(state.missionId);
    const ids = saved?.parts?.length
      ? saved.parts.filter((id) => !mission || mission.allowedParts.includes(id))
      // sandbox with no saved design starts from the working preset, so the
      // player never faces an empty grid wondering what a rocket looks like
      : (mission ? PRESET_BASIC.filter((id) => mission.allowedParts.includes(id)) : [...PRESET_BASIC]);
    this.placed = ids.map((id, i) => ({ id, go: null, index: i }));
    this.rebuildStack();
    this.buildPalette(mission?.allowedParts ?? PART_IDS);
    this.refreshStats();

    // ---- on-screen zoom & delete controls for touchscreens ----
    this.buildTouchToolbar();

    // ---- bottom bar ----
    const bar = this.add.graphics();
    bar.fillStyle(0x1d1d3a, 0.96).fillRect(0, height - 64, width, 64);
    bar.lineStyle(2, 0x1d1b2e).lineBetween(0, height - 64, width, height - 64);
    makeButton(this, 95, height - 32, t('builder.back'), { w: 160, h: 46, variant: 'purple', onClick: () => this.scene.start('hub') });
    makeButton(this, width - 150, height - 32, t('builder.next'), { w: 280, h: 48, fontSize: 20, variant: 'yellow', onClick: () => this.next() });
    makeButton(this, width - 430, height - 32, t('builder.preset'), { w: 190, h: 44, variant: 'blue', onClick: () => this.applyPreset(mission) });
    makeButton(this, width - 600, height - 32, t('builder.clear'), { w: 140, h: 44, variant: 'red', onClick: () => this.clear() });
    if (hasV2(this, UI_V2_ART.cursorHand)) {
      this.add.image(198, height - 32, V2, UI_V2_ART.cursorHand).setDisplaySize(22, 25);
    }
    this.add.text(hasV2(this, UI_V2_ART.cursorHand) ? 214 : 190, height - 32, t('builder.hint_drag'), {
      ...TXT.small, fontSize: '12px', color: '#9a9ad0', wordWrap: { width: 320 },
    }).setOrigin(0, 0.5);

    this.input.keyboard?.on('keydown-DELETE', () => this.deleteSelected());
    this.input.keyboard?.on('keydown-BACKSPACE', () => this.deleteSelected());

    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.camZoom = Phaser.Math.Clamp(this.camZoom - Math.sign(dy) * 0.1, 0.4, 2.2);
      this.applyCam();
    });

    // Panning: right-drag on desktop, or single-finger drag in the middle
    // canvas area when not dragging a part
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
      if (this.dragGhost) return;
      const inCenter = p.x > PAL_W + 8 && p.x < width - STATS_W - 20 && p.y < height - 68;
      if (p.rightButtonDown() || (inCenter && currentlyOver.length === 0)) {
        this.isPanningBg = true;
      }
    });
    this.input.on('pointerup', () => { this.isPanningBg = false; });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if ((p.rightButtonDown() || this.isPanningBg) && p.isDown && !this.dragGhost) {
        this.camPan.x += p.position.x - p.prevPosition.x;
        this.camPan.y += p.position.y - p.prevPosition.y;
        this.applyCam();
      }
    });
  }

  private buildTouchToolbar(): void {
    const { height } = this.scale;
    const x0 = PAL_W + 34;
    const y0 = height - 98;
    makeButton(this, x0, y0, '+', {
      w: 44, h: 40, fontSize: 22, variant: 'blue',
      onClick: () => {
        this.camZoom = Phaser.Math.Clamp(this.camZoom + 0.15, 0.4, 2.2);
        this.applyCam();
      },
    });
    makeButton(this, x0 + 52, y0, '−', {
      w: 44, h: 40, fontSize: 22, variant: 'blue',
      onClick: () => {
        this.camZoom = Phaser.Math.Clamp(this.camZoom - 0.15, 0.4, 2.2);
        this.applyCam();
      },
    });
    makeIconButton(this, x0 + 104, y0, 'ico_reset', () => {
      this.camZoom = 1;
      this.camPan = { x: 0, y: 0 };
      this.applyCam();
    }, 40);

    // Contextual remove button when a stacked part is tapped/selected
    this.removeBtn = makeButton(this, x0 + 210, y0, `✕ ${t('builder.remove_selected')}`, {
      w: 148, h: 40, fontSize: 15, variant: 'red',
      onClick: () => this.deleteSelected(),
    });
    this.updateRemoveBtn();
  }

  private updateRemoveBtn(): void {
    const on = !!this.selected;
    this.removeBtn?.setVisible(on);
    if (this.removeBtn?.hitZone) {
      if (on) this.removeBtn.hitZone.setInteractive();
      else this.removeBtn.hitZone.disableInteractive();
    }
  }

  private applyCam(): void {
    this.workspace.setScale(this.camZoom);
    this.workspace.x = WORK_X + this.camPan.x;
    this.workspace.y = WORK_Y + this.camPan.y;
  }

  private worldPoint(p: Phaser.Input.Pointer): { x: number; y: number } {
    return {
      x: (p.x - this.workspace.x) / this.camZoom,
      y: (p.y - this.workspace.y) / this.camZoom,
    };
  }

  // ---------------- palette ----------------

  private buildPalette(allowed: string[]): void {
    const { height } = this.scale;
    const pal = this.add.graphics();
    pal.fillStyle(0x161634, 0.96).fillRect(0, 0, PAL_W, height - 64);
    pal.lineStyle(2, 0x1d1b2e).lineBetween(PAL_W, 0, PAL_W, height);
    if (hasV2(this, UI_V2_ART.iconWrench)) {
      this.add.image(28, 26, V2, UI_V2_ART.iconWrench).setDisplaySize(24, 24);
    }
    this.add.text(PAL_W / 2, 26, t('builder.palette'), TXT.h2).setOrigin(0.5);

    const startX = PAL_W / 2 - (COLS * CELL_W) / 2 + CELL_W / 2;
    allowed.forEach((id, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = startX + col * CELL_W;
      const cy = 78 + row * CELL_H;
      this.buildPaletteCard(id, cx, cy);
    });
  }

  private buildPaletteCard(id: string, cx: number, cy: number): void {
    const d = partDef(id);
    const card = this.add.container(cx, cy);
    const bg = this.add.graphics();
    bg.fillStyle(0x2b2d5c, 1).lineStyle(3, 0x1d1b2e);
    bg.fillRoundedRect(-CELL_W / 2 + 2, -CELL_H / 2 + 2, CELL_W - 4, CELL_H - 4, 10);
    bg.strokeRoundedRect(-CELL_W / 2 + 2, -CELL_H / 2 + 2, CELL_W - 4, CELL_H - 4, 10);
    card.add(bg);

    // part art, fitted into a 40×56 box on the left
    const m = partMetrics(this, id);
    const art = addPart(this, id, 0, 0);
    const fit = Math.min(38 / m.w, 54 / m.h);
    // Images store their size as a display scale, Containers as a transform —
    // setScale would clobber the former, so branch on the type.
    if (art instanceof Phaser.GameObjects.Image) {
      art.setDisplaySize(m.w * fit, m.h * fit);
    } else {
      art.setScale(fit);
    }
    art.setPosition(-CELL_W / 2 + 30, 0);
    card.add(art);

    card.add(this.add.text(-CELL_W / 2 + 56, -26, t(`part.${id}.name`), {
      ...TXT.small, fontSize: '12px', color: '#fff', fontStyle: 'bold', wordWrap: { width: 62 },
    }).setOrigin(0, 0));
    card.add(this.add.text(-CELL_W / 2 + 56, 4, `${d.massDry} kg`, {
      ...TXT.small, fontSize: '11px', color: '#ffd23f',
    }).setOrigin(0, 0));
    const stat = d.kind === 'engine' ? `${(d.thrustVac! / 1000)} kN` : d.kind === 'tank' ? `${d.fuel} kg` : '';
    if (stat) {
      card.add(this.add.text(-CELL_W / 2 + 56, 20, stat, { ...TXT.small, fontSize: '10px', color: '#9fe8ff' }).setOrigin(0, 0));
    }

    card.setInteractive(new Phaser.Geom.Rectangle(-CELL_W / 2, -CELL_H / 2, CELL_W, CELL_H), Phaser.Geom.Rectangle.Contains);
    if (card.input) card.input.cursor = 'pointer';
    card.on('pointerover', () => { bg.clear(); bg.fillStyle(0x3d3f7a, 1).lineStyle(3, 0xffd23f); bg.fillRoundedRect(-CELL_W / 2 + 2, -CELL_H / 2 + 2, CELL_W - 4, CELL_H - 4, 10); bg.strokeRoundedRect(-CELL_W / 2 + 2, -CELL_H / 2 + 2, CELL_W - 4, CELL_H - 4, 10); });
    card.on('pointerout', () => { bg.clear(); bg.fillStyle(0x2b2d5c, 1).lineStyle(3, 0x1d1b2e); bg.fillRoundedRect(-CELL_W / 2 + 2, -CELL_H / 2 + 2, CELL_W - 4, CELL_H - 4, 10); bg.strokeRoundedRect(-CELL_W / 2 + 2, -CELL_H / 2 + 2, CELL_W - 4, CELL_H - 4, 10); });
    card.on('pointerdown', (p: Phaser.Input.Pointer) => this.startDrag(id, p));
  }

  // ---------------- drag & drop ----------------

  private startDrag(id: string, p: Phaser.Input.Pointer): void {
    this.isPanningBg = false;
    const startX = p.x;
    const startY = p.y;
    this.dragGhost = addPart(this, id, p.x, p.y);
    this.dragGhost.setDepth(100).setAlpha(0.85);

    const move = (ptr: Phaser.Input.Pointer) => {
      this.dragGhost?.setPosition(ptr.x, ptr.y);
      this.highlightSnap(this.worldPoint(ptr), id);
    };
    const up = (ptr: Phaser.Input.Pointer) => {
      this.input.off('pointermove', move);
      this.input.off('pointerup', up);
      const wp = this.worldPoint(ptr);
      this.unhighlightSnap();
      const placed = this.tryPlace(id, wp);
      // Quick tap on a palette card (without dragging to the stack) auto-attaches
      // the part to its natural end (nose on top, everything else on bottom)
      if (!placed && Math.hypot(ptr.x - startX, ptr.y - startY) < 18) {
        const d = partDef(id);
        const autoTarget: 'top' | 'bottom' = d.kind === 'nose' ? 'top' : 'bottom';
        this.tryPlaceAt(id, autoTarget);
      }
      this.dragGhost?.destroy();
      this.dragGhost = undefined;
    };
    this.input.on('pointermove', move);
    this.input.on('pointerup', up);
  }

  private partHeight(id: string): number {
    return partMetrics(this, id).h;
  }

  private rebuildStack(): void {
    for (const pp of this.placed) pp.go?.destroy();
    this.placed.forEach((p, i) => { p.index = i; });
    let y = this.stackTopY;
    for (const pp of this.placed) {
      const m = partMetrics(this, pp.id);
      const go = addPart(this, pp.id, 0, y + m.h / 2);
      makePartInteractive(go, m.w, m.h);
      go.on('pointerdown', () => this.select(pp));
      this.workspace.add(go);
      pp.go = go;
      y += m.h;
    }
    this.snapTopY = this.placed.length ? this.stackTopY - 22 : this.stackTopY + 10;
    this.snapBottomY = y + 22;
  }

  private snapTarget(wp: { x: number; y: number }): 'top' | 'bottom' | null {
    if (Math.abs(wp.x) > 100) return null;
    const dTop = Math.abs(wp.y - this.snapTopY);
    const dBot = Math.abs(wp.y - this.snapBottomY);
    const lim = 80;
    if (dTop < lim && dTop <= dBot) return 'top';
    if (dBot < lim) return 'bottom';
    return null;
  }

  private highlightSnap(wp: { x: number; y: number }, id: string): void {
    this.unhighlightSnap();
    const tgt = this.snapTarget(wp);
    if (!tgt) return;
    const err = this.validatePlace(id, tgt);
    const g = this.add.graphics();
    g.lineStyle(3, err ? 0xff6b6b : 0x7ac74f, 1);
    const y = tgt === 'top' ? this.snapTopY - 18 : this.snapBottomY - 18;
    g.strokeRoundedRect(-PART_HALF_W, y, PART_HALF_W * 2, 36, 8);
    this.snapHi = g;
    this.workspace.add(g);
  }

  private unhighlightSnap(): void {
    this.snapHi?.destroy();
    this.snapHi = undefined;
  }

  private validatePlace(id: string, where: 'top' | 'bottom'): string | null {
    if (this.placed.length >= MAX_PARTS) return 'warn.max_parts';
    const d = partDef(id);
    if (d.kind === 'nose' && where !== 'top') return 'warn.nose_top';
    if (d.kind === 'engine') {
      if (where !== 'bottom') return 'warn.engine_attach';
      if (this.placed.length === 0) return 'warn.engine_attach';
      const above = partDef(this.placed[this.placed.length - 1].id).kind;
      if (above !== 'tank' && above !== 'decoupler') return 'warn.engine_attach';
    }
    if (where === 'top' && this.placed.length > 0 && partDef(this.placed[0].id).kind === 'nose') {
      return 'warn.nose_top';
    }
    return null;
  }

  private tryPlace(id: string, wp: { x: number; y: number }): boolean {
    const tgt = this.snapTarget(wp);
    if (!tgt) return false;
    return this.tryPlaceAt(id, tgt);
  }

  private tryPlaceAt(id: string, tgt: 'top' | 'bottom'): boolean {
    const err = this.validatePlace(id, tgt);
    if (err) { this.flashWarn(err); return false; }
    const pp: PlacedPart = { id, go: null, index: 0 };
    if (tgt === 'top') this.placed.unshift(pp); else this.placed.push(pp);
    this.rebuildStack();
    this.refreshStats();
    this.saveDesign();
    return true;
  }

  private select(pp: PlacedPart): void {
    if (this.selected) this.selected.go?.setAlpha(1);
    this.selected = pp;
    pp.go?.setAlpha(0.55);
    this.updateRemoveBtn();
  }

  private deleteSelected(): void {
    if (!this.selected) return;
    this.placed = this.placed.filter((p) => p !== this.selected);
    this.selected = null;
    this.updateRemoveBtn();
    this.rebuildStack();
    this.refreshStats();
    this.saveDesign();
  }

  private applyPreset(mission: ReturnType<typeof missionById>): void {
    const parts = mission ? PRESET_BASIC.filter((id) => mission.allowedParts.includes(id)) : PRESET_BASIC;
    this.placed = parts.map((id, i) => ({ id, go: null, index: i }));
    this.selected = null;
    this.updateRemoveBtn();
    this.rebuildStack();
    this.refreshStats();
    this.saveDesign();
  }

  private clear(): void {
    this.placed = [];
    this.selected = null;
    this.updateRemoveBtn();
    this.rebuildStack();
    this.refreshStats();
    this.saveDesign();
  }

  private flashWarn(key: string): void {
    const { width } = this.scale;
    const msg = this.add.text(width / 2, 44, t(key), {
      ...TXT.warn, backgroundColor: '#3a1020', padding: { x: 14, y: 8 },
    }).setOrigin(0.5, 0).setDepth(200);
    this.tweens.add({ targets: msg, alpha: 0, delay: 2400, duration: 400, onComplete: () => msg.destroy() });
  }

  // ---------------- stats ----------------

  private refreshStats(): void {
    this.statsPanel?.destroy();
    this.warnPanel?.destroy();
    this.stagePanel?.destroy();

    const { width } = this.scale;
    const stats = computeStats(this.placed.map((p) => p.id));
    const mission = missionById(state.missionId);
    const px = width - STATS_W - 16;

    // ---- flight numbers ----
    const c = this.add.container(px, 20);
    this.statsPanel = c;
    c.add(makePanel(this, 0, 0, STATS_W, 236));
    if (hasV2(this, UI_V2_ART.iconGear)) {
      c.add(this.add.image(28, 26, V2, UI_V2_ART.iconGear).setDisplaySize(22, 22));
    }
    c.add(this.add.text(STATS_W / 2, 14, t('builder.stats'), TXT.h2).setOrigin(0.5, 0));

    const rows: [string, string][] = [
      [t('stats.mass'), `${Math.round(stats.mass)} kg`],
      [t('stats.dv'), `${Math.round(stats.dvTotal)} m/s`],
      [t('stats.twr'), stats.twr.toFixed(2)],
      [t('stats.fuel'), `${Math.round(stats.fuelTotal)} kg`],
    ];
    rows.forEach(([k, v], i) => {
      const isFuel = i === 3 && hasV2(this, UI_V2_ART.iconFuel);
      if (isFuel) {
        c.add(this.add.image(24, 52 + i * 26, V2, UI_V2_ART.iconFuel).setDisplaySize(16, 19));
      }
      c.add(this.add.text(isFuel ? 38 : 16, 52 + i * 26, k, TXT.small).setOrigin(0, 0.5));
      c.add(this.add.text(STATS_W - 16, 52 + i * 26, v, { ...TXT.body, fontSize: '15px' }).setOrigin(1, 0.5));
    });

    c.add(this.add.text(16, 52 + rows.length * 26 + 6, stats.stable ? t('stats.stable') : t('stats.wobbly'), {
      ...TXT.small, color: stats.stable ? '#7ac74f' : '#ffb3b3',
    }).setOrigin(0, 0.5));

    // Δv bar vs mission need
    const need = mission?.dvNeed ?? 3000;
    const frac = stats.dvTotal / need;
    const barY = 52 + rows.length * 26 + 34;
    const g = this.add.graphics();
    c.add(g);
    drawBar(g, 16, barY, STATS_W - 32, 16, frac, frac >= 1 ? 0x7ac74f : 0xff9a3d);
    if (mission) {
      c.add(this.add.text(16, barY + 24, t('stats.dv_need', { dv: mission.dvNeed }), {
        ...TXT.small, fontSize: '12px', color: '#cfd2ff',
      }).setOrigin(0, 0.5));
    }

    // ---- stages ----
    const sc = this.add.container(px, 272);
    this.stagePanel = sc;
    sc.add(makePanel(this, 0, 0, STATS_W, 96 + stats.stages.length * 24));
    if (hasV2(this, UI_V2_ART.iconRocket)) {
      sc.add(this.add.image(26, 24, V2, UI_V2_ART.iconRocket).setDisplaySize(20, 24));
    }
    sc.add(this.add.text(hasV2(this, UI_V2_ART.iconRocket) ? 42 : 16, 12, t('builder.stages'), TXT.h2).setOrigin(0, 0));
    let sy = 44;
    stats.stages.forEach((st, i) => {
      const s = t('stats.stage_n', { n: i + 1, dv: Math.round(st.dv), t: st.burn.toFixed(0) });
      sc.add(this.add.text(16, sy, s, TXT.small).setOrigin(0, 0.5));
      sy += 24;
    });

    // ---- warnings + mission hint ----
    const wc = this.add.container(px, 272 + 110 + stats.stages.length * 24);
    this.warnPanel = wc;
    let wy = 0;
    for (const w of stats.warnings) {
      const txt = this.add.text(0, wy, `⚠ ${t(w.key, w.vars)}`, { ...TXT.warn, wordWrap: { width: STATS_W } }).setOrigin(0, 0);
      wc.add(txt);
      wy += txt.height + 6;
    }
    const hintKey = mission?.hintKeys?.[0];
    if (hintKey) {
      const hint = this.add.text(0, wy + 6, `💡 ${t(hintKey)}`, {
        ...TXT.small, fontSize: '13px', color: '#ffe8a3', wordWrap: { width: STATS_W },
      }).setOrigin(0, 0);
      wc.add(hint);
    }
  }

  private saveDesign(): void {
    state.design.parts = this.placed.map((p) => p.id);
    state.designs[state.designKey()] = { parts: state.design.parts };
    saveGame();
  }

  private next(): void {
    const stats = computeStats(this.placed.map((p) => p.id));
    if (stats.blocking) {
      this.flashWarn(stats.warnings[0]?.key ?? 'warn.no_engine');
      return;
    }
    this.saveDesign();
    this.scene.start('code');
  }
}

const PART_HALF_W = 46;

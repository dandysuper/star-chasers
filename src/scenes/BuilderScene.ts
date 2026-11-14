import { designCost, missionGrant } from '../data/budget';
import Phaser from 'phaser';
import { state } from '../core/state';
import { saveGame } from '../core/save';
import { t } from '../core/i18n';
import { partDef, PART_IDS, PRESET_BASIC } from '../data/parts';
import { MISSIONS, missionById } from '../data/missions';
import { computeAssemblyStats, MAX_PARTS } from '../physics/rocket';
import {
  PRESETS, presetAllowed, presetParts, presetStats, predictFlight, type RocketPreset,
} from '../data/presets';
import { buildRocketArt, fitRocketArt } from '../ui/rocketArt';
import {
  appendToSide, assemblyCount, assemblyFromIds, columnAt, emptyAssembly, flatten,
  allNodes, fromSlots, insertAtBottom, insertAtTop, makeNode, removeNode, toSlots,
  type Assembly, type Node, type Side,
} from '../data/assembly';
import { makeButton, makeIconButton, makePanel, ensureMusic, TXT, drawBar, type LabelButton } from '../ui/widgets';
import { InGameMenu } from '../ui/ingameMenu';
import { addPart, partMetrics, BG, V2, UI_V2_ART, hasV2, bellDrop, addStarRow } from '../ui/theme';
import { PART_W } from '../ui/partArt';
import { fitInto } from '../ui/overhaul';
import { PART_INFO, partFacts } from '../data/partInfo';

type PartGO = Phaser.GameObjects.Image | Phaser.GameObjects.Container;

/** Where a drop is heading: an end of the core stack, or the flank of one part. */
type Target =
  | { kind: 'top' }
  | { kind: 'bottom' }
  | { kind: 'side'; hostUid: number; side: Side };

interface Rect { x: number; y: number; w: number; h: number }

interface Layout {
  pos: Map<number, Rect>;
  spine: { node: Node; rect: Rect }[];
  /** top of the core stack, in workspace coordinates */
  top: number;
  /** lowest point of anything on the rocket, boosters included */
  deepest: number;
  minX: number;
  maxX: number;
}

const PAL_W = 272;          // palette panel width
const CELL_W = 124;         // palette card
const CELL_H = 86;
const COLS = 2;
const WORK_X = 620;         // workspace anchor on screen
const WORK_Y = 90;
const STATS_W = 306;

/** Horizontal band around the centre line that means "extend the core stack". */
const CENTRE_TOL = 72;
/** How close a drop must be to an end before it counts as that end. */
const SNAP_DIST = 110;
/** Gap between an end of the stack and its snap marker. */
const SNAP_OFFSET = 26;
/** How far a booster column overlaps its host, so it reads as bolted on. */
const SIDE_OVERLAP = 8;

/** Parts that make sense strapped to the side as a booster or an instrument. */
const SIDE_OK = new Set(['tank', 'engine', 'fins', 'decoupler', 'chute']);
/** Width of the part info plate. */
const INFO_W = 330;
/** A press on a placed part that moves this far becomes a drag. */
const MOVE_START = 12;

export class BuilderScene extends Phaser.Scene {
  /** The rocket being built: a core stack plus optional left/right columns. */
  private asm: Assembly = emptyAssembly();
  /** One game object per placed part, keyed by the part's stable uid. */
  private gos = new Map<number, PartGO>();
  private selectedUid: number | null = null;

  private statsPanel?: Phaser.GameObjects.Container;
  private stagePanel?: Phaser.GameObjects.Container;
  private warnPanel?: Phaser.GameObjects.Container;
  private workspace!: Phaser.GameObjects.Container;
  private removeBtn?: LabelButton;
  private dragGhost?: PartGO;
  private snapHi?: Phaser.GameObjects.Graphics;
  private camZoom = 1;
  private camPan = { x: 0, y: 0 };
  private stackTopY = 0;
  private isPanningBg = false;
  private inGameMenu!: InGameMenu;
  /** Mirror of the last layout, so the drop logic and the highlight agree. */
  private layoutCache: Layout | null = null;
  /** Everything the preset picker put on screen; empty while it is closed. */
  private presetObjs: Phaser.GameObjects.GameObject[] = [];
  /** The preset the rocket was loaded from, until the player edits it. */
  private loadedPreset: string | null = null;
  /** The info plate about one part (hover, drag, selection). */
  private infoPlate?: Phaser.GameObjects.Container;
  private infoId: string | null = null;
  private infoTimer?: Phaser.Time.TimerEvent;

  constructor() { super('builder'); }

  private get presetsOpen(): boolean {
    return this.presetObjs.length > 0;
  }

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

    const mission = missionById(state.missionId);
    const allowed = mission?.allowedParts ?? PART_IDS;
    // Phaser reuses this scene object on every visit, so references from the
    // last visit point at destroyed objects. relayout() below runs before the
    // toolbar builds the new remove button; touching the old one threw, which
    // left the scene stuck half-created on a second visit (Next mission,
    // Rebuild rocket) and the game frozen on the result screen.
    this.removeBtn = undefined;
    this.selectedUid = null;
    this.gos = new Map();
    this.dragGhost = undefined;
    this.snapHi = undefined;
    this.layoutCache = null;
    this.isPanningBg = false;
    this.presetObjs = [];
    this.loadedPreset = null;
    this.infoPlate = undefined;
    this.infoId = null;
    this.infoTimer = undefined;
    this.camZoom = 1;
    this.camPan = { x: 0, y: 0 };
    this.asm = this.loadDesign(allowed);
    this.relayout();
    this.buildPalette(allowed);
    this.refreshStats();
    // a tall saved rocket (a preset, say) opens framed rather than cut off
    this.fitView(true);

    // ---- on-screen zoom & delete controls for touchscreens ----
    this.buildTouchToolbar();

    // ---- bottom bar ----
    const bar = this.add.graphics();
    bar.fillStyle(0x1d1d3a, 0.96).fillRect(0, height - 64, width, 64);
    bar.lineStyle(2, 0x1d1b2e).lineBetween(0, height - 64, width, height - 64);
    makeButton(this, 95, height - 32, t('builder.back'), { w: 160, h: 46, variant: 'purple', onClick: () => this.scene.start('hub') });
    makeButton(this, width - 150, height - 32, t('builder.next'), { w: 280, h: 48, fontSize: 20, variant: 'yellow', onClick: () => this.next() });
    makeButton(this, width - 430, height - 32, t('builder.presets'), { w: 190, h: 44, variant: 'blue', onClick: () => this.openPresets() });
    makeButton(this, width - 600, height - 32, t('builder.clear'), { w: 140, h: 44, variant: 'red', onClick: () => this.clear() });
    if (hasV2(this, UI_V2_ART.cursorHand)) {
      fitInto(this.add.image(198, height - 32, V2, UI_V2_ART.cursorHand), 22, 25);
    }
    this.add.text(hasV2(this, UI_V2_ART.cursorHand) ? 214 : 190, height - 32, t('builder.hint_drag'), {
      ...TXT.small, fontSize: '12px', color: '#9a9ad0', wordWrap: { width: 320 },
    }).setOrigin(0, 0.5);

    const canEdit = () => !this.inGameMenu?.isOpen && !this.presetsOpen;
    this.input.keyboard?.on('keydown-DELETE', () => { if (canEdit()) this.deleteSelected(); });
    this.input.keyboard?.on('keydown-BACKSPACE', () => { if (canEdit()) this.deleteSelected(); });

    this.inGameMenu = new InGameMenu(this, {
      // Esc closes the preset picker before it opens the game menu
      onEscapeBeforeOpen: () => {
        if (!this.presetsOpen) return false;
        this.closePresets();
        return true;
      },
      onHub: () => {
        this.saveDesign();
        this.scene.start('hub');
      },
      onQuit: () => {
        this.saveDesign();
        this.scene.start('menu');
      },
      // the design is saved, so a rebuild in the new language loses nothing
      onLanguageChange: () => {
        this.saveDesign();
        this.scene.restart();
      },
    });

    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (!canEdit()) return;
      this.camZoom = Phaser.Math.Clamp(this.camZoom - Math.sign(dy) * 0.1, 0.4, 2.2);
      this.applyCam();
    });

    // Panning: right-drag on desktop, or single-finger drag in the middle
    // canvas area when not dragging a part
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
      if (this.dragGhost || !canEdit()) return;
      const inCenter = p.x > PAL_W + 8 && p.x < width - STATS_W - 20 && p.y < height - 68;
      // a press on a part of the rocket selects or moves it
      const hit = inCenter && currentlyOver.length === 0 && !p.rightButtonDown() ? this.partAt(this.worldPoint(p)) : null;
      if (hit) { this.pressPlaced(hit, p); return; }
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

  // ---------------- loading & saving ----------------

  /** Restore this mission's design, dropping anything the mission forbids.
   *  Saves made before sideways building have no `slots` and reopen as the
   *  plain stack they always were. */
  private loadDesign(allowed: string[]): Assembly {
    const key = state.designKey();
    const saved = state.designs[key];
    const isAllowed = (id: string) => allowed.includes(id);

    let asm: Assembly;
    if (saved?.slots?.length) asm = fromSlots(saved.slots);
    else if (saved?.parts?.length) asm = assemblyFromIds(saved.parts);
    else if (state.design.slots?.length) asm = fromSlots(state.design.slots);
    else if (state.design.parts.length) asm = assemblyFromIds(state.design.parts);
    // sandbox with no saved design starts from the working preset, so the
    // player never faces an empty grid wondering what a rocket looks like
    else asm = assemblyFromIds(missionById(state.missionId)
      ? PRESET_BASIC.filter(isAllowed)
      : [...PRESET_BASIC]);

    return this.prune(asm, isAllowed);
  }

  /** Drop parts the mission does not allow, and any booster column whose host
   *  went with them. */
  private prune(asm: Assembly, isAllowed: (id: string) => boolean): Assembly {
    const next: Assembly = { spine: [], sides: [] };
    for (const node of asm.spine) {
      if (!isAllowed(node.id)) continue;
      next.spine.push(node);
      for (const side of asm.sides) {
        if (side.hostUid !== node.uid) continue;
        for (const child of side.nodes) {
          if (isAllowed(child.id)) appendToSide(next, node.uid, side.side, child);
        }
      }
    }
    return next;
  }

  private saveDesign(): void {
    const flat = flatten(this.asm);
    const slots = toSlots(this.asm);
    state.design = { parts: flat.ids, slots };
    state.designs[state.designKey()] = { parts: flat.ids, slots };
    saveGame();
  }
// ---------------- camera ----------------

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

  // ---------------- touch toolbar ----------------

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
    const on = this.selectedUid !== null;
    this.removeBtn?.setVisible(on);
    if (this.removeBtn?.hitZone) {
      if (on) this.removeBtn.hitZone.setInteractive();
      else this.removeBtn.hitZone.disableInteractive();
    }
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
    const m = partMetrics(this, id, true);
    const art = addPart(this, id, 0, 0, true);
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
    // a mouse gets the plate on hover; a finger gets it while dragging
    card.on('pointerover', (p: Phaser.Input.Pointer) => {
      if (!this.dragGhost && !p.wasTouch && this.canShowInfo()) this.showInfo(id, PAL_W + 12, cy - 40);
    });
    card.on('pointerout', () => { if (!this.dragGhost && this.selectedUid === null) this.hideInfo(); });
  }

  // ---------------- info plate ----------------

  private canShowInfo(): boolean {
    return !this.presetsOpen && !this.inGameMenu?.isOpen;
  }

  /**
   * A plate about one part: what it does, its numbers, the physics formula it
   * obeys and a real NASA part to compare with. (x, y) is its top-left corner
   * on screen; it is pushed back inside the screen when it would spill over.
   */
  private showInfo(id: string, x: number, y: number, holdMs = 0): void {
    this.infoTimer?.remove();
    this.infoTimer = undefined;
    if (this.infoId !== id || !this.infoPlate) {
      this.infoPlate?.destroy();
      this.infoPlate = this.buildInfoPlate(id);
      this.infoId = id;
    }
    this.placeInfo(x, y);
    if (holdMs > 0) this.infoTimer = this.time.delayedCall(holdMs, () => this.hideInfo());
  }

  private placeInfo(x: number, y: number): void {
    const c = this.infoPlate;
    if (!c) return;
    const { width, height } = this.scale;
    const h = (c.getData('h') as number) ?? 200;
    c.setPosition(Phaser.Math.Clamp(x, 8, width - INFO_W - 8), Phaser.Math.Clamp(y, 8, height - 72 - h));
  }

  private hideInfo(): void {
    this.infoTimer?.remove();
    this.infoTimer = undefined;
    this.infoPlate?.destroy();
    this.infoPlate = undefined;
    this.infoId = null;
  }

  private buildInfoPlate(id: string): Phaser.GameObjects.Container {
    const lang = state.lang;
    const info = PART_INFO[id];
    const c = this.add.container(0, 0).setDepth(250);
    const bg = this.add.graphics();
    c.add(bg);
    const pad = 14;
    const inner = INFO_W - pad * 2;
    let y = pad;
    const add = (txt: Phaser.GameObjects.Text, gap = 6): void => { c.add(txt); y += txt.height + gap; };

    add(this.add.text(pad, y, t(`part.${id}.name`), { ...TXT.body, fontSize: '18px', fontStyle: 'bold', color: '#ffd23f' }), 4);
    if (info) add(this.add.text(pad, y, info.role[lang], { ...TXT.small, fontSize: '13px', color: '#ffffff', wordWrap: { width: inner } }), 8);

    // numbers: two columns
    for (const f of partFacts(id)) {
      c.add(this.add.text(pad, y, f.label[lang], { ...TXT.small, fontSize: '12px', color: '#cfd2ff' }));
      const v = this.add.text(INFO_W - pad, y, f.value, { ...TXT.small, fontSize: '12px', color: '#9fe8ff', fontStyle: 'bold' }).setOrigin(1, 0);
      c.add(v);
      y += v.height + 2;
    }
    y += 6;

    if (info) {
      const fb = this.add.graphics();
      c.add(fb);
      const ft = this.add.text(INFO_W / 2, y + 6, info.formula, {
        fontFamily: 'system-ui, sans-serif', fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5, 0);
      fb.fillStyle(0x0b0b2a, 0.9).fillRoundedRect(pad, y, inner, ft.height + 12, 8);
      c.add(ft);
      y += ft.height + 18;
      add(this.add.text(pad, y, info.formulaNote[lang], { ...TXT.small, fontSize: '12px', color: '#cfd2ff', wordWrap: { width: inner } }), 8);
      add(this.add.text(pad, y, `🚀 ${info.real[lang]}`, { ...TXT.small, fontSize: '12px', color: '#c8ffd0', wordWrap: { width: inner } }), 0);
    }
    const h = y + pad;
    bg.fillStyle(0x1d1d3a, 0.97).fillRoundedRect(0, 0, INFO_W, h, 14);
    bg.lineStyle(3, 0x3fe0d0, 1).strokeRoundedRect(0, 0, INFO_W, h, 14);
    c.setData('h', h);
    return c;
  }

  // ---------------- drag & drop ----------------

  /**
   * Drag a part onto the rocket. `restore` is set when an already placed part
   * is being moved: a drop that does not fit puts the rocket back as it was.
   */
  private startDrag(id: string, p: Phaser.Input.Pointer, restore?: ReturnType<typeof toSlots>): void {
    this.isPanningBg = false;
    const startX = p.x;
    const startY = p.y;
    this.dragGhost = addPart(this, id, p.x, p.y);
    this.dragGhost.setDepth(100).setAlpha(0.85);
    // the plate rides next to the part, on whichever side has room
    const follow = (x: number, y: number): void => {
      if (!this.canShowInfo()) return;
      const right = x + 70 + INFO_W < this.scale.width - 8;
      this.showInfo(id, right ? x + 70 : x - 70 - INFO_W, y - 60);
    };
    follow(p.x, p.y);

    const move = (ptr: Phaser.Input.Pointer) => {
      this.dragGhost?.setPosition(ptr.x, ptr.y);
      follow(ptr.x, ptr.y);
      if (ptr.x < PAL_W) { this.unhighlightTarget(); return; }
      this.highlightTarget(this.worldPoint(ptr), id);
    };
    const up = (ptr: Phaser.Input.Pointer) => {
      this.input.off('pointermove', move);
      this.input.off('pointerup', up);
      const wp = this.worldPoint(ptr);
      this.unhighlightTarget();
      const tapped = Math.hypot(ptr.x - startX, ptr.y - startY) < 18;
      // dropping back on the palette cancels the drag
      const target = ptr.x < PAL_W ? null : this.resolveTarget(id, wp);
      let placed = target ? this.place(id, target, !tapped) : false;
      // A quick tap on a palette card, without dragging to the rocket, drops
      // the part where it naturally belongs instead of doing nothing.
      if (!placed && tapped && !restore) placed = this.place(id, this.autoTarget(id));
      if (!placed && restore) {
        this.asm = fromSlots(restore);
        this.relayout();
        this.refreshStats();
      }
      this.dragGhost?.destroy();
      this.dragGhost = undefined;
      // after a tap the plate stays a moment so it can be read
      if (tapped && !restore && this.canShowInfo()) this.showInfo(id, PAL_W + 12, 80, 4000);
      else if (this.selectedUid === null) this.hideInfo();
    };
    this.input.on('pointermove', move);
    this.input.on('pointerup', up);
  }

  /**
   * Engines and fins have exactly one sensible home, so a drop anywhere near
   * the rocket goes there instead of failing on a pixel: an engine to the
   * bottom of the stack (or under the booster it was dropped beside), fins to
   * the seam above the bottom engine.
   */
  private resolveTarget(id: string, wp: { x: number; y: number }): Target | null {
    const raw = this.targetAt(wp);
    const kind = partDef(id).kind;
    if (kind !== 'engine' && kind !== 'fins') return raw;
    if (raw?.kind === 'side' && !this.validatePlace(id, raw)) {
      // fins only go on a booster that already has a tank to sit on
      const col = columnAt(this.asm, raw.hostUid, raw.side);
      if (kind === 'engine' || col?.nodes.some((n) => partDef(n.id).kind === 'tank')) return raw;
    }
    const L = this.layout();
    const nearRocket = L.spine.length === 0
      || (wp.x > L.minX - 160 && wp.x < L.maxX + 160 && wp.y > L.top - 160 && wp.y < L.deepest + 200);
    return nearRocket ? { kind: 'bottom' } : raw;
  }

  /** Where a tapped palette card should land: the fairing and the instruments
   *  belong up top, engines always at the very bottom, everything else below. */
  private autoTarget(id: string): Target {
    const kind = partDef(id).kind;
    if (kind === 'nose') return { kind: 'top' };
    if (kind === 'chute') return { kind: 'top' };
    return { kind: 'bottom' };
  }
// ---------------- layout ----------------

  /** Where every part sits right now. The spine stacks down the centre line;
   *  each booster column hangs off its host and stacks down from the host's
   *  top edge, so a strap-on tank sits beside the tank it is bolted to. */
  private layout(): Layout {
    const pos = new Map<number, Rect>();
    const spine: { node: Node; rect: Rect }[] = [];
    let y = this.stackTopY;
    let widest = PART_W;

    for (const node of this.asm.spine) {
      const m = partMetrics(this, node.id);
      const rect: Rect = { x: 0, y: y + m.h / 2, w: m.w, h: m.h };
      pos.set(node.uid, rect);
      spine.push({ node, rect });
      widest = Math.max(widest, m.w);
      y += m.h;
    }

    let deepest = y;
    let minX = -widest / 2;
    let maxX = widest / 2;

    for (const col of this.asm.sides) {
      const host = pos.get(col.hostUid);
      if (!host || col.nodes.length === 0) continue;
      const metrics = col.nodes.map((n) => partMetrics(this, n.id));
      const colW = metrics.reduce((mx, m) => Math.max(mx, m.w), PART_W);
      const x = (col.side === 'left' ? -1 : 1) * (host.w / 2 + colW / 2 - SIDE_OVERLAP);
      let cy = host.y - host.h / 2;
      col.nodes.forEach((node, i) => {
        const m = metrics[i];
        const rect: Rect = { x, y: cy + m.h / 2, w: m.w, h: m.h };
        pos.set(node.uid, rect);
        // an engine's bell hangs past its own box, and the drop zones are
        // measured off the real silhouette
        cy += m.h;
        deepest = Math.max(deepest, rect.y + m.h / 2 + bellDrop(this, node.id, m.w));
        minX = Math.min(minX, x - m.w / 2);
        maxX = Math.max(maxX, x + m.w / 2);
      });
    }

    return { pos, spine, top: this.stackTopY, deepest, minX, maxX };
  }

  /** Which spine part a free-floating y coordinate is level with. */
  private spineHostAt(L: Layout, y: number): { node: Node; rect: Rect } | null {
    let best: { node: Node; rect: Rect } | null = null;
    let bestDist = Infinity;
    for (const entry of L.spine) {
      const top = entry.rect.y - entry.rect.h / 2;
      const bottom = entry.rect.y + entry.rect.h / 2;
      const dist = y < top ? top - y : y > bottom ? y - bottom : 0;
      if (dist < bestDist) { bestDist = dist; best = entry; }
    }
    return bestDist <= 90 ? best : null;
  }

  /**
   * Turn a drop point into an intent.
   *
   * Near the centre line means "extend the core stack" (top or bottom). Out to
   * the side means "bolt a booster onto whichever part you are level with" —
   * that is what makes three columns abreast possible.
   */
  private targetAt(wp: { x: number; y: number }): Target | null {
    const L = this.layout();
    if (L.spine.length === 0) return { kind: 'bottom' };

    if (Math.abs(wp.x) <= CENTRE_TOL) {
      const dTop = Math.abs(wp.y - (L.top - SNAP_OFFSET));
      const dBottom = Math.abs(wp.y - (L.deepest + SNAP_OFFSET));
      if (dTop <= SNAP_DIST && dTop <= dBottom) return { kind: 'top' };
      if (dBottom <= SNAP_DIST) return { kind: 'bottom' };
      return dTop <= dBottom ? { kind: 'top' } : { kind: 'bottom' };
    }

    const host = this.spineHostAt(L, wp.y);
    if (!host) return null;
    return { kind: 'side', hostUid: host.node.uid, side: wp.x < 0 ? 'left' : 'right' };
  }

  private highlightTarget(wp: { x: number; y: number }, id: string): void {
    this.unhighlightTarget();
    // show where the drop will really land (engines and fins are redirected)
    const target = this.resolveTarget(id, wp);
    if (!target) return;
    const err = this.validatePlace(id, target);
    const L = this.layout();

    const g = this.add.graphics();
    g.lineStyle(3, err ? 0xff6b6b : 0x7ac74f, 1);
    if (target.kind === 'side') {
      const host = L.pos.get(target.hostUid);
      if (!host) { g.destroy(); return; }
      const w = Math.max(56, host.w * 0.7);
      const x = target.side === 'left' ? host.x - host.w / 2 - w / 2 - 4 : host.x + host.w / 2 + w / 2 + 4;
      g.strokeRoundedRect(x - w / 2, host.y - 24, w, 48, 8);
    } else {
      const y = target.kind === 'top' ? L.top - 18 : L.deepest + 18;
      const w = 110;
      g.strokeRoundedRect(-w / 2, y - 18, w, 36, 8);
    }
    this.snapHi = g;
    this.workspace.add(g);
  }

  private unhighlightTarget(): void {
    this.snapHi?.destroy();
    this.snapHi = undefined;
  }

  // ---------------- placement rules ----------------

  /** Why this part cannot go there, or null when it can. Every rejection names
   *  a message the player can read; nothing fails silently. */
  private validatePlace(id: string, target: Target): string | null {
    if (assemblyCount(this.asm) >= MAX_PARTS) return 'warn.max_parts';
    const kind = partDef(id).kind;

    if (target.kind === 'side') {
      if (kind === 'nose') return 'warn.nose_side';
      if (!SIDE_OK.has(kind)) return 'warn.side_boosters_only';
      const column = columnAt(this.asm, target.hostUid, target.side);
      const last = column?.nodes[column.nodes.length - 1];
      if (!last) {
        // an engine needs something to hang from
        return kind === 'engine' ? 'warn.engine_attach' : null;
      }
      const lastKind = partDef(last.id).kind;
      if (lastKind === 'engine' && kind !== 'decoupler') return 'warn.engine_bottom';
      if (kind === 'engine' && lastKind !== 'tank' && lastKind !== 'decoupler') return 'warn.engine_attach';
      return null;
    }

    if (kind === 'nose') {
      // the fairing belongs on the tip and nowhere else; dropping it on a stack
      // that already has one swaps that one out rather than refusing the drop
      return target.kind === 'top' ? null : 'warn.nose_top';
    }

    if (kind === 'engine') {
      if (target.kind !== 'bottom') return 'warn.engine_attach';
      const last = this.asm.spine[this.asm.spine.length - 1];
      if (!last) return 'warn.engine_attach';
      const lastKind = partDef(last.id).kind;
      // a second engine under an engine swaps it out (see place())
      if (lastKind === 'engine') return null;
      if (lastKind !== 'tank' && lastKind !== 'decoupler') return 'warn.engine_attach';
    }

    return null;
  }

  private place(id: string, target: Target, warn = true): boolean {
    const err = this.validatePlace(id, target);
    if (err) { if (warn) this.flashWarn(err); return false; }

    const node = makeNode(id);
    const kind = partDef(id).kind;

    if (target.kind === 'top') {
      const tip = this.asm.spine[0];
      if (kind === 'nose' && tip && partDef(tip.id).kind === 'nose') {
        removeNode(this.asm, tip.uid);
      }
      insertAtTop(this.asm, node, (pid) => partDef(pid).kind === 'nose');
    } else if (target.kind === 'bottom') {
      const last = this.asm.spine[this.asm.spine.length - 1];
      if (kind === 'engine' && last && partDef(last.id).kind === 'engine') {
        // swap the bottom engine for the new one instead of refusing the drop
        removeNode(this.asm, last.uid);
        this.flashInfo(t('builder.engine_swapped'));
      }
      insertAtBottom(this.asm, node, (pid) => partDef(pid).kind === 'engine');
    } else {
      appendToSide(this.asm, target.hostUid, target.side, node);
    }

    this.loadedPreset = null;
    this.relayout();
    this.refreshStats();
    this.saveDesign();
    return true;
  }

  // ---------------- rendering ----------------

  private relayout(): void {
    for (const go of this.gos.values()) go.destroy();
    this.gos.clear();

    const L = this.layout();
    this.layoutCache = L;
    const nodes = [...this.asm.spine, ...this.asm.sides.flatMap((c) => c.nodes)];

    for (const node of nodes) {
      const rect = L.pos.get(node.uid);
      if (!rect) continue;
      const go = addPart(this, node.id, rect.x, rect.y);
      // clicks are hit-tested against the layout in partAt(): Phaser offsets
      // the hit box of a Container nested in the workspace, which made the
      // engines (drawn as Containers) grab clicks meant for the tank above
      this.workspace.add(go);
      this.gos.set(node.uid, go);
    }
    this.applySelectionTint();
    this.updateRemoveBtn();
  }

  /**
   * The part under a workspace point. Fins sit on a seam and are only a few
   * pixels tall in the layout, so every box is at least 44 px tall; where
   * boxes overlap the smallest wins, so fins and boosters stay clickable.
   */
  private partAt(wp: { x: number; y: number }): Node | null {
    const L = this.layoutCache ?? this.layout();
    let best: Node | null = null;
    let bestArea = Infinity;
    for (const node of allNodes(this.asm)) {
      const r = L.pos.get(node.uid);
      if (!r) continue;
      const h = Math.max(r.h, 44);
      const w = Math.max(r.w, 44);
      if (Math.abs(wp.x - r.x) > w / 2 || Math.abs(wp.y - r.y) > h / 2) continue;
      if (w * h < bestArea) { bestArea = w * h; best = node; }
    }
    return best;
  }

  /** Tap a placed part to select it; press and drag to move it elsewhere. */
  private pressPlaced(node: Node, p: Phaser.Input.Pointer): void {
    if (this.dragGhost) return;
    const sx = p.x;
    const sy = p.y;
    const move = (ptr: Phaser.Input.Pointer): void => {
      if (Math.hypot(ptr.x - sx, ptr.y - sy) < MOVE_START) return;
      this.input.off('pointermove', move);
      this.input.off('pointerup', up);
      const snapshot = toSlots(this.asm);
      removeNode(this.asm, node.uid);
      this.selectedUid = null;
      this.loadedPreset = null;
      this.relayout();
      this.refreshStats();
      this.startDrag(node.id, ptr, snapshot);
    };
    const up = (): void => {
      this.input.off('pointermove', move);
      this.input.off('pointerup', up);
      this.select(node.uid);
    };
    this.input.on('pointermove', move);
    this.input.on('pointerup', up);
  }

  private applySelectionTint(): void {
    for (const [uid, go] of this.gos) go.setAlpha(uid === this.selectedUid ? 0.55 : 1);
  }

  private select(uid: number): void {
    this.selectedUid = this.selectedUid === uid ? null : uid;
    this.applySelectionTint();
    this.updateRemoveBtn();
    const node = this.selectedUid === null ? null : allNodes(this.asm).find((n) => n.uid === uid);
    if (node && this.canShowInfo()) this.showInfo(node.id, PAL_W + 12, 80);
    else this.hideInfo();
  }

  private deleteSelected(): void {
    if (this.selectedUid === null) return;
    this.hideInfo();
    removeNode(this.asm, this.selectedUid);
    this.selectedUid = null;
    this.loadedPreset = null;
    this.relayout();
    this.refreshStats();
    this.saveDesign();
  }

  private applyPreset(preset: RocketPreset): void {
    this.asm = fromSlots(preset.slots);
    this.selectedUid = null;
    this.loadedPreset = preset.id;
    this.relayout();
    this.refreshStats();
    this.saveDesign();
    this.fitView(false);
    this.flashInfo(t('presets.loaded', { name: t(`preset.${preset.id}.name`) }));
  }

  private clear(): void {
    this.asm = emptyAssembly();
    this.selectedUid = null;
    this.loadedPreset = null;
    this.relayout();
    this.refreshStats();
    this.saveDesign();
  }

  /**
   * Frame the whole rocket between the top edge and the zoom toolbar. A
   * twelve-part preset is far taller than the screen at 1:1, and a rocket you
   * cannot see the bottom of looks broken. `onlyIfTall` keeps the 1:1 view
   * for anything that already fits.
   */
  private fitView(onlyIfTall: boolean): void {
    const L = this.layout();
    if (L.spine.length === 0) return;
    const { height } = this.scale;
    const topY = 64;
    const bottomY = height - 132;
    const rocketH = Math.max(1, L.deepest - L.top);
    const rocketW = Math.max(1, L.maxX - L.minX);
    const availW = this.scale.width - PAL_W - STATS_W - 80;
    const fits = rocketH <= bottomY - WORK_Y && rocketW <= availW;
    if (onlyIfTall && fits) return;
    const zoom = Phaser.Math.Clamp(Math.min(1, (bottomY - topY) / rocketH, availW / rocketW), 0.4, 1);
    this.camZoom = zoom;
    const shownH = rocketH * zoom;
    const top = topY + Math.max(0, (bottomY - topY - shownH) / 2);
    this.camPan = { x: 0, y: top - WORK_Y - L.top * zoom };
    this.applyCam();
  }

  // ---------------- preset picker ----------------

  private openPresets(): void {
    if (this.presetsOpen || this.inGameMenu?.isOpen) return;
    this.hideInfo();
    const { width, height } = this.scale;
    const missionId = missionById(state.missionId)?.id ?? null;
    const keep = <T extends Phaser.GameObjects.GameObject>(go: T, depth: number): T => {
      (go as unknown as { setDepth(d: number): unknown }).setDepth(depth);
      this.presetObjs.push(go);
      return go;
    };

    // the dim swallows every click under the picker; a click on it closes
    const dim = keep(this.add.rectangle(width / 2, height / 2, width, height, 0x08081a, 0.8), 300);
    dim.setInteractive();
    dim.on('pointerup', () => this.closePresets());

    const PW = 1060;
    const PH = 642;
    const px = (width - PW) / 2;
    const py = (height - PH) / 2;
    // drawn rather than the painted frame: its ornate border and header plate
    // sit right where the six cards and the subtitle need the room
    const frame = keep(this.add.graphics(), 301);
    frame.fillStyle(0x000000, 0.35).fillRoundedRect(px + 6, py + 10, PW, PH, 22);
    frame.fillStyle(0x1b1c40, 0.99).fillRoundedRect(px, py, PW, PH, 22);
    frame.fillStyle(0x2b2d5c, 1).fillRoundedRect(px + 10, py + 10, PW - 20, 86, 16);
    frame.lineStyle(5, 0x1d1b2e, 1).strokeRoundedRect(px, py, PW, PH, 22);
    frame.lineStyle(2, 0xffd23f, 0.6).strokeRoundedRect(px + 6, py + 6, PW - 12, PH - 12, 18);
    // clicks on the panel itself must not reach the dim
    keep(this.add.zone(width / 2, height / 2, PW, PH).setInteractive(), 302);

    const title = keep(this.add.text(width / 2, py + 32, t('presets.title'), {
      ...TXT.title, fontSize: '28px', stroke: '#1d1b2e', strokeThickness: 6,
    }).setOrigin(0.5), 303);
    if (hasV2(this, UI_V2_ART.iconRocket)) {
      keep(fitInto(this.add.image(width / 2 - title.width / 2 - 24, py + 32, V2, UI_V2_ART.iconRocket), 24, 29), 303);
    }
    keep(this.add.text(width / 2, py + 54, t('presets.subtitle'), {
      ...TXT.small, fontSize: '13px', color: '#cfd2ff', align: 'center', wordWrap: { width: PW - 180 },
    }).setOrigin(0.5, 0), 303);

    const close = makeButton(this, px + PW - 50, py + 40, '✕', {
      w: 52, h: 44, fontSize: 20, variant: 'red', onClick: () => this.closePresets(),
    });
    keep(close, 303);
    if (close.hitZone) keep(close.hitZone, 306);

    const CW = 328;
    const CH = 250;
    const GAP = 14;
    const gridX = px + (PW - (CW * 3 + GAP * 2)) / 2;
    const gridY = py + 108;
    PRESETS.forEach((preset, i) => {
      const cx = gridX + (i % 3) * (CW + GAP);
      const cy = gridY + Math.floor(i / 3) * (CH + GAP);
      this.buildPresetCard(preset, cx, cy, CW, CH, missionId, keep);
    });
  }

  private buildPresetCard(
    preset: RocketPreset, x: number, y: number, w: number, h: number,
    missionId: string | null,
    keep: <T extends Phaser.GameObjects.GameObject>(go: T, depth: number) => T,
  ): void {
    const allowed = presetAllowed(preset, missionId);
    const best = !!missionId && preset.bestFor.includes(missionId);
    const stats = presetStats(preset);
    const parts = presetParts(preset);
    const dimmed = allowed ? 1 : 0.38;
    const fade = <T extends Phaser.GameObjects.GameObject>(go: T): T => {
      (go as unknown as { setAlpha(a: number): unknown }).setAlpha(dimmed);
      return keep(go, 304);
    };

    const bg = keep(this.add.graphics(), 303);
    const paint = (hover: boolean) => {
      bg.clear();
      bg.fillStyle(hover ? 0x3d3f7a : 0x24264f, allowed ? 1 : 0.6);
      bg.fillRoundedRect(x, y, w, h, 14);
      bg.fillStyle(preset.color, allowed ? 0.9 : 0.4);
      bg.fillRoundedRect(x + 8, y + 10, 104, h - 20, 10);
      bg.fillStyle(0x0d0d22, 0.35);
      bg.fillRoundedRect(x + 12, y + 14, 96, h - 28, 8);
      bg.lineStyle(3, best ? 0xffd23f : hover ? 0x8fa8ff : 0x1d1b2e, 1);
      bg.strokeRoundedRect(x, y, w, h, 14);
    };
    paint(false);

    // the rocket itself, scaled into the coloured bay on the left
    const art = buildRocketArt(this, fromSlots(preset.slots));
    fitRocketArt(art, x + 60, y + h / 2, 84, h - 44);
    fade(art.container);

    const tx = x + 124;
    const textW = w - 136;
    const name = fade(this.add.text(tx, y + 12, t(`preset.${preset.id}.name`), {
      ...TXT.h2, fontSize: '19px', wordWrap: { width: textW },
    }));
    if (best) {
      keep(this.add.text(x + w - 10, y - 10, t('presets.best'), {
        ...TXT.small, fontSize: '12px', color: '#1d1b2e', fontStyle: 'bold',
        backgroundColor: '#ffd23f', padding: { x: 8, y: 3 },
      }).setOrigin(1, 0), 305);
    }
    fade(this.add.text(tx, name.y + name.height + 4, t(`preset.${preset.id}.desc`), {
      ...TXT.small, fontSize: '12px', color: '#e6e8ff', wordWrap: { width: textW }, lineSpacing: 1,
    }));
    // the numbers and the mission rows sit on the card's bottom edge, so a
    // long description in either language never pushes them out of the card
    fade(this.add.text(tx, y + h - 100, t('presets.stats', {
      mass: Math.round(stats.mass), dv: Math.round(stats.dvTotal), twr: stats.twr.toFixed(1),
    }), { ...TXT.small, fontSize: '11px', color: '#9fe8ff', wordWrap: { width: textW } }));

    // what the simple flight plan earns on each flight mission
    let ry = y + h - 70;
    for (const id of ['m1', 'm2']) {
      const m = MISSIONS[id];
      fade(this.add.text(tx, ry, t(m.titleKey), {
        ...TXT.small, fontSize: '12px', color: '#ffffff',
      }).setOrigin(0, 0.5));
      if (presetAllowed(preset, id)) {
        const p = predictFlight(parts, id);
        fade(addStarRow(this, x + w - 52, ry, p.success ? p.stars : 0, 16, 3));
      } else {
        fade(this.add.text(x + w - 52, ry, t('presets.not_allowed'), {
          ...TXT.small, fontSize: '11px', color: '#8a8cc0',
        }).setOrigin(0.5));
      }
      ry += 23;
    }

    if (!allowed) {
      keep(this.add.text(tx, ry, `🔒 ${t('presets.locked')}`, {
        ...TXT.small, fontSize: '11px', color: '#ffb3b3', wordWrap: { width: textW },
      }).setOrigin(0, 0.5), 305);
      return;
    }
    if (predictFlight(parts, null).escapes) {
      fade(this.add.text(tx, ry, `🌍 ${t('presets.escapes')}`, {
        ...TXT.small, fontSize: '12px', color: '#ffd23f', fontStyle: 'bold',
      }).setOrigin(0, 0.5));
    }

    const zone = keep(this.add.zone(x + w / 2, y + h / 2, w, h).setInteractive(), 305);
    if (zone.input) zone.input.cursor = 'pointer';
    zone.on('pointerover', () => paint(true));
    zone.on('pointerout', () => paint(false));
    zone.on('pointerup', () => {
      this.closePresets();
      this.applyPreset(preset);
    });
  }

  private closePresets(): void {
    const objs = this.presetObjs;
    this.presetObjs = [];
    for (const go of objs) go.destroy();
  }

  private flashInfo(text: string): void {
    const { width } = this.scale;
    const msg = this.add.text(width / 2, 44, text, {
      ...TXT.body, fontStyle: 'bold', color: '#d8ffc8', backgroundColor: '#163a20', padding: { x: 14, y: 8 },
    }).setOrigin(0.5, 0).setDepth(200);
    this.tweens.add({ targets: msg, alpha: 0, delay: 2200, duration: 400, onComplete: () => msg.destroy() });
  }
// ---------------- stats panel ----------------

  private refreshStats(): void {
    this.statsPanel?.destroy();
    this.warnPanel?.destroy();
    this.stagePanel?.destroy();

    const { width } = this.scale;
    const stats = computeAssemblyStats(this.asm);
    const mission = missionById(state.missionId);
    const px = width - STATS_W - 16;

    // ---- flight numbers ----
    const c = this.add.container(px, 20);
    this.statsPanel = c;
    const cost = designCost(flatten(this.asm).ids);
    const grant = missionGrant(state.missionId);
    c.add(makePanel(this, 0, 0, STATS_W, 272));
    if (hasV2(this, UI_V2_ART.iconGear)) {
      c.add(this.add.image(28, 26, V2, UI_V2_ART.iconGear).setDisplaySize(22, 22));
    }
    c.add(this.add.text(STATS_W / 2, 14, t('builder.stats'), TXT.h2).setOrigin(0.5, 0));

    const rows: [string, string][] = [
      [t('stats.mass'), `${Math.round(stats.mass)} kg`],
      [t('stats.dv'), `${Math.round(stats.dvTotal)} m/s`],
      [t('stats.twr'), stats.twr.toFixed(2)],
      [t('stats.fuel'), `${Math.round(stats.fuelTotal)} kg`],
      [t('stats.cost'), grant === null ? `$${cost}M` : `$${cost}M / $${grant}M`],
    ];
    rows.forEach(([k, v], i) => {
      const isFuel = i === 3 && hasV2(this, UI_V2_ART.iconFuel);
      if (isFuel) {
        c.add(fitInto(this.add.image(24, 52 + i * 26, V2, UI_V2_ART.iconFuel), 16, 19));
      }
      c.add(this.add.text(isFuel ? 38 : 16, 52 + i * 26, k, TXT.small).setOrigin(0, 0.5));
      const over = i === 4 && grant !== null && cost > grant;
      c.add(this.add.text(STATS_W - 16, 52 + i * 26, v, { ...TXT.body, fontSize: '15px', color: over ? '#ff8080' : '#ffffff' }).setOrigin(1, 0.5));
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
    const sc = this.add.container(px, 306);
    this.stagePanel = sc;
    sc.add(makePanel(this, 0, 0, STATS_W, 96 + stats.stages.length * 24));
    if (hasV2(this, UI_V2_ART.iconRocket)) {
      sc.add(fitInto(this.add.image(26, 24, V2, UI_V2_ART.iconRocket), 20, 24));
    }
    sc.add(this.add.text(hasV2(this, UI_V2_ART.iconRocket) ? 42 : 16, 12, t('builder.stages'), TXT.h2).setOrigin(0, 0));
    let sy = 44;
    stats.stages.forEach((st, i) => {
      const s = t('stats.stage_n', { n: i + 1, dv: Math.round(st.dv), t: st.burn.toFixed(0) });
      sc.add(this.add.text(16, sy, s, TXT.small).setOrigin(0, 0.5));
      sy += 24;
    });

    // ---- warnings + mission hint ----
    const wc = this.add.container(px, 306 + 110 + stats.stages.length * 24);
    this.warnPanel = wc;
    let wy = 0;
    for (const w of stats.warnings) {
      const txt = this.add.text(0, wy, `⚠ ${t(w.key, w.vars)}`, { ...TXT.warn, wordWrap: { width: STATS_W } }).setOrigin(0, 0);
      wc.add(txt);
      wy += txt.height + 6;
    }
    // a freshly loaded preset says how to fly it; any edit makes it the
    // player's own rocket again and the mission hint comes back
    if (this.loadedPreset) {
      const plan = this.add.text(0, wy + 6, `🚀 ${t('presets.plan_title')}: ${t(`preset.${this.loadedPreset}.plan`)}`, {
        ...TXT.small, fontSize: '13px', color: '#c8ffd0', wordWrap: { width: STATS_W },
      }).setOrigin(0, 0);
      wc.add(plan);
      wy += plan.height + 10;
    }
    const hintKey = mission?.hintKeys?.[0];
    if (hintKey) {
      const hint = this.add.text(0, wy + 6, `💡 ${t(hintKey)}`, {
        ...TXT.small, fontSize: '13px', color: '#ffe8a3', wordWrap: { width: STATS_W },
      }).setOrigin(0, 0);
      wc.add(hint);
    }
  }

  private flashWarn(key: string, vars?: Record<string, string | number>): void {
    const { width } = this.scale;
    const msg = this.add.text(width / 2, 44, t(key, vars), {
      ...TXT.warn, backgroundColor: '#3a1020', padding: { x: 14, y: 8 },
    }).setOrigin(0.5, 0).setDepth(200);
    this.tweens.add({ targets: msg, alpha: 0, delay: 2400, duration: 400, onComplete: () => msg.destroy() });
  }

  private next(): void {
    const stats = computeAssemblyStats(this.asm);
    if (stats.blocking) {
      this.flashWarn(stats.warnings[0]?.key ?? 'warn.no_engine');
      return;
    }
    // a mission rocket has to fit its grant, like a real one
    const cost = designCost(flatten(this.asm).ids);
    const grant = missionGrant(state.missionId);
    if (grant !== null && cost > grant) {
      this.flashWarn('warn.over_budget', { c: cost, g: grant });
      return;
    }
    this.saveDesign();
    this.scene.start('flight');
  }
}

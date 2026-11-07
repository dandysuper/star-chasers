import Phaser from 'phaser';
import { state } from '../core/state';
import { saveGame } from '../core/save';
import { t } from '../core/i18n';
import { partDef, PART_IDS, PRESET_BASIC } from '../data/parts';
import { missionById } from '../data/missions';
import { computeAssemblyStats, MAX_PARTS } from '../physics/rocket';
import {
  appendToSide, assemblyCount, assemblyFromIds, columnAt, emptyAssembly, flatten,
  fromSlots, insertAtBottom, insertAtTop, makeNode, removeNode, toSlots,
  type Assembly, type Node, type Side,
} from '../data/assembly';
import { makeButton, makeIconButton, makePanel, ensureMusic, TXT, drawBar, type LabelButton } from '../ui/widgets';
import { InGameMenu } from '../ui/ingameMenu';
import { addPart, partMetrics, makePartInteractive, BG, V2, UI_V2_ART, hasV2, bellDrop } from '../ui/theme';
import { PART_W } from '../ui/partArt';

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

    const mission = missionById(state.missionId);
    const allowed = mission?.allowedParts ?? PART_IDS;
    this.asm = this.loadDesign(allowed);
    this.relayout();
    this.buildPalette(allowed);
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

    this.input.keyboard?.on('keydown-DELETE', () => { if (!this.inGameMenu?.isOpen) this.deleteSelected(); });
    this.input.keyboard?.on('keydown-BACKSPACE', () => { if (!this.inGameMenu?.isOpen) this.deleteSelected(); });

    this.inGameMenu = new InGameMenu(this, {
      onHub: () => {
        this.saveDesign();
        this.scene.start('hub');
      },
      onQuit: () => {
        this.saveDesign();
        this.scene.start('menu');
      },
    });

    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (this.inGameMenu?.isOpen) return;
      this.camZoom = Phaser.Math.Clamp(this.camZoom - Math.sign(dy) * 0.1, 0.4, 2.2);
      this.applyCam();
    });

    // Panning: right-drag on desktop, or single-finger drag in the middle
    // canvas area when not dragging a part
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
      if (this.dragGhost || this.inGameMenu?.isOpen) return;
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
      this.highlightTarget(this.worldPoint(ptr), id);
    };
    const up = (ptr: Phaser.Input.Pointer) => {
      this.input.off('pointermove', move);
      this.input.off('pointerup', up);
      const wp = this.worldPoint(ptr);
      this.unhighlightTarget();
      const target = this.targetAt(wp);
      const placed = target ? this.place(id, target) : false;
      // A quick tap on a palette card, without dragging to the rocket, drops
      // the part where it naturally belongs instead of doing nothing.
      if (!placed && Math.hypot(ptr.x - startX, ptr.y - startY) < 18) {
        this.place(id, this.autoTarget(id));
      }
      this.dragGhost?.destroy();
      this.dragGhost = undefined;
    };
    this.input.on('pointermove', move);
    this.input.on('pointerup', up);
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
    const target = this.targetAt(wp);
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
      // two engines on top of each other: the upper one would be buried
      if (lastKind === 'engine') return 'warn.engine_bottom';
      if (lastKind !== 'tank' && lastKind !== 'decoupler') return 'warn.engine_attach';
    }

    return null;
  }

  private place(id: string, target: Target): boolean {
    const err = this.validatePlace(id, target);
    if (err) { this.flashWarn(err); return false; }

    const node = makeNode(id);
    const kind = partDef(id).kind;

    if (target.kind === 'top') {
      const tip = this.asm.spine[0];
      if (kind === 'nose' && tip && partDef(tip.id).kind === 'nose') {
        removeNode(this.asm, tip.uid);
      }
      insertAtTop(this.asm, node, (pid) => partDef(pid).kind === 'nose');
    } else if (target.kind === 'bottom') {
      insertAtBottom(this.asm, node, (pid) => partDef(pid).kind === 'engine');
    } else {
      appendToSide(this.asm, target.hostUid, target.side, node);
    }

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
      // fins occupy a seam rather than a slot, so their layout height is a few
      // pixels; give every part a hit box tall enough to actually click
      makePartInteractive(go, rect.w, Math.max(rect.h, 44));
      go.on('pointerdown', () => this.select(node.uid));
      this.workspace.add(go);
      this.gos.set(node.uid, go);
    }
    this.applySelectionTint();
    this.updateRemoveBtn();
  }

  private applySelectionTint(): void {
    for (const [uid, go] of this.gos) go.setAlpha(uid === this.selectedUid ? 0.55 : 1);
  }

  private select(uid: number): void {
    this.selectedUid = this.selectedUid === uid ? null : uid;
    this.applySelectionTint();
    this.updateRemoveBtn();
  }

  private deleteSelected(): void {
    if (this.selectedUid === null) return;
    removeNode(this.asm, this.selectedUid);
    this.selectedUid = null;
    this.relayout();
    this.refreshStats();
    this.saveDesign();
  }

  private applyPreset(mission: ReturnType<typeof missionById>): void {
    const parts = mission ? PRESET_BASIC.filter((id) => mission.allowedParts.includes(id)) : PRESET_BASIC;
    this.asm = assemblyFromIds(parts);
    this.selectedUid = null;
    this.relayout();
    this.refreshStats();
    this.saveDesign();
  }

  private clear(): void {
    this.asm = emptyAssembly();
    this.selectedUid = null;
    this.relayout();
    this.refreshStats();
    this.saveDesign();
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

  private flashWarn(key: string): void {
    const { width } = this.scale;
    const msg = this.add.text(width / 2, 44, t(key), {
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
    this.saveDesign();
    this.scene.start('flight');
  }
}

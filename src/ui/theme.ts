/** ui_v1 art wiring — atlas frame names, part→sprite map, and layout metrics.
 *
 * Every lookup is defensive: if the `ui` atlas is missing (or a frame was
 * dropped by the cutter), the caller falls back to the drawn stub art so the
 * game never renders a blank. */
import Phaser from 'phaser';
import { partDef } from '../data/parts';
import { PART_W, UNIT_H, drawPart } from './partArt';
import { addSliced, isOverhaul, sliceOf } from './overhaul';

export const UI = 'ui';

/** v2 wishlist art — world buildings, ground tiles, crew walks, exhaust plumes,
 *  and batch3 UI frames/portraits/icons. Packed by tools/cut-v2.mjs from v2_src. */
export const V2 = 'v2';

export const BASE_ART = {
  habitat: 'habitat',
  control: 'control',
  tower: 'tower',
  board: 'board',
  dish: 'dish',
  tanks: 'tanks',
  airlock: 'airlock',
  padMark: 'pad_mark',
  padClamp: 'pad_clamp',
  crateA: 'crate_a',
  crateB: 'crate_b',
  crateC: 'crate_c',
} as const;

/** Ground tile frames — used as TileSprite textures, so they must stay square. */
export const GROUND_ART = {
  plate: 'ground_plate',
  worn: 'ground_plate_worn',
  hazard: 'ground_hazard',
  road: 'ground_road',
} as const;

/** Exhaust plumes: black-background art drawn with BlendModes.ADD. */
export const FLAME_ART = {
  small: 'flame_small',
  medium: 'flame_medium',
  large: 'flame_large',
} as const;

/** Clouds, bursts and sparkles. Each family is a size ladder cut at one shared
 *  scale, so a bigger name really is a bigger cloud. */
export const FX_ART = {
  cloudS: 'fx_cloud_s',
  cloudM: 'fx_cloud_m',
  cloudL: 'fx_cloud_l',
  cloudXl: 'fx_cloud_xl',
  blastBurst: 'fx_blast_burst',
  blastHit: 'fx_blast_hit',
  blastGround: 'fx_blast_ground',
  sparkleS: 'fx_sparkle_s',
  sparkleM: 'fx_sparkle_m',
  sparkleL: 'fx_sparkle_l',
} as const;

/** Batch3 UI frames, crew portraits, and isolated icons in the v2 atlas. */
export const UI_V2_ART = {
  dialog: 'ui_dialog',
  minimapFrame: 'ui_minimap_frame',
  portraitMechanic: 'ui_portrait_mechanic',
  portraitDriller: 'ui_portrait_driller',
  portraitRadio: 'ui_portrait_radio',
  portraitChemist: 'ui_portrait_chemist',
  portraitAstronaut: 'ui_portrait_astronaut',
  arrow: 'ui_arrow',
  starEmpty: 'ui_star_empty',
  starFull: 'ui_star_full',
  cursorHand: 'ui_cursor_hand',
  iconWrench: 'ui_icon_wrench',
  iconFuel: 'ui_icon_fuel',
  iconGear: 'ui_icon_gear',
  iconRocket: 'ui_icon_rocket',
} as const;

/** Crew / helper key → portrait frame in the v2 atlas. */
export const PORTRAIT_ART: Record<string, string> = {
  mechanic: UI_V2_ART.portraitMechanic,
  driller: UI_V2_ART.portraitDriller,
  radio: UI_V2_ART.portraitRadio,
  chemist: UI_V2_ART.portraitChemist,
  astronaut: UI_V2_ART.portraitAstronaut,
  minions_mechanic: UI_V2_ART.portraitMechanic,
  minions_miner_driller: UI_V2_ART.portraitDriller,
  minions_radio_scout: UI_V2_ART.portraitRadio,
  minions_chemist: UI_V2_ART.portraitChemist,
};

/** Build a 3-star row from `ui_star_full` / `ui_star_empty` in v2, with a text
 *  fallback (`★`/`☆`) when the v2 frames are absent. */
export function addStarRow(
  scene: Phaser.Scene, x: number, y: number, stars: number, size = 24, gap = 4,
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  const clamped = Phaser.Math.Clamp(stars, 0, 3);
  if (hasV2(scene, UI_V2_ART.starFull) && hasV2(scene, UI_V2_ART.starEmpty)) {
    const step = size + gap;
    for (let i = 0; i < 3; i++) {
      const frame = i < clamped ? UI_V2_ART.starFull : UI_V2_ART.starEmpty;
      const img = scene.add.image((i - 1) * step, 0, V2, frame).setDisplaySize(size, size);
      c.add(img);
    }
    return c;
  }
  const txt = scene.add.text(0, 0, `${'★'.repeat(clamped)}${'☆'.repeat(3 - clamped)}`, {
    fontFamily: 'system-ui, sans-serif',
    fontSize: `${Math.round(size * 0.85)}px`,
    color: '#ffd23f',
  }).setOrigin(0.5);
  c.add(txt);
  return c;
}

/** Build a speech bubble using `ui_dialog` from v2 (plus an optional round crew
 *  portrait on the left rim), falling back to a drawn rounded rect if missing. */
export function makeSpeechBubble(
  scene: Phaser.Scene,
  w: number,
  h: number,
  text: string,
  opts: { fontSize?: number; portrait?: string } = {},
): { container: Phaser.GameObjects.Container; setText: (s: string) => void } {
  const c = scene.add.container(0, 0);
  const fontSize = opts.fontSize ?? 14;
  const hasDialog = hasV2(scene, UI_V2_ART.dialog);
  const portraitFrame = opts.portrait ? (PORTRAIT_ART[opts.portrait] ?? opts.portrait) : undefined;
  const showPortrait = !!portraitFrame && hasV2(scene, portraitFrame);

  const dialogSlice = hasDialog ? sliceOf(scene, V2, UI_V2_ART.dialog) : null;
  if (dialogSlice) {
    // the overhaul bubble stretches only across its flat middle, so the tail
    // and the rounded ends keep their shape at any width
    // corners scaled as if the whole delivered bubble were fitted to h, so
    // the tail keeps the proportion the text layout below assumes
    const k = h / dialogSlice.h0;
    c.add(addSliced(scene, 0, 0, V2, UI_V2_ART.dialog, w, h, dialogSlice, k, true).obj);
  } else if (hasDialog) {
    // ui_dialog has a bottom-left speech tail, so anchor slightly above centre
    // so the text box sits cleanly over (0, -h * 0.08)
    const bg = scene.add.image(0, 0, V2, UI_V2_ART.dialog).setDisplaySize(w, h);
    c.add(bg);
  } else {
    const bg = scene.add.graphics();
    bg.fillStyle(0xffffff, 1).lineStyle(3, 0x1d1b2e);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h - 14, 12);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h - 14, 12);
    bg.fillTriangle(-12, h / 2 - 14, 12, h / 2 - 14, 0, h / 2 + 4);
    c.add(bg);
  }

  const pSize = Math.round(Math.min(h * 0.64, 58));
  const textShiftX = showPortrait ? Math.round(pSize * 0.38) : 0;
  const wrapW = w - (showPortrait ? pSize + 44 : 44);
  // The light-cyan screen inside ui_dialog sits in the upper 76% of the sprite
  // (the bottom 24% is the lower bezel + speech tail).
  const textY = hasDialog ? -Math.round(h * 0.1) : -7;

  if (showPortrait && portraitFrame) {
    const port = scene.add.image(-w / 2 + pSize / 2 + 12, textY, V2, portraitFrame)
      .setDisplaySize(pSize, pSize);
    c.add(port);
  }

  const txt = scene.add.text(textShiftX, textY, text, {
    fontFamily: 'system-ui, sans-serif',
    fontSize: `${fontSize}px`,
    fontStyle: 'bold',
    color: '#14233c',
    wordWrap: { width: Math.max(80, wrapW) },
    align: 'center',
  }).setOrigin(0.5);
  c.add(txt);

  return {
    container: c,
    setText: (s: string) => txt.setText(s),
  };
}

/** Nozzle bell per engine part — the bell is what makes an engine read as one. */
export const BELL_ART: Record<string, string> = {
  engine_spark: 'bell_spark',
  engine_bull: 'bell_bull',
  engine_whisper: 'bell_whisper',
};

/** Bell width as a fraction of the engine block's width. */
const BELL_RATIO = 0.86;

/**
 * Size of an engine's bell and how far it tucks up under the body.
 *
 * Overhaul engines are drawn at one pixel scale with their bells: the body's
 * bottom mount is exactly as wide as the top of its bell, so the bell is drawn
 * at the body's own scale and butts onto it. Today's art has no shared scale,
 * so the bell is sized as a fraction of the body instead.
 */
function bellBox(
  scene: Phaser.Scene, id: string, partWidth: number,
): { frame: string; w: number; h: number; overlap: number } | null {
  const frame = BELL_ART[id];
  if (!frame || !hasV2(scene, frame)) return null;
  const f = scene.textures.getFrame(V2, frame);
  if (!f || f.width <= 0) return null;
  const body = partFrame(scene, id, false);
  if (body && isOverhaul(scene, V2, frame) && isOverhaul(scene, UI, body)) {
    const k = partWidth / scene.textures.getFrame(UI, body).width;
    return { frame, w: Math.round(f.width * k), h: Math.round(f.height * k), overlap: 1 };
  }
  const w = Math.round(partWidth * BELL_RATIO);
  return { frame, w, h: Math.round(w * (f.height / f.width)), overlap: 2 };
}

/** How far a part's bell hangs below its own box, in px (0 = no bell). */
export function bellDrop(scene: Phaser.Scene, id: string, partWidth: number): number {
  return bellBox(scene, id, partWidth)?.h ?? 0;
}

/** Width of an engine's nozzle mouth, in px: where its plume starts. */
export function bellWidth(scene: Phaser.Scene, id: string, partWidth: number): number {
  return bellBox(scene, id, partWidth)?.w ?? Math.round(partWidth * 0.7);
}

/** True when the v2 atlas is loaded and carries this frame. */
export function hasV2(scene: Phaser.Scene, frame: string): boolean {
  return scene.textures.exists(V2) && scene.textures.get(V2).has(frame);
}

export const BG = {
  splash: 'bg_splash',
  menu: 'bg_menu',
  builder: 'bg_builder',
  flightEarth: 'bg_flight_earth',
  flightSpace: 'bg_flight_space',
  flightMoon: 'bg_flight_moon',
  resultWin: 'bg_result_win',
  resultFail: 'bg_result_fail',
} as const;

/** Atlas key → file stem under public/assets/bg/. */
export const BG_FILES: Record<string, string> = {
  bg_splash: 'splash',
  bg_menu: 'menu',
  bg_builder: 'builder',
  bg_flight_earth: 'flight_earth',
  bg_flight_space: 'flight_space',
  bg_flight_moon: 'flight_moon',
  bg_result_win: 'result_win',
  bg_result_fail: 'result_fail',
};

/** Part id → atlas frame. Any id absent here renders with the stub art. */
const PART_FRAME: Record<string, string> = {
  nose_cone: 'nose_cone',
  probe_core: 'probe_core',
  pod: 'pod',
  tank_s: 'tank_s',      // overhaul only; today's pack falls back to tank_m (partFrame)
  tank_m: 'tank_m',
  tank_l: 'tank_l',
  engine_spark: 'engine_spark',
  engine_bull: 'engine_bull',
  engine_whisper: 'engine_whisper',
  decoupler: 'decoupler',
  fins: 'fins_red',
  parachute: 'fx_chute',
};

/** Per-kind width multiplier: engine housings flare past the hull. */
const KIND_WIDTH: Record<string, number> = {
  engine: 1.2,
};
/** The open canopy is wide; the packed canister is hull width. */
const CANOPY_WIDTH = 1.6;

/**
 * The frame a part is drawn with. `icon` is the palette card: the parachute
 * shows its open canopy there so it reads as a parachute, while the stack
 * carries the packed canister when the overhaul supplies one.
 */
function partFrame(scene: Phaser.Scene, id: string, icon: boolean): string | null {
  if (id === 'tank_s') return hasFrame(scene, 'tank_s') ? 'tank_s' : 'tank_m';
  if (id === 'parachute' && !icon && hasFrame(scene, 'parachute_packed')) return 'parachute_packed';
  return PART_FRAME[id] ?? null;
}

/**
 * Fins are the one part that is not a single centred sprite.
 *
 * The pack holds one *tall* fin per colour (159×320), not a left/right pair, so
 * drawing it centred and stretched turned it into a red spike through the
 * middle of the tank. A rocket carries a mirrored pair bolted to its lower
 * flanks instead: same art, same size, same baseline, one of them flipped — and
 * that is what both the builder and the flight scene render.
 */
const FIN_FRAME: Record<string, string> = {
  fins: 'fins_red',
};
/** Fin height as a multiple of the hull width. Big enough that the pair reads
 *  as two control surfaces framing the tail, not as stray triangles. */
const FIN_HEIGHT_RATIO = 1.7;
/** How far the fin's inner edge bites into the hull, so it reads as bolted on
 *  rather than floating beside it. */
const FIN_INSET = 6;
/** Height of the fins' slot in the stack. Small on purpose — see finGeometry. */
const FIN_ROW_H = 4;

/**
 * Fin box for the pair.
 *
 * `rowH` is deliberately almost nothing: fins are not a piece of hull, they are
 * bolted *onto* it. Giving them a full slot punched a gap straight through the
 * rocket — a tank, then thin air with two fins either side, then the engine —
 * so the row is reduced to a seam and the art straddles it, reaching up over
 * the tank and down past the engine bay the way real fins do.
 */
function finGeometry(
  scene: Phaser.Scene, id: string,
): { frame: string; finH: number; finW: number; rowH: number; w: number } | null {
  const frame = FIN_FRAME[id];
  if (!frame || !hasFrame(scene, frame)) return null;
  const f = scene.textures.getFrame(UI, frame);
  if (!f || f.width <= 0 || f.height <= 0) return null;
  const finH = Math.round(PART_W * FIN_HEIGHT_RATIO);
  const finW = Math.round(finH * (f.width / f.height));
  return { frame, finH, finW, rowH: FIN_ROW_H, w: PART_W + (finW - FIN_INSET) * 2 };
}

export interface PartMetrics {
  /** Layout width in px. */
  w: number;
  /** Layout height in px — drives stacking, snap zones and hit areas. */
  h: number;
  /** Atlas frame name, or null when the drawn stub should be used. */
  frame: string | null;
}

export function uiReady(scene: Phaser.Scene): boolean {
  return scene.textures.exists(UI);
}

export function hasFrame(scene: Phaser.Scene, frame: string): boolean {
  const tex = scene.textures.exists(UI) ? scene.textures.get(UI) : null;
  return !!tex && tex.has(frame);
}

/** Layout box for a part, derived from the sprite's own aspect ratio so a
 *  stacked rocket keeps the art's proportions instead of stretching. */
export function partMetrics(scene: Phaser.Scene, id: string, icon = false): PartMetrics {
  // fins are a mirrored pair, so their layout box spans both of them; the slot
  // itself is a seam, not a body (see finGeometry)
  const fins = finGeometry(scene, id);
  if (fins) return { w: fins.w, h: fins.rowH, frame: fins.frame };

  const frame = partFrame(scene, id, icon);
  if (frame && hasFrame(scene, frame)) {
    const f = scene.textures.getFrame(UI, frame);
    if (f && f.width > 0) {
      const kind = partDef(id).kind;
      const wide = frame === 'fx_chute' ? CANOPY_WIDTH : (KIND_WIDTH[kind] ?? 1);
      const w = Math.round(PART_W * wide);
      const h = Math.round(w * (f.height / f.width));
      // Overhaul parts are drawn to the game's own units (256 px of canvas
      // per hull width), so a large tank really is four small ones tall.
      // Today's frames have arbitrary proportions: never let one of those
      // dominate the stack, clamp it to 3.5 hull-widths.
      if (isOverhaul(scene, UI, frame)) return { w, h: Math.max(4, h), frame };
      return { w, h: Phaser.Math.Clamp(h, 12, Math.round(PART_W * 3.5)), frame };
    }
  }
  const d = partDef(id);
  return { w: PART_W, h: Math.max(10, d.h * UNIT_H), frame: null };
}

/** Add a part as an Image when a frame exists, else a drawn stub container.
 *  Both are positioned by their centre at (x, y). */
export function addPart(
  scene: Phaser.Scene, id: string, x: number, y: number, icon = false,
): Phaser.GameObjects.Image | Phaser.GameObjects.Container {
  const m = partMetrics(scene, id, icon);

  // Fins: two copies of the one fin in the pack, hugging the hull. The right
  // one is flipped so the pair is a mirror image; both share a baseline so the
  // trailing edges line up exactly, whichever rocket they are bolted to.
  const fins = finGeometry(scene, id);
  if (fins) {
    const inner = PART_W / 2 - FIN_INSET;
    const cx = inner + fins.finW / 2;
    // centred on the seam, so the pair reaches over the part above and down
    // past the engine bay instead of hanging in a slot of its own
    const left = scene.add.image(-cx, 0, UI, fins.frame)
      .setOrigin(0.5, 0.5).setDisplaySize(fins.finW, fins.finH);
    const right = scene.add.image(cx, 0, UI, fins.frame)
      .setOrigin(0.5, 0.5).setDisplaySize(fins.finW, fins.finH).setFlipX(true);
    const pair = scene.add.container(x, y, [left, right]);
    // the *hit* box is the whole fin pair even though the slot is a seam,
    // otherwise selecting a fin means clicking a four-pixel line
    pair.setSize(m.w, fins.finH);
    return pair;
  }

  if (m.frame) {
    const body = scene.add.image(0, 0, UI, m.frame).setDisplaySize(m.w, m.h);

    // Engines get their nozzle bell hung off the bottom edge. It has to live in
    // the same object as the body, or dragging the part in the builder would
    // leave the bell behind on the pad.
    const bb = bellBox(scene, id, m.w);
    if (bb) {
      const bell = scene.add.image(0, m.h / 2 - bb.overlap, V2, bb.frame)
        .setOrigin(0.5, 0).setDisplaySize(bb.w, bb.h);
      // the bell hangs behind the body, so the body's mount covers the seam
      const c = scene.add.container(x, y, [bell, body]);
      c.setSize(m.w, m.h + bb.h);
      return c;
    }

    body.setPosition(x, y);
    return body;
  }
  const c = drawPart(scene, id);
  c.setPosition(x, y);
  c.setSize(m.w, m.h);
  return c;
}

/** Give a part a click target. Images have natural frame bounds (local space
 *  starts at the frame's top-left); Containers need an explicit centred rect. */
export function makePartInteractive(
  go: Phaser.GameObjects.Image | Phaser.GameObjects.Container, w: number, h: number,
): void {
  if (go instanceof Phaser.GameObjects.Image) {
    go.setInteractive();
  } else {
    go.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
  }
  if (go.input) go.input.cursor = 'pointer';
}

/** Star plaque art for 0–3 stars. 0 uses the overhaul's empty plaque when it
 *  is there; otherwise 0 and 1 share the one-star plaque, dimmed. */
export function starFrame(stars: number, scene?: Phaser.Scene): { frame: string; dim: boolean } {
  if (stars >= 3) return { frame: 'stars_3', dim: false };
  if (stars === 2) return { frame: 'stars_2', dim: false };
  if (stars <= 0 && scene && hasFrame(scene, 'stars_0')) return { frame: 'stars_0', dim: false };
  return { frame: 'stars_1', dim: stars === 0 };
}

/** Floor for the camera zoom: below this the rocket stops shrinking. */
export const MIN_ZOOM = 0.02;

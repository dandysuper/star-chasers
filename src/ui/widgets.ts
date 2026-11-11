import Phaser from 'phaser';
import { UI, hasFrame } from './theme';
import { addSliced, sliceOf } from './overhaul';
import { state } from '../core/state';
import { applyMusicSetting } from './music';

export const COL = {
  panel: 0x2b2d5c,
  panelDark: 0x1d1b2e,
  accent: 0xffd23f,
  text: 0xffffff,
  warn: 0xff6b6b,
  ok: 0x7ac74f,
};

export type ButtonVariant = 'yellow' | 'blue' | 'red' | 'green' | 'orange' | 'purple';

const BTN_FRAME: Record<ButtonVariant, string> = {
  yellow: 'btn_yellow',
  blue: 'btn_blue',
  red: 'btn_red',
  green: 'btn_green',
  orange: 'btn_orange',
  purple: 'btn_purple',
};

/** Drawn fallback tint per variant (only used when the atlas is missing). */
const BTN_TINT: Record<ButtonVariant, number> = {
  yellow: 0xd8a41f,
  blue: 0x3a6bb5,
  red: 0xb83a3a,
  green: 0x4f9142,
  orange: 0xc97a26,
  purple: 0x6b4fa0,
};

export interface ButtonOpts {
  w?: number;
  h?: number;
  fontSize?: number;
  onClick: () => void;
  variant?: ButtonVariant;
  /** Drawn-fallback colour; ignored when sprite art is available. */
  color?: number;
}

export type LabelButton = Phaser.GameObjects.Container & {
  setLabel?: (s: string) => void;
  /** The Zone that receives the clicks. A scene with more than one camera must
   *  attach this to the same camera as the visuals, or a click fires twice. */
  hitZone?: Phaser.GameObjects.Zone;
};

export function makeButton(
  scene: Phaser.Scene, x: number, y: number, label: string, opts: ButtonOpts,
): LabelButton {
  const w = opts.w ?? 220;
  const h = opts.h ?? 52;
  const variant = opts.variant ?? 'blue';
  // Flat container: an interactive Container that holds another Container is
  // not reliably hit-tested, so the visuals stay direct children. Nothing ever
  // scales `c` either — scaling an interactive object moves its hit area, which
  // used to shrink the target out from under the cursor and swallow the click.
  const c = scene.add.container(x, y) as LabelButton;

  const art = hasFrame(scene, BTN_FRAME[variant]);
  const g = scene.add.graphics();
  const wash = scene.add.graphics();
  let img: Phaser.GameObjects.Image | null = null;
  let sliced: { obj: Phaser.GameObjects.NineSlice; sx: number; sy: number } | null = null;
  const tint = opts.color ?? BTN_TINT[variant];
  // Overhaul buttons are painted in their own colour and stretch cleanly, so
  // they are 9-sliced to size and need no colour wash on top.
  const slice = art ? sliceOf(scene, UI, BTN_FRAME[variant]) : null;

  if (slice) {
    // the caps are scaled so the delivered button's full height fits h
    sliced = addSliced(scene, 0, 0, UI, BTN_FRAME[variant], w, h, slice, h / slice.h0, true);
    c.add(sliced.obj);
    c.add(wash);
  } else if (art) {
    // The pack's button frames are all the same dark pill — the only variation
    // is a tiny emblem. A translucent colour wash inside the painted rim keeps
    // the art's chunky outline while restoring the yellow/blue/red coding.
    img = scene.add.image(0, 0, UI, BTN_FRAME[variant]).setDisplaySize(w, h);
    c.add(img);
    drawButtonWash(wash, w, h, tint, 0.62);
    c.add(wash);
  } else {
    drawButtonBg(g, w, h, tint);
    c.add(g);
  }

  const txt = scene.add.text(0, 0, label, {
    fontFamily: 'system-ui, sans-serif',
    fontSize: `${opts.fontSize ?? 18}px`,
    color: '#ffffff',
    fontStyle: 'bold',
    align: 'center',
    stroke: '#1d1b2e',
    strokeThickness: 4,
    wordWrap: { width: w - 20 },
  }).setOrigin(0.5);
  c.add(txt);

  c.setSize(w, h);
  // The hit target is a Zone, not the Container. Container hit-testing proved
  // unreliable here: the container was registered, enabled and correctly
  // placed, yet hit tests inside it returned nothing. A Zone is the primitive
  // Phaser provides for exactly this, hit-tested against its own bounds.
  const zone = scene.add.zone(x, y, w, h).setInteractive();
  if (zone.input) zone.input.cursor = 'pointer';

  // Feedback scales the art and the label only. `c` keeps the hit area it was
  // given, so a press can never resize the target out from under the pointer.
  const shape = (k: number) => {
    img?.setDisplaySize(w * k, h * k);
    sliced?.obj.setScale(sliced.sx * k, sliced.sy * k);
    wash.setScale(k);
    txt.setScale(k);
  };
  const rest = () => {
    shape(1);
    if (sliced) wash.clear();
    else if (img) drawButtonWash(wash, w, h, tint, 0.62);
    else drawButtonBg(g, w, h, tint);
  };
  const hover = () => {
    shape(1.03);
    // a faint white glaze: the painted colour already says what the button is
    if (sliced) drawButtonWash(wash, w, h, 0xffffff, 0.16);
    else if (img) drawButtonWash(wash, w, h, lighten(tint, 0.28), 0.78);
    else drawButtonBg(g, w, h, lighten(tint, 0.3));
  };
  const press = () => shape(0.97);

  zone.on('pointerover', hover);
  zone.on('pointerout', rest);
  zone.on('pointerdown', press);
  zone.on('pointerup', () => { rest(); opts.onClick(); });

  // the zone is a scene-level sibling, so it has to die with the visuals
  c.once('destroy', () => zone.destroy());

  c.setLabel = (s: string) => txt.setText(s);
  c.hitZone = zone;
  return c as LabelButton;
}

/** Blend a colour toward white — used for hover states on solid pills. */
function lighten(color: number, amount: number): number {
  const k = Phaser.Math.Clamp(amount, 0, 1);
  const mix = (c: number) => Math.round(c + (255 - c) * k);
  return (mix((color >> 16) & 0xff) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff);
}

function drawButtonBg(g: Phaser.GameObjects.Graphics, w: number, h: number, color: number): void {
  const r = Math.min(14, h / 2 - 1);
  g.clear();
  g.fillStyle(color, 1);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, r);
  // top highlight + bottom shade so the pill reads as a solid chunky button
  g.fillStyle(0xffffff, 0.18);
  g.fillRoundedRect(-w / 2 + 5, -h / 2 + 4, w - 10, h * 0.34, r * 0.7);
  g.fillStyle(0x000000, 0.16);
  g.fillRoundedRect(-w / 2 + 5, h / 2 - h * 0.3 - 4, w - 10, h * 0.26, r * 0.7);
  g.lineStyle(3, COL.panelDark, 1);
  g.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
}

/** Translucent colour fill that sits inside the painted button rim. */
function drawButtonWash(
  g: Phaser.GameObjects.Graphics, w: number, h: number, color: number, alpha: number,
): void {
  const inset = 7;
  const r = Math.max(6, Math.min(h, 40) / 2 - inset / 2);
  g.clear();
  g.fillStyle(color, alpha);
  g.fillRoundedRect(-w / 2 + inset, -h / 2 + inset, w - inset * 2, h - inset * 2, r);
  // a soft top gloss keeps it from reading as a flat wash
  g.fillStyle(0xffffff, alpha * 0.3);
  g.fillRoundedRect(-w / 2 + inset + 3, -h / 2 + inset + 2, w - inset * 2 - 6, (h - inset * 2) * 0.3, r * 0.7);
}

/** Framed panel, anchored top-left at (x, y). The painted panel has a thick
 *  ornate border, so it is only used for large surfaces — small HUD panels are
 *  drawn, otherwise the border eats their content. */
export function makePanel(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, alpha = 0.92,
): Phaser.GameObjects.Image | Phaser.GameObjects.Graphics | Phaser.GameObjects.NineSlice {
  // The overhaul panel has a thin bevel and a flat middle, so it 9-slices to
  // any size, HUD panels included. Its cyan bevel sits 22 px into the art:
  // big panels draw it at 60 %, but the small HUD panels lay their text out
  // 16 px from the edge, so they draw it at 35 % to keep it clear of the text.
  // The corners never take more than half the panel.
  const slice = hasFrame(scene, 'panel_big') ? sliceOf(scene, UI, 'panel_big') : null;
  if (slice) {
    const big = w >= 420 && h >= 170;
    const k = Math.min(big ? 0.6 : 0.35, w / ((slice.l + slice.r) * 2), h / ((slice.t + slice.b) * 2));
    const { obj } = addSliced(scene, x, y, UI, 'panel_big', w, h, slice, k, true);
    return obj.setOrigin(0, 0).setAlpha(alpha);
  }
  if (w >= 420 && h >= 170 && hasFrame(scene, 'panel_big')) {
    return scene.add.image(x, y, UI, 'panel_big').setOrigin(0, 0).setDisplaySize(w, h).setAlpha(alpha);
  }
  const g = scene.add.graphics();
  g.fillStyle(COL.panel, alpha);
  g.fillRoundedRect(x, y, w, h, 14);
  g.lineStyle(4, COL.panelDark, 1);
  g.strokeRoundedRect(x, y, w, h, 14);
  g.lineStyle(2, 0xffd23f, 0.55);
  g.strokeRoundedRect(x + 4, y + 4, w - 8, h - 8, 11);
  return g;
}

/** Round icon button from the C4 icon sheet. */
export function makeIconButton(
  scene: Phaser.Scene, x: number, y: number, frame: string,
  onClick: () => void, size = 44,
): Phaser.GameObjects.Image | Phaser.GameObjects.Container {
  if (hasFrame(scene, frame)) {
    const img = scene.add.image(x, y, UI, frame).setDisplaySize(size, size);
    // Phaser Image hit test local coordinates are in texture-frame coordinates (0..width, 0..height).
    const frameObj = scene.textures.getFrame(UI, frame);
    const fw = frameObj?.width ?? size;
    const fh = frameObj?.height ?? size;
    const padX = fw * 0.18;
    const padY = fh * 0.18;
    img.setInteractive(
      new Phaser.Geom.Rectangle(-padX, -padY, fw + padX * 2, fh + padY * 2),
      Phaser.Geom.Rectangle.Contains,
    );
    if (img.input) img.input.cursor = 'pointer';
    img.on('pointerover', () => img.setDisplaySize(size * 1.08, size * 1.08));
    img.on('pointerout', () => img.setDisplaySize(size, size));
    img.on('pointerdown', () => img.setDisplaySize(size * 0.95, size * 0.95));
    img.on('pointerup', () => {
      img.setDisplaySize(size, size);
      onClick();
    });
    return img;
  }
  // fallback: a labelled chip so the control still exists
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  g.fillStyle(0x3a3a6e, 1).lineStyle(2, 0x1d1b2e);
  g.fillCircle(0, 0, size / 2);
  g.strokeCircle(0, 0, size / 2);
  c.add(g);
  c.setSize(size, size);
  c.setInteractive(new Phaser.Geom.Rectangle(-size / 2, -size / 2, size, size), Phaser.Geom.Rectangle.Contains);
  if (c.input) c.input.cursor = 'pointer';
  c.on('pointerover', () => c.setScale(1.08));
  c.on('pointerout', () => c.setScale(1));
  c.on('pointerdown', () => c.setScale(0.95));
  c.on('pointerup', () => {
    c.setScale(1);
    onClick();
  });
  return c;
}

/** Horizontal progress bar drawn in the ui palette (fuel, Δv, drilling). */
export function drawBar(
  g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number,
  frac: number, fill: number,
): void {
  const f = Phaser.Math.Clamp(frac, 0, 1);
  g.clear();
  g.fillStyle(COL.panelDark, 1).fillRoundedRect(x, y, w, h, h / 2);
  if (f > 0) {
    g.fillStyle(fill, 1).fillRoundedRect(x, y, Math.max(h, w * f), h, h / 2);
  }
}

export const TXT = {
  title: { fontFamily: 'system-ui, sans-serif', fontSize: '44px', color: '#ffffff', fontStyle: 'bold' } as Phaser.Types.GameObjects.Text.TextStyle,
  h2: { fontFamily: 'system-ui, sans-serif', fontSize: '24px', color: '#ffffff', fontStyle: 'bold' } as Phaser.Types.GameObjects.Text.TextStyle,
  body: { fontFamily: 'system-ui, sans-serif', fontSize: '17px', color: '#ffffff' } as Phaser.Types.GameObjects.Text.TextStyle,
  small: { fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#cfd2ff' } as Phaser.Types.GameObjects.Text.TextStyle,
  warn: { fontFamily: 'system-ui, sans-serif', fontSize: '15px', color: '#ffb3b3' } as Phaser.Types.GameObjects.Text.TextStyle,
};

/**
 * Music entry point kept for the scenes: pick the bed this scene owns and
 * crossfade into it, or apply the player's on/off choice to what is already
 * playing.
 *
 * The mixing itself lives in `music.ts` — a scene never has to know which
 * track it gets, only that it wants music.
 */
export function ensureMusic(scene: Phaser.Scene, on: boolean, ducked?: boolean): void {
  applyMusicSetting(scene, on, ducked);
}

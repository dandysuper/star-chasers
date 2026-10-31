/** Chunky cartoon UI. Prefers the ui_v1 sprite art and falls back to drawn
 *  vector shapes so the game still renders if an atlas frame is missing. */
import Phaser from 'phaser';
import { UI, hasFrame } from './theme';

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
  const tint = opts.color ?? BTN_TINT[variant];

  if (art) {
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
    txt.setScale(k);
  };
  const rest = () => {
    shape(1);
    if (img) drawButtonWash(wash, w, h, tint, 0.62);
    else drawButtonBg(g, w, h, tint);
  };
  const hover = () => {
    shape(1.03);
    if (img) drawButtonWash(wash, w, h, lighten(tint, 0.28), 0.78);
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
): Phaser.GameObjects.Image | Phaser.GameObjects.Graphics {
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
    // hit area is padded and independent of the hover scale, so the icon stays
    // as easy to hit as it looks (small round targets need the slack)
    const pad = Math.max(6, size * 0.16);
    img.setInteractive(new Phaser.Geom.Rectangle(-size / 2 - pad, -size / 2 - pad, size + pad * 2, size + pad * 2), Phaser.Geom.Rectangle.Contains);
    if (img.input) img.input.cursor = 'pointer';
    img.on('pointerover', () => img.setScale(img.scaleX * 1.08, img.scaleY * 1.08));
    img.on('pointerout', () => img.setDisplaySize(size, size));
    img.on('pointerup', onClick);
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
  c.on('pointerup', onClick);
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

const MUSIC_VOLUME = 0.5;
const MUSIC_DUCKED = 0.25;

/** Music manager — shared across scenes. `ducked` is used during flight. */
export function ensureMusic(scene: Phaser.Scene, on: boolean, ducked = false): void {
  const sound = scene.sound as Phaser.Sound.WebAudioSoundManager | Phaser.Sound.NoAudioSoundManager;
  const target = !on ? 0 : ducked ? MUSIC_DUCKED : MUSIC_VOLUME;
  let theme = (scene.game as Phaser.Game & { __theme?: Phaser.Sound.BaseSound }).__theme;
  if (!theme) {
    theme = scene.sound.add('theme', { loop: true, volume: on ? target : 0 });
    (scene.game as Phaser.Game & { __theme?: Phaser.Sound.BaseSound }).__theme = theme;
    void sound;
  }
  (theme as Phaser.Sound.WebAudioSound | undefined)?.setVolume?.(target);
  if (!theme.isPlaying) {
    // autoplay policy: start on first pointer down
    const start = () => {
      theme!.play();
      scene.input.off('pointerdown', start);
    };
    scene.input.once('pointerdown', start);
  }
}

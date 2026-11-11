/**
 * Small drawing helpers for the flight scene: generated textures (soft glow,
 * sky gradient) and the colour maths behind the altitude-driven sky.
 *
 * Generated textures are made once per game and reused by every restart.
 */
import Phaser from 'phaser';

export const GLOW_KEY = 'fx_glow';
export const SKY_KEY = 'flight_sky';
const SKY_H = 256;

export function smoothstep(e0: number, e1: number, x: number): number {
  const k = Phaser.Math.Clamp((x - e0) / (e1 - e0), 0, 1);
  return k * k * (3 - 2 * k);
}

export function lerpColor(a: number, b: number, k: number): number {
  const t = Phaser.Math.Clamp(k, 0, 1);
  const ch = (shift: number) => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * t) << shift;
  };
  return ch(16) | ch(8) | ch(0);
}

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** A soft white disc fading to transparent: tinted and drawn additively it is
 *  the hot glow at a nozzle mouth. */
export function ensureGlowTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(GLOW_KEY)) return GLOW_KEY;
  const size = 128;
  const tex = scene.textures.createCanvas(GLOW_KEY, size, size);
  if (!tex) return GLOW_KEY;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
  return GLOW_KEY;
}

/** A thin vertical canvas the sky gradient is painted into; stretched to the
 *  screen it costs one tiny upload whenever the colours change. */
export function ensureSkyTexture(scene: Phaser.Scene): Phaser.Textures.CanvasTexture | null {
  if (scene.textures.exists(SKY_KEY)) {
    return scene.textures.get(SKY_KEY) as Phaser.Textures.CanvasTexture;
  }
  return scene.textures.createCanvas(SKY_KEY, 4, SKY_H);
}

export function paintSky(tex: Phaser.Textures.CanvasTexture, top: number, mid: number, bottom: number): void {
  const ctx = tex.getContext();
  const g = ctx.createLinearGradient(0, 0, 0, SKY_H);
  g.addColorStop(0, css(top));
  g.addColorStop(0.55, css(mid));
  g.addColorStop(1, css(bottom));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, tex.width, SKY_H);
  tex.refresh();
}

/** Sky colours (zenith, middle, horizon) by altitude over Earth: daylight blue
 *  at the pad, deepening through the stratosphere, black at the edge of space. */
const SKY_STOPS: { alt: number; c: [number, number, number] }[] = [
  { alt: 0, c: [0x3d8be0, 0x7cc3ff, 0xd2efff] },
  { alt: 6000, c: [0x2f74d4, 0x63aef5, 0xaee0ff] },
  { alt: 18000, c: [0x17469c, 0x2f72cf, 0x6fb0ef] },
  { alt: 35000, c: [0x0a1a4c, 0x163a85, 0x3567b8] },
  { alt: 60000, c: [0x03050f, 0x070d26, 0x10204f] },
];

export function skyColors(alt: number): [number, number, number] {
  if (alt <= SKY_STOPS[0].alt) return SKY_STOPS[0].c;
  for (let i = 1; i < SKY_STOPS.length; i++) {
    const a = SKY_STOPS[i - 1];
    const b = SKY_STOPS[i];
    if (alt <= b.alt) {
      const k = (alt - a.alt) / (b.alt - a.alt);
      return [lerpColor(a.c[0], b.c[0], k), lerpColor(a.c[1], b.c[1], k), lerpColor(a.c[2], b.c[2], k)];
    }
  }
  return SKY_STOPS[SKY_STOPS.length - 1].c;
}

/** Side-view stub art for rocket parts — Phaser Graphics, bright fill + dark
 *  outline (ASSETS.md "Missing → stub"). All parts are 1.25 m wide = W px. */
import Phaser from 'phaser';
import { partDef } from '../data/parts';

export const PART_W = 40;         // px per 1.25 m
export const UNIT_H = 40;         // px per height unit
const OUTLINE = 0x1d1b2e;

/** draw a part centred at (0,0); returns the container with the graphics */
export function drawPart(scene: Phaser.Scene, id: string): Phaser.GameObjects.Container {
  const d = partDef(id);
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  const w = PART_W;
  const h = Math.max(8, d.h * UNIT_H);
  const hw = w / 2;
  const hh = h / 2;

  const box = (fill: number, lw = 3) => {
    g.fillStyle(fill, 1);
    g.lineStyle(lw, OUTLINE, 1);
  };

  switch (d.kind) {
    case 'nose': {
      box(0xf5f5f5);
      g.fillTriangle(-hw, hh, hw, hh, 0, -hh);
      g.strokeTriangle(-hw, hh, hw, hh, 0, -hh);
      g.fillStyle(0xe63946, 1);
      g.fillTriangle(-hw * 0.35, -hh * 0.35, hw * 0.35, -hh * 0.35, 0, -hh);
      break;
    }
    case 'control': {
      if (id === 'pod') {
        box(0xf5f5f5);
        g.fillRoundedRect(-hw, -hh, w, h, 6);
        g.strokeRoundedRect(-hw, -hh, w, h, 6);
        g.fillStyle(0x5ac8fa, 1).lineStyle(3, OUTLINE);
        g.fillCircle(0, -4, 10).strokeCircle(0, -4, 10);
      } else {
        box(0x9aa0a8);
        g.fillRoundedRect(-hw, -hh, w, h, 6);
        g.strokeRoundedRect(-hw, -hh, w, h, 6);
        g.fillStyle(0x59f7ff, 1).lineStyle(2, OUTLINE);
        g.fillRoundedRect(-12, -8, 24, 16, 3).strokeRoundedRect(-12, -8, 24, 16, 3);
      }
      break;
    }
    case 'tank': {
      box(0xf5f5f5);
      g.fillRoundedRect(-hw, -hh, w, h, 8);
      g.strokeRoundedRect(-hw, -hh, w, h, 8);
      g.fillStyle(0xff9a3d, 1);
      const stripes = id === 'tank_s' ? 1 : id === 'tank_m' ? 2 : 4;
      for (let i = 1; i <= stripes; i++) {
        const y = -hh + (h / (stripes + 1)) * i;
        g.fillRect(-hw + 3, y - 3, w - 6, 6);
        g.lineStyle(2, OUTLINE).strokeRect(-hw + 3, y - 3, w - 6, 6);
      }
      break;
    }
    case 'engine': {
      const col = id === 'engine_bull' ? 0x4a4e69 : id === 'engine_whisper' ? 0x59f7ff : 0x9aa0a8;
      box(col);
      // bell: trapezoid narrower at top
      const top = id === 'engine_bull' ? hw * 0.7 : id === 'engine_whisper' ? hw * 0.35 : hw * 0.55;
      g.fillPoints([{ x: -top, y: -hh }, { x: top, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }], true);
      g.lineStyle(3, OUTLINE);
      g.beginPath();
      g.moveTo(-top, -hh); g.lineTo(top, -hh); g.lineTo(hw, hh); g.lineTo(-hw, hh); g.closePath();
      g.strokePath();
      break;
    }
    case 'decoupler': {
      box(0xf2c138);
      g.fillRect(-hw, -hh, w, h);
      g.strokeRect(-hw, -hh, w, h);
      g.lineStyle(3, OUTLINE);
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(i * 12 - 6, -hh); g.lineTo(i * 12 + 6, hh);
        g.strokePath();
      }
      break;
    }
    case 'fins': {
      box(0xe63946);
      g.fillTriangle(-hw * 1.6, hh, -hw * 0.3, -hh, -hw * 0.3, hh);
      g.fillTriangle(hw * 1.6, hh, hw * 0.3, -hh, hw * 0.3, hh);
      g.strokeTriangle(-hw * 1.6, hh, -hw * 0.3, -hh, -hw * 0.3, hh);
      g.strokeTriangle(hw * 1.6, hh, hw * 0.3, -hh, hw * 0.3, hh);
      break;
    }
    case 'chute': {
      box(0xff9a3d);
      g.fillStyle(0xff9a3d, 1).lineStyle(3, OUTLINE);
      g.slice(0, 0, hw, Phaser.Math.DegToRad(180), Phaser.Math.DegToRad(360), false);
      g.fillPath().strokePath();
      g.fillStyle(0xf5f5f5, 1);
      g.fillRect(-hw * 0.7, 0, hw * 1.4, hh * 0.8);
      break;
    }
  }

  c.add(g);
  c.setData('h', h);
  c.setSize(w + 16, h);
  return c;
}

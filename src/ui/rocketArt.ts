/**
 * One rocket drawing, shared by the flight scene and the builder's preset
 * cards: the core stack down the centre line, each booster column hung off the
 * part it is bolted to, exactly as the builder lays them out.
 */
import Phaser from 'phaser';
import type { Assembly, Node, Side } from '../data/assembly';
import { partDef } from '../data/parts';
import { addPart, bellDrop, partMetrics } from './theme';

export type PartGO = Phaser.GameObjects.Image | Phaser.GameObjects.Container;

export interface PlacedPart {
  node: Node;
  go: PartGO;
  /** Centre of the part's box, in the rocket container's space. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** How far the engine bell hangs below the box (0 for anything else). */
  bell: number;
  column: 'spine' | Side;
}

export interface RocketArt {
  container: Phaser.GameObjects.Container;
  parts: PlacedPart[];
  /** Box of the whole silhouette, bells included, in container space. */
  top: number;
  bottom: number;
  minX: number;
  maxX: number;
  /** Height of the core stack alone (no bells): what the old flight art used. */
  spineH: number;
}

/** How far a booster column overlaps its host, so it reads as bolted on. */
const SIDE_OVERLAP = 8;

/** Draw `asm` into a new container centred on the middle of the core stack. */
export function buildRocketArt(scene: Phaser.Scene, asm: Assembly, x = 0, y = 0): RocketArt {
  const container = scene.add.container(x, y);
  const parts: PlacedPart[] = [];
  const metrics = asm.spine.map((n) => partMetrics(scene, n.id));
  const spineH = metrics.reduce((s, m) => s + m.h, 0);
  let cy = -spineH / 2;
  let top = cy;
  let bottom = cy;
  let minX = 0;
  let maxX = 0;

  const place = (node: Node, px: number, py: number, w: number, h: number, column: PlacedPart['column']) => {
    const go = addPart(scene, node.id, px, py);
    container.add(go);
    const bell = partDef(node.id).kind === 'engine' ? bellDrop(scene, node.id, w) : 0;
    parts.push({ node, go, x: px, y: py, w, h, bell, column });
    top = Math.min(top, py - h / 2);
    bottom = Math.max(bottom, py + h / 2 + bell);
    minX = Math.min(minX, px - w / 2);
    maxX = Math.max(maxX, px + w / 2);
  };

  const hosts = new Map<number, { x: number; y: number; w: number; h: number }>();
  asm.spine.forEach((node, i) => {
    const m = metrics[i];
    const rect = { x: 0, y: cy + m.h / 2, w: m.w, h: m.h };
    hosts.set(node.uid, rect);
    place(node, rect.x, rect.y, m.w, m.h, 'spine');
    cy += m.h;
  });

  for (const col of asm.sides) {
    const host = hosts.get(col.hostUid);
    if (!host) continue;
    const colMetrics = col.nodes.map((n) => partMetrics(scene, n.id));
    const colW = colMetrics.reduce((mx, m) => Math.max(mx, m.w), host.w);
    const sx = (col.side === 'left' ? -1 : 1) * (host.w / 2 + colW / 2 - SIDE_OVERLAP);
    let sy = host.y - host.h / 2;
    col.nodes.forEach((node, i) => {
      const m = colMetrics[i];
      place(node, sx, sy + m.h / 2, m.w, m.h, col.side);
      sy += m.h;
    });
  }

  return { container, parts, top, bottom, minX, maxX, spineH };
}

/** Scale and centre a rocket so its silhouette fits a `w × h` box at (cx, cy). */
export function fitRocketArt(art: RocketArt, cx: number, cy: number, w: number, h: number): number {
  const artW = Math.max(1, art.maxX - art.minX);
  const artH = Math.max(1, art.bottom - art.top);
  const k = Math.min(w / artW, h / artH, 1.2);
  art.container.setScale(k);
  art.container.setPosition(cx - ((art.minX + art.maxX) / 2) * k, cy - ((art.top + art.bottom) / 2) * k);
  return k;
}

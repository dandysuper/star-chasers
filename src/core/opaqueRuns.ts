export interface OpaqueRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Follow the painted lower contour, including raised sides of a sloped base. */
export function foundationRects(rgba: Uint8ClampedArray, width: number, height: number, thickness: number): OpaqueRect[] {
  const mask = new Uint8ClampedArray(rgba.length);
  const bottoms = new Int32Array(width).fill(-1);
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] < 24) continue;
      bottoms[x] = y;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  // Roof edges and antennae must not become ground obstacles.
  const baseTop = bottom - Math.max(thickness, (bottom - top + 1) * 0.3) + 1;
  for (let x = 0; x < width; x++) {
    for (let y = Math.max(0, Math.ceil(baseTop), bottoms[x] - thickness + 1); y <= bottoms[x]; y++) {
      const i = (y * width + x) * 4 + 3;
      mask[i] = rgba[i];
    }
  }
  return opaqueRects(mask, width, height);
}

/** Merge opaque scanline runs into rectangles without filling transparent gaps. */
export function opaqueRects(rgba: Uint8ClampedArray, width: number, height: number, minAlpha = 24): OpaqueRect[] {
  const result: OpaqueRect[] = [];
  let active = new Map<string, OpaqueRect>();
  for (let y = 0; y < height; y++) {
    const next = new Map<string, OpaqueRect>();
    for (let x = 0; x < width;) {
      if (rgba[(y * width + x) * 4 + 3] < minAlpha) { x++; continue; }
      const start = x;
      while (x < width && rgba[(y * width + x) * 4 + 3] >= minAlpha) x++;
      const key = `${start}:${x}`;
      const rect = active.get(key) ?? { x: start, y, width: x - start, height: 0 };
      rect.height++;
      next.set(key, rect);
    }
    for (const [key, rect] of active) if (!next.has(key)) result.push(rect);
    active = next;
  }
  result.push(...active.values());
  return result;
}

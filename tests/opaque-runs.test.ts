import { describe, expect, it } from 'vitest';
import { foundationRects, opaqueRects } from '../src/core/opaqueRuns';

function pixels(rows: string[]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(rows.length * rows[0].length * 4);
  rows.forEach((row, y) => [...row].forEach((value, x) => {
    rgba[(y * row.length + x) * 4 + 3] = value === '#' ? 255 : 0;
  }));
  return rgba;
}

describe('building alpha footprint', () => {
  it('places collision on raised base edges and ignores transparent padding below the drawing', () => {
    const rows = [...Array(15).fill('######'), ...Array(3).fill('..##..'), ...Array(4).fill('......')];
    expect(foundationRects(pixels(rows), 6, rows.length, 2)).toEqual([
      { x: 0, y: 13, width: 2, height: 2 },
      { x: 4, y: 13, width: 2, height: 2 },
      { x: 2, y: 16, width: 2, height: 2 },
    ]);
  });

  it('keeps transparent gaps open while merging adjacent painted pixels', () => {
    const rows = ['##..##', '##..##', '......'];
    expect(opaqueRects(pixels(rows), 6, 3)).toEqual([
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 4, y: 0, width: 2, height: 2 },
    ]);
  });

  it('ignores barely visible antialias pixels', () => {
    const rgba = new Uint8ClampedArray(8);
    rgba[3] = 12;
    rgba[7] = 255;
    expect(opaqueRects(rgba, 2, 1)).toEqual([{ x: 1, y: 0, width: 1, height: 1 }]);
  });
});

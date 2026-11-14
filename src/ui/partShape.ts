import Phaser from 'phaser';
type Part = Phaser.GameObjects.Image | Phaser.GameObjects.Container;

export function partBounds(go: Part): Phaser.Geom.Rectangle {
  if (go instanceof Phaser.GameObjects.Image) return new Phaser.Geom.Rectangle(-go.displayWidth / 2, -go.displayHeight / 2, go.displayWidth, go.displayHeight);
  const images = go.list.filter((c): c is Phaser.GameObjects.Image => c instanceof Phaser.GameObjects.Image);
  if (!images.length) return new Phaser.Geom.Rectangle(-go.width / 2, -go.height / 2, go.width, go.height);
  const left = Math.min(...images.map(c => c.x - c.displayWidth * c.originX));
  const top = Math.min(...images.map(c => c.y - c.displayHeight * c.originY));
  const right = Math.max(...images.map(c => c.x + c.displayWidth * (1 - c.originX)));
  const bottom = Math.max(...images.map(c => c.y + c.displayHeight * (1 - c.originY)));
  return new Phaser.Geom.Rectangle(left, top, right - left, bottom - top);
}

/** Trace the actual art, including both fins and the engine bell. */
export function drawPartOutline(g: Phaser.GameObjects.Graphics, go: Part, color: number): void {
  g.lineStyle(1.5, color, 1);
  const images = go instanceof Phaser.GameObjects.Image ? [go] : go.list.filter((c): c is Phaser.GameObjects.Image => c instanceof Phaser.GameObjects.Image);
  for (const img of images) {
    const f = img.frame;
    const w = Math.max(1, Math.ceil(img.displayWidth));
    const h = Math.max(1, Math.ceil(img.displayHeight));
    const key = `outline:${f.texture.key}:${f.name}:${w}:${h}`;
    let mask = img.scene.registry.get(key) as Uint8ClampedArray | undefined;
    if (!mask) {
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, w, h);
      mask = ctx.getImageData(0, 0, w, h).data;
      img.scene.registry.set(key, mask);
    }
    const ox = go instanceof Phaser.GameObjects.Image ? 0 : img.x;
    const oy = go instanceof Phaser.GameObjects.Image ? 0 : img.y;
    const point = (x: number, y: number) => ({x: ox + (img.flipX ? w - x : x) - img.originX * w, y: oy + y - img.originY * h});
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask![(y * w + x) * 4 + 3] > 32;
    const line = (x: number, y: number, ex: number, ey: number) => { const a = point(x,y), b = point(ex,ey); g.lineBetween(a.x,a.y,b.x,b.y); };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solid(x,y)) {
      if (!solid(x-1,y)) line(x,y,x,y+1);
      if (!solid(x+1,y)) line(x+1,y,x+1,y+1);
      if (!solid(x,y-1)) line(x,y,x+1,y);
      if (!solid(x,y+1)) line(x,y+1,x+1,y+1);
    }
  }
  if (!images.length) { const b = partBounds(go); g.strokeRect(b.x,b.y,b.width,b.height); }
}

export function enablePartSelection(go: Part, select: (pointer: Phaser.Input.Pointer) => void): void {
  const images = go instanceof Phaser.GameObjects.Image ? [go] : go.list.filter((c): c is Phaser.GameObjects.Image => c instanceof Phaser.GameObjects.Image);
  for (const img of images) {
    img.setInteractive({ pixelPerfect: true, alphaTolerance: 16, useHandCursor: true });
    img.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => { event.stopPropagation(); select(_p); });
  }
  if (!images.length) {
    go.setInteractive();
    go.on('pointerdown', select);
  }
}

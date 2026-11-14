/**
 * orientation.ts — keep the landscape game full screen on phones and tablets.
 *
 * - The first tap on a touch device asks for real fullscreen and a landscape
 *   lock (Android Chrome, Samsung Internet, iPad Safari). iPhone Safari has no
 *   element fullscreen, so there the page relies on the dynamic-viewport CSS in
 *   index.html, or on "Add to Home Screen", which opens it chrome-free.
 * - In portrait a "rotate your device" card covers the squeezed canvas.
 * - Browsers report the new size late after a rotation, so the Phaser scale
 *   manager is refreshed again once the viewport settles.
 */
import { hasTouch } from './device';

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsDocument = Document & { webkitFullscreenElement?: Element | null };

function isFullscreen(): boolean {
  const d = document as FsDocument;
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** Must run inside a user gesture. Safe to call repeatedly; failures are silent. */
export function goFullscreenLandscape(): void {
  if (typeof document === 'undefined' || !hasTouch()) return;
  const el = document.documentElement as FsElement;
  const lock = (): void => {
    const o = screen.orientation as LockableOrientation | undefined;
    o?.lock?.('landscape').catch(() => { /* not supported or not fullscreen */ });
  };
  if (isFullscreen()) { lock(); return; }
  try {
    const req = el.requestFullscreen
      ? el.requestFullscreen({ navigationUI: 'hide' })
      : el.webkitRequestFullscreen?.();
    Promise.resolve(req).then(lock, () => { /* refused: keep the windowed page */ });
  } catch { /* old browser */ }
}

/** Call once at startup, after the Phaser game exists. */
export function watchOrientation(refresh: () => void): void {
  if (typeof window === 'undefined') return;

  const rotate = document.getElementById('rotate');
  const update = (): void => {
    const portrait = window.innerHeight > window.innerWidth;
    if (rotate) rotate.hidden = !(portrait && hasTouch());
  };
  const settle = (): void => {
    update();
    refresh();
    // iOS fires the event before the viewport has its final size
    setTimeout(() => { update(); refresh(); }, 250);
    setTimeout(() => { update(); refresh(); }, 700);
  };

  window.addEventListener('resize', settle);
  window.addEventListener('orientationchange', settle);
  window.visualViewport?.addEventListener('resize', settle);
  document.addEventListener('fullscreenchange', settle);
  update();

  // Every touch is a gesture fullscreen can use, so leaving fullscreen by accident
  // (a system swipe) is undone by the next tap.
  const onTouch = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    goFullscreenLandscape();
  };
  window.addEventListener('pointerup', onTouch, { passive: true });
}

/**
 * device.ts — which machine are we on, and which input does it actually use.
 *
 * The game ships two control schemes: keyboard (desktop) and an on-screen
 * thumbstick (phones and tablets). Which one is *correct* is not a fixed fact.
 * A tablet with a keyboard attached, a touchscreen laptop and a phone mirrored
 * to a monitor all change their answer mid-session, so the mode starts from the
 * device and is then corrected by the last real input event.
 *
 * Nothing here touches the DOM until a scene asks: every browser API is guarded
 * so the unit tests can import the module under node.
 */

export type InputMode = 'touch' | 'pointer';

const COARSE_QUERY = '(pointer: coarse)';
const FINE_QUERY = '(pointer: fine)';
/** A window this wide that also has a mouse is a desktop, not a tablet. */
const DESKTOP_VIEWPORT = 1024;

type ModeListener = (mode: InputMode) => void;

const listeners = new Set<ModeListener>();
let currentMode: InputMode = detectInitialMode();

function canUseDom(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function matches(query: string): boolean {
  return canUseDom() && window.matchMedia(query).matches;
}

/** True when the device has a touch digitizer, whatever its primary pointer is. */
export function hasTouch(): boolean {
  if (typeof window === 'undefined') return false;
  const points = typeof navigator !== 'undefined' ? (navigator.maxTouchPoints ?? 0) : 0;
  return points > 0 || 'ontouchstart' in window || matches(COARSE_QUERY);
}

/** True when there is no mouse or trackpad at all — a phone or a bare tablet. */
export function isCoarsePointerOnly(): boolean {
  return matches(COARSE_QUERY) && !matches(FINE_QUERY);
}

function detectInitialMode(): InputMode {
  if (!hasTouch()) return 'pointer';
  // A large viewport that also has a fine pointer is a desktop that happens to
  // own a touchscreen: the mouse stays primary until a finger actually lands.
  if (typeof window !== 'undefined' && window.innerWidth >= DESKTOP_VIEWPORT && matches(FINE_QUERY)) {
    return 'pointer';
  }
  return 'touch';
}

/** The input scheme the player is using right now. */
export function inputMode(): InputMode {
  return currentMode;
}

/** True while the on-screen thumbstick is the right thing to show. */
export function isTouchMode(): boolean {
  return currentMode === 'touch';
}

/** Force the mode (the input watcher does this on every real pointer event). */
export function setInputMode(next: InputMode): void {
  if (next === currentMode) return;
  currentMode = next;
  for (const listener of [...listeners]) listener(currentMode);
}

/** Subscribe to mode flips. Returns the unsubscribe function. */
export function onInputModeChange(listener: ModeListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Listen for the inputs that settle the question. Call once, from main.ts. */
export function watchInputMode(): void {
  if (typeof window === 'undefined') return;

  // Capture phase: the mode has to be right before a scene's own pointerdown
  // handler runs, otherwise the first tap on a hybrid device opens the wrong UI.
  window.addEventListener('pointerdown', (ev: PointerEvent) => {
    if (ev.pointerType === 'touch') {
      setInputMode('touch');
    } else if (ev.pointerType === 'mouse' && !isCoarsePointerOnly()) {
      setInputMode('pointer');
    }
  }, true);

  // Older iOS Safari fires touchstart long before any pointer event.
  window.addEventListener('touchstart', () => setInputMode('touch'), { capture: true, passive: true });

  // Rotating a phone to landscape, or a tablet docking to a keyboard, both
  // change the answer without any input event.
  if (canUseDom()) {
    const query = window.matchMedia('(pointer: coarse)');
    const onChange = () => setInputMode(detectInitialMode());
    query.addEventListener?.('change', onChange);
  }
}

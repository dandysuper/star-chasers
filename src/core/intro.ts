/**
 * intro.ts — the trailer that plays once, on the very first launch.
 *
 * It is a plain DOM overlay above the Phaser canvas, so the game keeps loading
 * its assets underneath while the video plays. BootScene waits on `introDone`
 * before it opens the menu, which also keeps the menu music from starting
 * under the trailer.
 *
 * Browsers only allow autoplay with sound after a user gesture, so the video
 * first tries to play with sound, falls back to muted autoplay with a
 * "tap for sound" pill, and, if even that is blocked (iOS Low Power Mode),
 * shows a big play button. Skipping needs a deliberate hold, so a stray tap
 * cannot throw the trailer away.
 */
import { goFullscreenLandscape } from './orientation';

const SEEN_KEY = 'starchasers.intro.v1';
const SAVE_KEY = 'starchasers.save.v1';
const VIDEO_SRC = 'assets/intro/intro.mp4';
/** How long the skip button (or Space / Enter / Esc) has to be held. */
const HOLD_MS = 900;

const TEXT = {
  ru: { skip: 'Удерживайте, чтобы пропустить', sound: '🔊 Нажмите для звука', play: 'Смотреть' },
  en: { skip: 'Hold to skip', sound: '🔊 Tap for sound', play: 'Play' },
};

function lang(): 'ru' | 'en' {
  const pinned = new URLSearchParams(location.search).get('lang');
  if (pinned === 'en' || pinned === 'ru') return pinned;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw && (JSON.parse(raw) as { lang?: string }).lang === 'en') return 'en';
  } catch { /* unreadable save: default language */ }
  return 'ru';
}

function alreadySeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: it may replay */ }
}

/** Dev links (`?scene=`, `?dev`) and `?nointro` go straight to the game. */
function bypassed(): boolean {
  const q = new URLSearchParams(location.search);
  return q.has('scene') || q.has('dev') || q.has('nointro');
}

const CSS = `
#intro { position: fixed; inset: 0; z-index: 30; background: #000; display: flex;
  align-items: center; justify-content: center; touch-action: none; }
#intro video { width: 100%; height: 100%; object-fit: contain; background: #000; }
#intro button { font: 600 16px/1.2 system-ui, sans-serif; color: #fff; border: 0; cursor: pointer;
  -webkit-tap-highlight-color: transparent; touch-action: none; }
#intro .skip { position: absolute; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom));
  padding: 12px 18px; border-radius: 999px; background: rgba(11,11,42,.65); overflow: hidden;
  border: 2px solid rgba(255,255,255,.6); user-select: none; -webkit-user-select: none; }
#intro .skip i { position: absolute; inset: 0; width: 0; background: #ff8a2a; z-index: -1; }
#intro .skip span { position: relative; }
#intro .skip { isolation: isolate; }
#intro .sound { position: absolute; left: max(16px, env(safe-area-inset-left)); bottom: max(16px, env(safe-area-inset-bottom));
  padding: 12px 18px; border-radius: 999px; background: rgba(11,11,42,.65); border: 2px solid rgba(255,255,255,.6); }
#intro .play { position: absolute; padding: 18px 34px; font-size: 22px; border-radius: 999px; background: #ff8a2a;
  border: 3px solid #fff; }
#intro.out { transition: opacity .4s; opacity: 0; }
`;

function shouldPlay(): boolean {
  return typeof document !== 'undefined' && !alreadySeen() && !bypassed();
}

function playIntro(): Promise<void> {
  return new Promise((resolve) => {
    const t = TEXT[lang()];
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'intro';
    const video = document.createElement('video');
    video.src = VIDEO_SRC;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    video.disablePictureInPicture = true;

    const skip = document.createElement('button');
    skip.className = 'skip';
    skip.innerHTML = `<i></i><span>${t.skip}</span>`;
    const fill = skip.querySelector('i') as HTMLElement;

    const sound = document.createElement('button');
    sound.className = 'sound';
    sound.textContent = t.sound;
    sound.hidden = true;

    const play = document.createElement('button');
    play.className = 'play';
    play.textContent = `▶ ${t.play}`;
    play.hidden = true;

    root.append(video, skip, sound, play);
    document.body.appendChild(root);

    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      markSeen();
      cancelHold();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      video.pause();
      root.classList.add('out');
      setTimeout(() => { root.remove(); style.remove(); }, 400);
      resolve();
    };

    // Playback has started, so the trailer counts as seen even if the tab
    // closes halfway through.
    video.addEventListener('playing', markSeen, { once: true });
    video.addEventListener('ended', finish);
    video.addEventListener('error', finish);

    const start = (): void => {
      video.muted = false;
      video.play().catch(() => {
        video.muted = true;
        video.play().then(() => { sound.hidden = false; }).catch(() => { play.hidden = false; });
      });
    };

    // Any tap is a user gesture: use it for sound and, on phones, fullscreen.
    const unmute = (): void => {
      goFullscreenLandscape();
      if (video.muted) {
        video.muted = false;
        sound.hidden = true;
      }
    };
    video.addEventListener('pointerup', unmute);
    sound.addEventListener('pointerup', (e) => { e.stopPropagation(); unmute(); });
    play.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      goFullscreenLandscape();
      play.hidden = true;
      video.muted = false;
      video.play().catch(finish);
    });

    // ---- hold to skip ----
    let holdStart = 0;
    let raf = 0;
    const tick = (): void => {
      const p = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
      fill.style.width = `${p * 100}%`;
      if (p >= 1) { finish(); return; }
      raf = requestAnimationFrame(tick);
    };
    const beginHold = (): void => {
      if (holdStart || finished) return;
      holdStart = performance.now();
      raf = requestAnimationFrame(tick);
    };
    function cancelHold(): void {
      holdStart = 0;
      cancelAnimationFrame(raf);
      fill.style.transition = 'width .2s';
      fill.style.width = '0';
      setTimeout(() => { fill.style.transition = ''; }, 200);
    }
    skip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      skip.setPointerCapture?.(e.pointerId);
      beginHold();
    });
    skip.addEventListener('pointerup', (e) => { e.stopPropagation(); cancelHold(); });
    skip.addEventListener('pointercancel', cancelHold);
    skip.addEventListener('contextmenu', (e) => e.preventDefault());

    const HOLD_KEYS = new Set([' ', 'Enter', 'Escape']);
    function onKeyDown(e: KeyboardEvent): void {
      if (!HOLD_KEYS.has(e.key)) return;
      e.preventDefault();
      beginHold();
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (HOLD_KEYS.has(e.key)) cancelHold();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    start();
  });
}

/** Resolves when the intro has finished, been skipped, or was not needed. */
export const introDone: Promise<void> = shouldPlay() ? playIntro() : Promise.resolve();

/** Synchronous mirror of `introDone`, for Phaser update loops. */
export let introFinished = false;
void introDone.then(() => { introFinished = true; });

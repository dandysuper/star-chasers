import Phaser from 'phaser';
import { watchInputMode } from './core/device';
import { useMediaAudioSession } from './core/audioState';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { HubScene } from './scenes/HubScene';
import { BuilderScene } from './scenes/BuilderScene';
import { CodeScene } from './scenes/CodeScene';
import { FlightScene } from './scenes/FlightScene';
import { ExploreScene } from './scenes/ExploreScene';
import { ResultScene } from './scenes/ResultScene';

// Phones start reporting touch *after* the first layout, so the input mode is
// derived once here and then corrected by the first real pointer event.
watchInputMode();
useMediaAudioSession();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#0b0b2a',
  pixelArt: false,
  dom: { createContainer: true },
  input: {
    activePointers: 3,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scene: [BootScene, MenuScene, HubScene, BuilderScene, CodeScene, FlightScene, ExploreScene, ResultScene],
});

// Uncaught errors inside a Phaser frame arrive as a bare message, which made a
// repeating one impossible to locate. In dev runs, print the stack instead.
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev')) {
  window.addEventListener('error', (ev) => {
    const err = ev.error as Error | undefined;
    console.log('UNCAUGHT', ev.message, err?.stack ?? `${ev.filename}:${ev.lineno}:${ev.colno}`);
  });
}

// expose for debugging / tests
(window as unknown as { __game?: Phaser.Game }).__game = game;
export { game };

import Phaser from 'phaser';
import { watchInputMode } from './core/device';
import { useMediaAudioSession } from './core/audioState';
import { watchOrientation } from './core/orientation';
// starts the first-launch trailer (if due) before the game boots underneath it
import './core/intro';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { HubScene } from './scenes/HubScene';
import { BuilderScene } from './scenes/BuilderScene';
import { FlightScene } from './scenes/FlightScene';
import { ExploreScene } from './scenes/ExploreScene';
import { ResultScene } from './scenes/ResultScene';
import { PlannerScene } from './scenes/PlannerScene';
import { LabScene } from './scenes/LabScene';

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
  // Trilinear filtering for power-of-two textures. The overhaul art is packed
  // into power-of-two pages for this: rocket parts are delivered 6x larger
  // than the builder draws them, and without mipmaps they shimmer.
  render: { mipmapFilter: 'LINEAR_MIPMAP_LINEAR' },
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
  scene: [BootScene, MenuScene, HubScene, BuilderScene, FlightScene, ExploreScene, ResultScene, PlannerScene, LabScene],
});

watchOrientation(() => game.scale.refresh());
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

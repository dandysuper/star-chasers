import Phaser from 'phaser';
import { loadSave } from '../core/save';
import { t } from '../core/i18n';
import { TXT } from '../ui/widgets';
import { UI, V2, BG_FILES } from '../ui/theme';
import { devSceneOverride, devMissionOverride, devLangOverride } from '../core/devtools';
import { state } from '../core/state';
import { PRESET_BASIC } from '../data/parts';
import { STARTER_PROGRAM, MISSIONS } from '../data/missions';
import { musicAssetFiles } from '../core/themeTracks';

export class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }

  preload(): void {
    const { width, height } = this.scale;
    const label = this.add.text(width / 2, height / 2, t('boot.loading'), TXT.h2).setOrigin(0.5);
    const bar = this.add.rectangle(width / 2, height / 2 + 50, 400, 16, 0x2b2d5c)
      .setStrokeStyle(3, 0x1d1b2e).setOrigin(0.5);
    const fill = this.add.rectangle(width / 2 - 197, height / 2 + 50, 0, 10, 0xffd23f).setOrigin(0, 0.5);
    this.load.on('progress', (v: number) => { fill.width = 394 * v; });
    void label; void bar;

    this.load.image('world_map', 'assets/maps/world_map.webp');

    // soundtrack: one looping bed per room plus the victory sting. The list
    // comes from the track registry so a new theme only has to be added there.
    for (const track of musicAssetFiles()) this.load.audio(track.key, track.file);

    // ui_v1 art: one packed atlas of sprite frames + the nine painted backdrops
    this.load.atlas(UI, 'assets/ui/ui.png', 'assets/ui/ui.json');
    for (const [key, stem] of Object.entries(BG_FILES)) {
      this.load.image(key, `assets/bg/${stem}.webp`);
    }

    for (const key of [
      'astro_female', 'astro_female_walk', 'astro_male', 'astro_male_walk',
      'minions', 'resources', 'tools_v2', 'machines', 'terrain', 'terrain_v2',
    ]) {
      this.load.atlas(key, `assets/atlases/${key}.png`, `assets/atlases/${key}.json`);
    }
    this.load.json('anims_female', 'assets/anims/astro_female_walk_anims.json');
    this.load.json('anims_male', 'assets/anims/astro_male_walk_anims.json');

    // v2 wishlist art: base buildings, ground tiles, crew walks, exhaust plumes
    this.load.atlas(V2, 'assets/v2/v2.png', 'assets/v2/v2.json');
    this.load.json('anims_crew', 'assets/anims/crew_walk_anims.json');
  }

  create(): void {
    const hadSave = loadSave();
    // ?lang= pins the language for this run — applied after the save load,
    // otherwise the stored preference wins
    const pinnedLang = devLangOverride();
    if (pinnedLang) state.lang = pinnedLang;
    // build walk anims for both astronauts once, at boot
    for (const g of ['female', 'male'] as const) {
      const data = this.cache.json.get(`anims_${g}`);
      if (data?.anims) this.anims.fromJSON(data);
    }
    // crew walk cycles for the v2 minion sheets
    const crewAnims = this.cache.json.get('anims_crew');
    if (crewAnims?.anims) this.anims.fromJSON(crewAnims);
    if (!hadSave && localStorage.getItem('starchasers.save.v1')) {
      (this.game as Phaser.Game & { __saveReset?: boolean }).__saveReset = true;
    }
    // transition on the next update — scene.start inside create() can be
    // swallowed while the loader is still flushing its queue
    this._go = true;
  }

  private _go = false;
  override update(): void {
    if (!this._go) return;
    this._go = false;
    const target = devSceneOverride();
    if (!target || target === 'menu') {
      this.scene.start('menu');
      return;
    }
    // ?mission=… boots a real mission from the requested scene
    const missionId = devMissionOverride();
    const mission = missionId ? MISSIONS[missionId] : undefined;
    if (mission) {
      state.mode = 'mission';
      state.missionId = mission.id;
      const parts = mission.allowedParts.length
        ? PRESET_BASIC.filter((id) => mission.allowedParts.includes(id))
        : [];
      if (parts.length) {
        state.design = { parts };
        state.designs[state.designKey()] = { parts };
      }
    } else if (state.design.parts.length === 0) {
      // jumping straight into a flight scene needs a rocket to fly
      state.mode = 'sandbox';
      state.missionId = null;
      state.design = { parts: [...PRESET_BASIC] };
      state.designs[state.designKey()] = { parts: [...PRESET_BASIC] };
    }
    if (target === 'flight' && !state.program) {
      state.program = mission?.starterProgram ?? STARTER_PROGRAM;
    }
    this.scene.start(target);
  }
}

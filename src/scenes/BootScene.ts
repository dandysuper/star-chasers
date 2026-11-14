import Phaser from 'phaser';
import { loadSave } from '../core/save';
import { t } from '../core/i18n';
import { TXT } from '../ui/widgets';
import { UI, V2, BG_FILES } from '../ui/theme';
import { devSceneOverride, devMissionOverride, devLangOverride } from '../core/devtools';
import { state } from '../core/state';
import { PRESET_BASIC } from '../data/parts';
import { MISSIONS } from '../data/missions';
import { introFinished } from '../core/intro';
import { musicAssetFiles, TRACKS, VICTORY_JINGLE } from '../core/themeTracks';
import { preloadMinionAudio } from '../core/minionAudio';
import { installOverhaul, queueOverhaul } from '../ui/overhaul';

interface PlanetManifest {
  images?: { key: string; file: string }[];
}

interface RoverManifest {
  images?: { key: string; file: string }[];
  audio?: { key: string; file: string }[];
}

export class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }

  preload(): void {
    // NASA Space Apps Challenge 2026 logo (official white-and-colour version), main menu only
    this.load.image('spaceapps_logo', 'assets/brand/spaceapps_logo.png');
    const { width, height } = this.scale;
    const label = this.add.text(width / 2, height / 2, t('boot.loading'), TXT.h2).setOrigin(0.5);
    const bar = this.add.rectangle(width / 2, height / 2 + 50, 400, 16, 0x2b2d5c)
      .setStrokeStyle(3, 0x1d1b2e).setOrigin(0.5);
    const fill = this.add.rectangle(width / 2 - 197, height / 2 + 50, 0, 10, 0xffd23f).setOrigin(0, 0.5);
    this.load.on('progress', (v: number) => { fill.width = 394 * v; });
    void label; void bar;


    // soundtrack: only the menu bed and the victory sting block the first
    // screen; the other themes load in the background (prefetchMusic)
    for (const track of musicAssetFiles()) {
      if (track.key === TRACKS.menu.assetKey || track.key === VICTORY_JINGLE.assetKey) {
        this.load.audio(track.key, track.file);
      }
    }

    // minion recordings: whatever the importer has actually written into
    // src/data/minionAudio.ts, which is nothing at all until a batch lands
    preloadMinionAudio(this);

    // ui_v1 art: one packed atlas of sprite frames
    this.load.atlas(UI, 'assets/ui/ui.png', 'assets/ui/ui.json');

    // Optional art overhaul (artoverhaul.md). It also decides where each
    // painted backdrop comes from: the overhaul file when the manifest lists
    // one, today's assets/bg/ file otherwise.
    queueOverhaul(this, BG_FILES);

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

    // Optional planet art (reqassets.md). The manifest lists only the files
    // that actually exist, so a missing drop costs nothing and logs no 404s;
    // every lookup falls back to the tinted atlas art.
    this.load.on('filecomplete-json-planet_manifest', (_key: string, _type: string, data: PlanetManifest) => {
      for (const img of data?.images ?? []) {
        if (img?.key && img?.file) this.load.image(img.key, `assets/planets/${img.file}`);
      }
    });
    this.load.json('planet_manifest', 'assets/planets/manifest.json');

    // Optional rover art and sounds (roverassets.md), same contract: only the
    // files listed exist. Until they do, the rover drives on the machines
    // sprite with drawn tracks and no engine sound.
    this.load.on('filecomplete-json-rover_manifest', (_key: string, _type: string, data: RoverManifest) => {
      for (const img of data?.images ?? []) {
        if (img?.key && img?.file) this.load.image(img.key, `assets/rover/${img.file}`);
      }
      for (const clip of data?.audio ?? []) {
        if (clip?.key && clip?.file) this.load.audio(clip.key, `assets/rover/${clip.file}`);
      }
    });
    this.load.json('rover_manifest', 'assets/rover/manifest.json');
  }

  create(): void {
    const hadSave = loadSave();
    // ?lang= pins the language for this run — applied after the save load,
    // otherwise the stored preference wins
    const pinnedLang = devLangOverride();
    if (pinnedLang) state.lang = pinnedLang;
    // overhaul frames replace atlas frames, so this has to run before any
    // animation is built from frame names
    const overhaul = installOverhaul(this);
    if (new URLSearchParams(location.search).has('dev')) console.log('overhaul', JSON.stringify(overhaul));
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
    // the first-launch trailer plays over the loaded game; open the menu after it
    if (!this._go || !introFinished) return;
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
    this.scene.start(target);
  }
}

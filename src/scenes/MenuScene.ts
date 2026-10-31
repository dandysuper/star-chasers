import Phaser from 'phaser';
import { state } from '../core/state';
import { saveGame } from '../core/save';
import { t } from '../core/i18n';
import { MISSIONS, MISSION_ORDER } from '../data/missions';
import { makeButton, makeIconButton, makePanel, ensureMusic, TXT, type ButtonVariant } from '../ui/widgets';
import { UI, BG, hasFrame, starFrame, addStarRow, UI_V2_ART, hasV2 } from '../ui/theme';

export class MenuScene extends Phaser.Scene {
  private ui: Phaser.GameObjects.GameObject[] = [];
  private missionList?: Phaser.GameObjects.Container;
  private missionButtons: Phaser.GameObjects.Container[] = [];

  constructor() { super('menu'); }

  create(): void {
    ensureMusic(this, state.music);
    this.renderUI();
    const game = this.game as Phaser.Game & { __saveReset?: boolean };
    if (game.__saveReset) {
      game.__saveReset = false;
      this.toast(t('toast.save_reset'));
    }
  }

  private renderUI(): void {
    for (const o of this.ui) o.destroy();
    this.ui = [];
    this.missionList?.destroy();
    this.missionList = undefined;
    for (const b of this.missionButtons) b.destroy();
    this.missionButtons = [];

    const { width, height } = this.scale;

    // ---- backdrop: painted launchpad scene, else the old tinted map ----
    if (this.textures.exists(BG.menu)) {
      const bg = this.add.image(width / 2, height / 2, BG.menu).setDisplaySize(width, height);
      this.ui.push(bg);
      // even dim so the painted scene keeps its contrast but text stays legible
      this.ui.push(this.add.rectangle(width / 2, height / 2, width, height, 0x120f24, 0.28));
    } else {
      const bg = this.add.image(width / 2, height / 2, 'world_map');
      bg.setDisplaySize(width, height).setTint(0x666688);
      this.ui.push(bg);
      this.ui.push(this.add.rectangle(width / 2, height / 2, width, height, 0x0b0b2a, 0.55));
    }

    // ---- logo ----
    if (hasFrame(this, 'logo')) {
      this.ui.push(this.add.image(width / 2, 104, UI, 'logo').setDisplaySize(392, 198));
    } else {
      this.ui.push(this.add.text(width / 2, 90, t('menu.title'), { ...TXT.title, fontSize: '56px' }).setOrigin(0.5));
    }

    // ---- tagline: left column, clear of the painted rocket ----
    // the plate is created first so it renders under the text
    const taglineX = 70;
    const taglineY = 246;
    const plate = this.add.graphics();
    const tagline = this.add.text(taglineX, taglineY, t('menu.subtitle'), {
      ...TXT.h2, fontSize: '19px', color: '#ffd23f', stroke: '#1d1b2e', strokeThickness: 5,
    }).setOrigin(0, 0.5);
    plate.fillStyle(0x120f24, 0.55);
    plate.fillRoundedRect(taglineX - 12, taglineY - tagline.height / 2 - 6,
      tagline.width + 24, tagline.height + 12, 10);
    this.ui.push(plate, tagline);

    // ---- astronaut crew on the pad ----
    const g = state.astronaut;
    const astro = this.add.sprite(940, height - 150, `${g === 'female' ? 'astro_female' : 'astro_male'}`, `astro_${g}_front`);
    astro.setScale(1.15);
    this.ui.push(astro);
    this.tweens.add({ targets: astro, y: astro.y - 7, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    ['minions_mechanic', 'minions_miner_driller', 'minions_radio_scout', 'minions_chemist'].forEach((f, i) => {
      const m = this.add.sprite(1040 + (i % 2) * 74, height - 132 + Math.floor(i / 2) * 62, 'minions', f).setScale(0.66);
      this.ui.push(m);
      this.tweens.add({ targets: m, y: m.y - 9, duration: 600 + i * 130, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    });

    // ---- main column ----
    const bx = 220;
    let by = 300;
    const btn = (label: string, cb: () => void, variant: ButtonVariant, w = 300) => {
      const b = makeButton(this, bx, by, label, { w, h: 62, fontSize: 21, variant, onClick: cb });
      this.ui.push(b);
      by += 76;
      return b;
    };
    btn(t('menu.play'), () => this.toggleMissionList(), 'yellow');
    btn(t('menu.sandbox'), () => {
      state.mode = 'sandbox';
      state.missionId = null;
      this.scene.start('hub');
    }, 'blue');
    btn(`${t('menu.astro')}: ${t(state.astronaut === 'female' ? 'astro.f' : 'astro.m')}`, () => {
      state.astronaut = state.astronaut === 'female' ? 'male' : 'female';
      saveGame();
      this.renderUI();
    }, 'purple', 300);

    // ---- top-right toggles ----
    const langFrame = state.lang === 'ru' ? 'ico_ru' : 'ico_en';
    this.ui.push(this.add.text(width - 130, 34, t('menu.lang'), { ...TXT.small, fontSize: '12px' }).setOrigin(0.5, 0));
    this.ui.push(makeIconButton(this, width - 130, 74, langFrame, () => {
      state.lang = state.lang === 'ru' ? 'en' : 'ru';
      saveGame();
      this.renderUI();
    }, 54));

    const soundFrame = state.music ? 'ico_sound' : 'ico_mute';
    this.ui.push(this.add.text(width - 60, 34, t('menu.sound'), { ...TXT.small, fontSize: '12px' }).setOrigin(0.5, 0));
    this.ui.push(makeIconButton(this, width - 60, 74, soundFrame, () => {
      state.music = !state.music;
      saveGame();
      ensureMusic(this, state.music);
      this.renderUI();
    }, 54));

    if (state.dev) {
      this.ui.push(this.add.text(12, 16, 'DEV — all missions unlocked', {
        ...TXT.small, fontSize: '12px', color: '#7ac74f',
      }).setOrigin(0, 0));
      this.pushCalibrationGrid();
    }
  }

  /** ?dev=1 draws a game-unit grid so click targets can be read straight off a
   *  screenshot — the canvas is letterboxed, so screen pixels ≠ game units. */
  private pushCalibrationGrid(): void {
    const g = this.add.graphics().setDepth(900);
    g.lineStyle(1, 0x00ff88, 0.35);
    for (let x = 0; x <= this.scale.width; x += 100) g.lineBetween(x, 0, x, this.scale.height);
    for (let y = 0; y <= this.scale.height; y += 100) g.lineBetween(0, y, this.scale.width, y);
    this.ui.push(g);
    for (let x = 100; x < this.scale.width; x += 200) {
      for (let y = 100; y < this.scale.height; y += 200) {
        this.ui.push(this.add.text(x + 3, y + 2, `${x},${y}`, {
          ...TXT.small, fontSize: '11px', color: '#00ff88',
        }).setDepth(901));
      }
    }
  }

  private toggleMissionList(): void {
    if (this.missionList) {
      this.missionList.destroy();
      this.missionList = undefined;
      for (const b of this.missionButtons) b.destroy();
      this.missionButtons = [];
      return;
    }
    const { width } = this.scale;
    // buttons live at absolute coordinates: makeButton's hit zone is a sibling
    // of the visual container, so re-parenting the container would leave the
    // hit target behind
    const listX = width / 2 + 250;
    const listY = 170;
    const c = this.add.container(listX, listY);
    this.missionList = c;

    // the painted panel's rim eats ~70 px at the bottom, and each row carries a
    // two-line brief, so the panel gets extra room beyond the row stack
    const listH = MISSION_ORDER.length * 112 + 150;
    c.add(makePanel(this, -260, -16, 520, listH, 0.97));
    c.add(this.add.text(0, 4, t('menu.missions'), TXT.h2).setOrigin(0.5, 0));

    MISSION_ORDER.forEach((id, i) => {
      const m = MISSIONS[id];
      const unlocked = state.missionUnlocked(id, MISSION_ORDER);
      const prog = state.progress[id];
      const y = 62 + i * 112;

      const b = makeButton(this, listX, listY + y, t(m.titleKey), {
        w: 470, h: 66, fontSize: 21,
        variant: unlocked ? 'blue' : 'purple',
        onClick: () => {
          if (!unlocked) { this.toast(t('menu.locked')); return; }
          state.mode = 'mission';
          state.missionId = id;
          // every route goes through the base — you walk to the pad to fly
          this.scene.start('hub');
        },
      });
      b.setAlpha(unlocked ? 1 : 0.55);
      this.missionButtons.push(b);

      // star row (batch3 isolated stars preferred; ui_v1 plaque fallback)
      const stars = prog?.stars ?? 0;
      if (hasV2(this, UI_V2_ART.starFull)) {
        const sr = addStarRow(this, 164, y, stars, 26, 4);
        if (!unlocked) sr.setAlpha(0.4);
        c.add(sr);
      } else {
        const sf = starFrame(stars);
        if (hasFrame(this, sf.frame)) {
          const plaque = this.add.image(150, y, UI, sf.frame).setDisplaySize(96, 34);
          if (sf.dim) plaque.setTint(0x6a6a86);
          if (!unlocked) plaque.setAlpha(0.4);
          c.add(plaque);
        }
      }

      c.add(this.add.text(0, y + 38, t(m.briefKey), { ...TXT.small, fontSize: '13px', wordWrap: { width: 440 }, align: 'center' })
        .setOrigin(0.5, 0));
    });
  }

  private toast(msg: string): void {
    const { width, height } = this.scale;
    const p = makePanel(this, width / 2 - 260, height - 118, 520, 64, 0.98);
    const txt = this.add.text(width / 2, height - 86, msg, TXT.body).setOrigin(0.5);
    this.tweens.add({ targets: [p, txt], alpha: 0, delay: 2400, duration: 400, onComplete: () => { p.destroy(); txt.destroy(); } });
  }
}

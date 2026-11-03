import Phaser from 'phaser';
import { state } from '../core/state';
import { saveGame } from '../core/save';
import { t, fmtDist, fmtTime } from '../core/i18n';
import { missionById, MISSION_ORDER } from '../data/missions';
import { makeButton, makePanel, ensureMusic, TXT, type ButtonVariant } from '../ui/widgets';
import { playVictoryJingle } from '../ui/music';
import { UI, BG, hasFrame, starFrame } from '../ui/theme';

interface ResultData {
  result: {
    success: boolean;
    failKey?: string;
    failVars?: Record<string, string | number>;
    maxAltitude: number;
    fuelPercent: number;
    time: number;
    blocks: number;
    samples?: number;
  };
  stars: number;
}

const PANEL_W = 700;
const PANEL_H = 648;
/** The painted panel has a thick ornate rim — content lives inside this inset. */
const RIM_TOP = 78;
const RIM_BOTTOM = 68;
/** Usable text width inside the ornate frame (frame is narrower than PANEL_W). */
const INNER_W = 548;

export class ResultScene extends Phaser.Scene {
  constructor() { super('result'); }

  create(data: ResultData): void {
    ensureMusic(this, state.music);
    // the win gets its own fanfare over the theme; a failure stays on the bed
    if (data.result.success) playVictoryJingle(this);
    saveGame();
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(0x0b0b2a);
    const r = data.result;
    const mission = missionById(state.missionId);

    // ---- painted backdrop for the outcome ----
    const bgKey = r.success ? BG.resultWin : BG.resultFail;
    if (this.textures.exists(bgKey)) {
      this.add.image(width / 2, height / 2, bgKey).setDisplaySize(width, height);
      this.add.rectangle(width / 2, height / 2, width, height, 0x0b0b2a, 0.3);
    } else {
      const bg = this.add.image(width / 2, height / 2, 'world_map');
      bg.setDisplaySize(width, height).setTint(0x444466).setAlpha(0.6);
    }

    const panel = this.add.container(width / 2, height / 2 - 2);
    panel.add(makePanel(this, -PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 0.97));

    const innerTop = -PANEL_H / 2 + RIM_TOP;
    const innerBottom = PANEL_H / 2 - RIM_BOTTOM;
    let y = innerTop;

    // ---- headline ----
    panel.add(this.add.text(0, y, r.success ? t('result.success') : t('result.fail'), {
      ...TXT.title, fontSize: '34px',
      color: r.success ? '#7ac74f' : '#ffb3b3',
      stroke: '#1d1b2e', strokeThickness: 6,
    }).setOrigin(0.5, 0));
    y += 50;

    // ---- star plaque ----
    const sf = starFrame(r.success ? data.stars : 0);
    if (hasFrame(this, sf.frame)) {
      const plaque = this.add.image(0, y + 44, UI, sf.frame).setDisplaySize(248, 86);
      if (sf.dim) plaque.setTint(0x70708c);
      panel.add(plaque);
    } else {
      const starStr = r.success ? '★'.repeat(data.stars) + '☆'.repeat(3 - data.stars) : '☆☆☆';
      panel.add(this.add.text(0, y + 44, starStr, {
        fontFamily: 'system-ui', fontSize: '42px', color: '#ffd23f',
      }).setOrigin(0.5));
    }
    y += 104;

    // ---- why it failed ----
    if (!r.success && r.failKey) {
      const reason = this.add.text(0, y, t(r.failKey, r.failVars), {
        ...TXT.body, fontSize: '17px', lineSpacing: 4,
        wordWrap: { width: INNER_W }, align: 'center', color: '#ffd2d2',
      }).setOrigin(0.5, 0);
      panel.add(reason);
      y += reason.height + 14;
    }

    // ---- one-line fun fact ----
    if (mission) {
      const fact = this.add.text(0, y, `${t('result.fact')}: ${t(mission.factKey)}`, {
        ...TXT.small, fontSize: '15px', color: '#ffe8a3',
        wordWrap: { width: INNER_W }, align: 'center', lineSpacing: 4,
      }).setOrigin(0.5, 0);
      panel.add(fact);
      y += fact.height + 18;
    }

    // ---- divider ----
    const divider = this.add.graphics();
    divider.lineStyle(2, 0xffd23f, 0.35);
    divider.lineBetween(-INNER_W / 2 + 20, y, INNER_W / 2 - 20, y);
    panel.add(divider);
    y += 20;

    // ---- stats ----
    const stats: [string, string][] = r.samples !== undefined
      ? [
          [t('result.stats.samples'), `${r.samples}`],
          [t('result.stats.time'), fmtTime(r.time)],
        ]
      : [
          [t('result.stats.max_alt'), fmtDist(r.maxAltitude)],
          [t('result.stats.fuel'), `${Math.round(r.fuelPercent * 100)}%`],
          [t('result.stats.blocks'), `${r.blocks}`],
          [t('result.stats.time'), fmtTime(r.time)],
        ];
    const ROW_H = 34;
    const LABEL_X = -18;
    const VALUE_X = 18;
    let sy = y + ROW_H / 2;
    for (const [k, v] of stats) {
      panel.add(this.add.text(LABEL_X, sy, k, {
        ...TXT.small, fontSize: '16px', color: '#cfd2ee',
      }).setOrigin(1, 0.5));
      panel.add(this.add.text(VALUE_X, sy, v, {
        ...TXT.body, fontSize: '19px', color: '#ffd23f',
      }).setOrigin(0, 0.5));
      sy += ROW_H;
    }

    // ---- buttons, pinned above the bottom rim ----
    const isMoon = state.missionId === 'moon';
    const mk = (label: string, variant: ButtonVariant, cb: () => void, bx: number, by: number, w = 250) => {
      panel.add(makeButton(this, bx, by, label, { w, h: 48, fontSize: 18, variant, onClick: cb }));
    };
    const rowTwo = innerBottom - 34;
    const rowOne = rowTwo - 66;

    if (isMoon) {
      mk(t('result.retry'), 'orange', () => this.scene.start('explore'), -150, rowTwo);
      mk(t('result.menu'), 'green', () => this.scene.start('menu'), 150, rowTwo);
      return;
    }

    mk(t('result.retry'), 'orange', () => this.scene.start('flight'), -150, rowOne);
    mk(t('result.edit'), 'blue', () => this.scene.start('code'), 150, rowOne);
    mk(t('result.rebuild'), 'purple', () => this.scene.start('builder'), -150, rowTwo);

    if (r.success) {
      const next = MISSION_ORDER[MISSION_ORDER.indexOf(state.missionId ?? 'm1') + 1];
      if (next) {
        mk(t('result.next'), 'green', () => {
          state.missionId = next;
          state.mode = 'mission';
          this.scene.start(next === 'moon' ? 'explore' : 'builder');
        }, 150, rowTwo);
      } else {
        mk(t('result.menu'), 'green', () => this.scene.start('menu'), 150, rowTwo);
      }
    } else {
      mk(t('result.menu'), 'green', () => this.scene.start('menu'), 150, rowTwo);
    }
  }
}

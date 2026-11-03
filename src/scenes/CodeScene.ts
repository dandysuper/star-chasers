import Phaser from 'phaser';
import * as Blockly from 'blockly';
import { state } from '../core/state';
import { saveGame } from '../core/save';
import { t } from '../core/i18n';
import { missionById, STARTER_PROGRAM } from '../data/missions';
import { computeStats } from '../physics/rocket';
import { compileBlocklyJSON } from '../rocketscript/compile';
import { defineRocketScriptBlocks, rsTheme, toolboxJSON } from '../rocketscript/blocks';
import { makeButton, makePanel, ensureMusic, TXT } from '../ui/widgets';
import { InGameMenu } from '../ui/ingameMenu';
import { BG, V2, UI_V2_ART, hasV2 } from '../ui/theme';

const BLOCKLY_SPLIT = 0.73;   // fraction of the canvas width given to Blockly
const BAR_H = 64;

export class CodeScene extends Phaser.Scene {
  private ws?: Blockly.WorkspaceSvg;
  private blocklyDiv?: HTMLElement;
  private rightPanel?: Phaser.GameObjects.Container;
  private errMsg?: Phaser.GameObjects.Text;
  private blockCountText?: Phaser.GameObjects.Text;
  private inGameMenu!: InGameMenu;

  constructor() { super('code'); }

  create(): void {
    ensureMusic(this, state.music);
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(0x0b0b2a);

    // ---- mission-control backdrop, visible around the workspace ----
    if (this.textures.exists(BG.code)) {
      this.add.image(width / 2, height / 2, BG.code).setDisplaySize(width, height).setAlpha(0.55);
    }

    // ---- Blockly host div fills the left column ----
    // It lives in PAGE pixels while the scene thinks in game units (1280×720
    // fitted into the viewport), so convert through the canvas bounds —
    // otherwise the div overhangs the right panel and the bottom bar.
    const div = document.getElementById('blockly-div') as HTMLElement;
    this.blocklyDiv = div;
    div.style.display = 'block';
    div.style.visibility = 'visible';
    this.layoutBlocklyDiv();

    const relayout = () => this.layoutBlocklyDiv();
    this.scale.on(Phaser.Scale.Events.RESIZE, relayout);

    // The Blockly div is a plain DOM element stacked above the canvas, so it
    // must be taken down however this scene ends — not only on the leave()
    // paths. A Phaser Scene has no shutdown() method to override; the exit
    // hook is the shutdown event. Left behind, the div keeps covering 73% of
    // the screen and silently swallows every click in the scenes that follow.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, relayout);
      this.disposeBlockly();
    });

    defineRocketScriptBlocks();
    this.ws = Blockly.inject(div, {
      theme: rsTheme(),
      toolbox: toolboxJSON(),
      grid: { spacing: 22, length: 3, colour: '#2a2a55', snap: false },
      trashcan: true,
      zoom: { controls: true, wheel: true, startScale: 0.85 },
      move: { scrollbars: true, drag: true, wheel: false },
    });

    // load saved program or the mission starter
    const key = state.designKey();
    const mission = missionById(state.missionId);
    const savedProgram = state.programs[key];
    const starter = mission?.starterProgram ?? STARTER_PROGRAM;
    const toLoad = (savedProgram && Object.keys(savedProgram as object).length) ? savedProgram : starter;
    if (toLoad) {
      try { Blockly.serialization.workspaces.load(toLoad as never, this.ws); } catch { /* corrupt */ }
    }

    if (state.errorBlockId) {
      const b = this.ws.getBlockById(state.errorBlockId);
      b?.setWarningText(t('warn.empty_input'));
    }

    this.ws.addChangeListener(() => this.onWorkspaceChange());

    this.buildRightPanel();

    // ---- bottom bar ----
    const bar = this.add.graphics();
    bar.fillStyle(0x1d1d3a, 0.96).fillRect(0, height - BAR_H, width, BAR_H);
    bar.lineStyle(2, 0x1d1b2e).lineBetween(0, height - BAR_H, width, height - BAR_H);
    makeButton(this, 150, height - 32, t('code.back'), { w: 260, h: 46, variant: 'purple', onClick: () => this.leave('builder') });
    makeButton(this, width - 160, height - 32, t('code.run'), {
      w: 240, h: 48, fontSize: 22, variant: 'yellow', onClick: () => this.tryRun(),
    });
    this.errMsg = this.add.text(300, height - 32, '', { ...TXT.warn, fontSize: '14px' }).setOrigin(0, 0.5);

    this.inGameMenu = new InGameMenu(this, {
      onOpen: () => {
        Blockly.hideChaff();
        if (this.blocklyDiv) this.blocklyDiv.style.visibility = 'hidden';
      },
      onClose: () => {
        if (this.blocklyDiv) this.blocklyDiv.style.visibility = 'visible';
      },
      onHub: () => this.leave('hub'),
      onQuit: () => this.leave('menu'),
    });

    this.onWorkspaceChange();
  }

  /** Size the Blockly host div in page pixels so it exactly covers the left
   *  column of the fitted canvas and never overhangs the right panel. */
  private layoutBlocklyDiv(): void {
    const div = this.blocklyDiv;
    if (!div) return;
    const bounds = this.scale.canvasBounds;
    const sx = bounds.width / this.scale.width;
    const sy = bounds.height / this.scale.height;
    div.style.left = `${Math.round(bounds.x)}px`;
    div.style.top = `${Math.round(bounds.y)}px`;
    div.style.width = `${Math.floor(this.scale.width * BLOCKLY_SPLIT * sx)}px`;
    div.style.height = `${Math.floor((this.scale.height - BAR_H) * sy)}px`;
    if (this.ws) Blockly.svgResize(this.ws);
  }

  private buildRightPanel(): void {
    this.rightPanel?.destroy();
    const { width, height } = this.scale;
    const mission = missionById(state.missionId);
    const left = Math.floor(width * BLOCKLY_SPLIT) + 10;
    const pw = width - left - 10;
    const c = this.add.container(left, 12);
    this.rightPanel = c;

    const ph = height - BAR_H - 24;
    c.add(makePanel(this, 0, 0, pw, ph, 0.94));
    c.add(this.add.text(pw / 2, 14, t('code.goal'), TXT.h2).setOrigin(0.5, 0));

    const brief = mission ? t(mission.briefKey) : t('mission.sandbox.brief');
    const briefText = this.add.text(pw / 2, 50, brief, {
      ...TXT.body, fontSize: '15px', wordWrap: { width: pw - 36 }, align: 'center',
    }).setOrigin(0.5, 0);
    c.add(briefText);

    // rocket summary
    const stats = computeStats(state.design.parts);
    let sy = 52 + briefText.height + 24;
    if (hasV2(this, UI_V2_ART.iconRocket)) {
      c.add(this.add.image(pw / 2 - 64, sy + 14, V2, UI_V2_ART.iconRocket).setDisplaySize(20, 24));
    }
    c.add(this.add.text(pw / 2, sy, t('code.rocket'), TXT.h2).setOrigin(0.5, 0));
    sy += 34;
    const rows: [string, string][] = [
      [t('stats.mass'), `${Math.round(stats.mass)} kg`],
      [t('stats.dv'), `${Math.round(stats.dvTotal)} m/s`],
      [t('stats.twr'), stats.twr.toFixed(2)],
    ];
    for (const [k, v] of rows) {
      c.add(this.add.text(18, sy, k, TXT.small).setOrigin(0, 0.5));
      c.add(this.add.text(pw - 18, sy, v, { ...TXT.body, fontSize: '15px' }).setOrigin(1, 0.5));
      sy += 26;
    }

    // mission hint
    const hintKeys = mission?.hintKeys ?? [];
    if (hintKeys.length) {
      sy += 10;
      const hint = this.add.text(18, sy, `💡 ${t(hintKeys[0])}`, {
        ...TXT.small, fontSize: '13px', color: '#ffe8a3', wordWrap: { width: pw - 36 },
      }).setOrigin(0, 0);
      c.add(hint);
    }

    // The pointing astronaut is the panel's guide: it faces right, so it sits
    // on the left edge pointing into the sheet instead of off the panel.
    if (hasV2(this, 'astro_point')) {
      const f = this.textures.getFrame(V2, 'astro_point');
      if (f) {
        const mascotH = 78;
        c.add(this.add.image(46, ph - 16, V2, 'astro_point')
          .setOrigin(0.5, 1)
          .setDisplaySize(Math.round(mascotH * (f.width / f.height)), mascotH));
      }
    }

    // block counter sits in the panel; the Run action lives in the bottom bar
    this.blockCountText = this.add.text(pw / 2, ph - 34, t('code.blocks', { n: state.blockCount }), {
      ...TXT.small, fontSize: '13px', color: '#cfd2ff',
    }).setOrigin(0.5, 0);
    c.add(this.blockCountText);
  }

  private onWorkspaceChange(): void {
    if (!this.ws) return;
    const json = Blockly.serialization.workspaces.save(this.ws);
    const res = compileBlocklyJSON(json);
    state.blockCount = res.blockCount;
    state.errorBlockId = res.errors[0] ?? null;
    this.errMsg?.setText(res.errors.length ? t('code.error') : '');
    this.blockCountText?.setText(t('code.blocks', { n: res.blockCount }));
  }

  private tryRun(): void {
    if (!this.ws) return;
    const json = Blockly.serialization.workspaces.save(this.ws);
    const res = compileBlocklyJSON(json);
    if (res.errors.length) {
      state.errorBlockId = res.errors[0];
      const b = this.ws.getBlockById(res.errors[0]);
      b?.setWarningText(t('warn.empty_input'));
      this.errMsg?.setText(t('code.error'));
      return;
    }
    this.leave('flight');
  }

  private leave(scene: string): void {
    if (this.ws) {
      const json = Blockly.serialization.workspaces.save(this.ws);
      state.program = json;
      state.programs[state.designKey()] = json;
      saveGame();
    }
    this.disposeBlockly();
    this.scene.start(scene);
  }

  private disposeBlockly(): void {
    const ws = this.ws;
    this.ws = undefined;
    if (ws) {
      // a second dispose (scene restart, HMR) would throw from deep inside
      // Blockly's renderer — and a half-dead workspace keeps a RAF alive
      try { ws.dispose(); } catch { /* already disposed */ }
    }
    const div = this.blocklyDiv;
    if (div) {
      div.style.display = 'none';
      div.style.visibility = 'visible';
      div.textContent = '';
    }
  }

}

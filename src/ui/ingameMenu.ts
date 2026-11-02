import Phaser from 'phaser';
import { state } from '../core/state';
import { saveGame } from '../core/save';
import { t } from '../core/i18n';
import { MISSIONS } from '../data/missions';
import { InGameMenuController } from '../core/ingameMenuState';
import { makeButton, makePanel, ensureMusic, TXT, type ButtonVariant, type LabelButton } from './widgets';
import { V2, UI_V2_ART, hasV2 } from './theme';

export interface InGameMenuExtraAction {
  labelKey: string;
  variant?: ButtonVariant;
  onClick: () => void;
}

export interface InGameMenuOpts {
  /** Called when the player selects Quit to return to the main menu. */
  onQuit: () => void;
  /** Optional action to return to the Hub base from Builder/Code/Flight/Explore. */
  onHub?: () => void;
  /** Optional extra scene-specific button (e.g. Edit Code in FlightScene). */
  extraAction?: InGameMenuExtraAction;
  /** True when the scene plays music at ducked volume (FlightScene). */
  musicDucked?: boolean;
  /** Optional check before Esc opens the menu (e.g. close Hub mission board first). */
  onEscapeBeforeOpen?: () => boolean;
  /** Optional callback fired when the in-game menu opens. */
  onOpen?: () => void;
  /** Optional callback fired when the in-game menu closes and gameplay resumes. */
  onClose?: () => void;
}

/**
 * Modal in-game pause/options menu shared across all playable scenes.
 *
 * Pressing Esc once opens this menu (pausing gameplay without resetting);
 * pressing Esc a second time (or clicking Resume) closes it and continues
 * where the player left off; clicking Quit returns to the main menu.
 */
export class InGameMenu {
  private readonly controller: InGameMenuController;
  private backdrop?: Phaser.GameObjects.Rectangle;
  private container?: Phaser.GameObjects.Container;
  private buttons: LabelButton[] = [];
  private readonly onEscKey: () => void;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: InGameMenuOpts,
  ) {
    this.controller = new InGameMenuController({
      onEscapeBeforeOpen: opts.onEscapeBeforeOpen,
      onOpen: () => {
        this.buildModal();
        opts.onOpen?.();
      },
      onClose: () => {
        this.destroyModal();
        opts.onClose?.();
      },
      onQuit: () => {
        this.destroyModal();
        opts.onQuit();
      },
    });

    this.onEscKey = () => {
      this.controller.pressEscape();
    };
    scene.input.keyboard?.on('keydown-ESC', this.onEscKey);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  get isOpen(): boolean {
    return this.controller.isOpen;
  }

  open(): void {
    this.controller.open();
  }

  close(): void {
    this.controller.close();
  }

  toggle(): void {
    this.controller.toggle();
  }

  quit(): void {
    this.controller.quit();
  }

  private buildModal(): void {
    this.destroyModal();
    const { width, height } = this.scene.scale;
    const hasHudCam = this.scene.cameras.cameras.length > 1;
    const ignoreOnMain = (go?: Phaser.GameObjects.GameObject) => {
      if (hasHudCam && go) this.scene.cameras.main.ignore(go);
    };

    // Full-screen interactive dim layer swallows clicks so world stations/parts
    // underneath cannot be triggered while the in-game menu is open.
    const dim = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x08081a, 0.72)
      .setScrollFactor(0)
      .setDepth(200)
      .setInteractive();
    ignoreOnMain(dim);
    this.backdrop = dim;

    interface RowSpec {
      label: () => string;
      variant: ButtonVariant;
      onClick: (btn: LabelButton) => void;
    }

    const rows: RowSpec[] = [
      {
        label: () => t('ingame.resume'),
        variant: 'yellow',
        onClick: () => this.close(),
      },
    ];

    if (this.opts.extraAction) {
      const extra = this.opts.extraAction;
      rows.push({
        label: () => t(extra.labelKey),
        variant: extra.variant ?? 'blue',
        onClick: () => {
          this.destroyModal();
          extra.onClick();
        },
      });
    }

    if (this.opts.onHub) {
      const goHub = this.opts.onHub;
      rows.push({
        label: () => t('ingame.hub'),
        variant: 'blue',
        onClick: () => {
          this.destroyModal();
          goHub();
        },
      });
    }

    rows.push({
      label: () => (state.music ? t('menu.music') : t('menu.music_off')),
      variant: 'purple',
      onClick: (btn) => {
        state.music = !state.music;
        saveGame();
        ensureMusic(this.scene, state.music, !!this.opts.musicDucked);
        btn.setLabel?.(state.music ? t('menu.music') : t('menu.music_off'));
      },
    });

    rows.push({
      label: () => t('ingame.quit'),
      variant: 'red',
      onClick: () => this.quit(),
    });

    const panelW = 540;
    const panelH = 220 + rows.length * 64;
    const c = this.scene.add.container(width / 2, height / 2)
      .setScrollFactor(0)
      .setDepth(201);
    ignoreOnMain(c);
    this.container = c;

    c.add(makePanel(this.scene, -panelW / 2, -panelH / 2, panelW, panelH, 0.98));

    const titleY = -panelH / 2 + 70;
    const titleText = this.scene.add.text(0, titleY, t('ingame.title'), {
      ...TXT.title,
      fontSize: '30px',
      stroke: '#1d1b2e',
      strokeThickness: 6,
    }).setOrigin(0.5);
    c.add(titleText);

    if (hasV2(this.scene, UI_V2_ART.iconGear)) {
      const gear = this.scene.add.image(-titleText.width / 2 - 24, titleY, V2, UI_V2_ART.iconGear)
        .setDisplaySize(28, 28);
      c.add(gear);
    }

    const missionLabel = state.missionId && MISSIONS[state.missionId]
      ? t(MISSIONS[state.missionId].titleKey)
      : t('menu.sandbox');
    c.add(this.scene.add.text(0, titleY + 32, missionLabel, {
      ...TXT.body,
      fontSize: '16px',
      color: '#ffd23f',
      fontStyle: 'bold',
    }).setOrigin(0.5));

    rows.forEach((row, i) => {
      const yOffset = -panelH / 2 + 148 + i * 64;
      const btn = makeButton(this.scene, width / 2, height / 2 + yOffset, row.label(), {
        w: 380,
        h: 52,
        fontSize: 19,
        variant: row.variant,
        onClick: () => row.onClick(btn),
      });
      btn.setScrollFactor(0).setDepth(202);
      btn.hitZone?.setScrollFactor(0).setDepth(202);
      ignoreOnMain(btn);
      ignoreOnMain(btn.hitZone);
      this.buttons.push(btn);
    });

    c.add(this.scene.add.text(0, panelH / 2 - 62, t('ingame.esc_hint'), {
      ...TXT.small,
      fontSize: '13px',
      color: '#cfd2ff',
    }).setOrigin(0.5));
  }

  private destroyModal(): void {
    this.backdrop?.destroy();
    this.backdrop = undefined;
    this.container?.destroy();
    this.container = undefined;
    for (const b of this.buttons) b.destroy();
    this.buttons = [];
  }

  destroy(): void {
    this.scene.input.keyboard?.off('keydown-ESC', this.onEscKey);
    this.destroyModal();
  }
}

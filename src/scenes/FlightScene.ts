import Phaser from 'phaser';
import { state } from '../core/state';
import { t, fmtDist, fmtSpeed, fmtTime } from '../core/i18n';
import { EARTH, MOON } from '../data/bodies';
import { partDef } from '../data/parts';
import { missionById } from '../data/missions';
import { FlightSim, defaultControl, DT, type RocketControl, type SimEvent, type Telemetry } from '../physics/sim';
import { computeStats, splitStages } from '../physics/rocket';
import { assemblyFromDesign, flatten } from '../data/assembly';
import { makeButton, makeIconButton, makePanel, ensureMusic, TXT, type LabelButton } from '../ui/widgets';
import { InGameMenu } from '../ui/ingameMenu';
import { isTouchMode, onInputModeChange } from '../core/device';
import {
  UI, V2, FLAME_ART, FX_ART, UI_V2_ART, BG, BASE_ART, hasFrame, hasV2, makeSpeechBubble, bellWidth,
} from '../ui/theme';
import { fitInto, isOverhaul, nativeRatio } from '../ui/overhaul';
import { buildRocketArt, type RocketArt } from '../ui/rocketArt';
import {
  ensureGlowTexture, ensureSkyTexture, paintSky, skyColors, smoothstep, GLOW_KEY, SKY_KEY,
} from '../ui/flightFx';

const M2PX_MAX = 0.0016;   // px per metre in space
/** Backdrop layers are drawn a little larger than the screen, so a camera
 *  shake never shows their edges. */
const BG_OVERSCAN = 1.08;
const ZOOM_FLOOR = 0.02;   // the rocket never shrinks past this

const TILT_RATE = (45 * Math.PI) / 180;   // how fast the pilot swings the target, rad/s
const TILT_MAX = (100 * Math.PI) / 180;   // past horizontal is a crash, not a manoeuvre
const THROTTLE_RATE = 0.7;                // throttle travel per second while held
const SPACE_ALT = 70000;

/** Altitude band the cloud deck occupies, m. */
const CLOUD_MIN = 1200;
const CLOUD_MAX = 12000;
const CLOUD_COUNT = 14;

/** One engine's plume: where its bell opens, which stage it fires in. */
interface EngineFx {
  uid: number;
  stage: number;
  /** nozzle mouth, rocket-container space */
  x: number;
  y: number;
  w: number;
  /** width of the nozzle mouth the plume leaves from */
  mouth: number;
  /** relative plume size: a Bull roars bigger than a Spark */
  power: number;
  flame?: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;
}

/** A spent stage tumbling away after separation. Purely visual. */
interface Debris {
  c: Phaser.GameObjects.Container;
  vx: number;
  vy: number;
  spin: number;
  age: number;
}

interface Cloud {
  c: Phaser.GameObjects.Container;
}

interface Star { x: number; y: number; r: number; phase: number; rate: number }

export class FlightScene extends Phaser.Scene {
  private sim!: FlightSim;
  private control!: RocketControl;
  /** Pad buttons held right now: -1, 0 or +1 for tilt and throttle. */
  private touchTilt = 0;
  private touchThrottle = 0;
  private hasControl = true;
  private engineBtn?: LabelButton;
  private keys?: Record<string, Phaser.Input.Keyboard.Key>;
  /** One-shot pilot tips already shown on this flight. */
  private tipsShown = new Set<string>();
  private mission = null as ReturnType<typeof missionById>;

  private rocket!: Phaser.GameObjects.Container;
  private art!: RocketArt;
  private rocketH = 0;
  private engines: EngineFx[] = [];
  /** Part uid → the stage (0 = fires first) it belongs to. */
  private partStage = new Map<number, number>();
  /** Uids already dropped with a spent stage. */
  private detached = new Set<number>();
  private debris: Debris[] = [];
  /** How the plume art is drawn: today's black-background frames additively,
   *  the overhaul's painted (transparent) flames normally, or the ui_v1 stub. */
  private flameMode: 'additive' | 'painted' | 'stub' = 'stub';
  private chute?: Phaser.GameObjects.Image;
  private smoke?: Phaser.GameObjects.Particles.ParticleEmitter;
  private padSmoke?: Phaser.GameObjects.Particles.ParticleEmitter;
  private skyGfx!: Phaser.GameObjects.Graphics;
  private starGfx!: Phaser.GameObjects.Graphics;
  private stars: Star[] = [];
  private skyImg?: Phaser.GameObjects.Image;
  private skyTex: Phaser.Textures.CanvasTexture | null = null;
  /** Altitude the sky gradient was last painted for, m. */
  private skyAlt = -1;
  private earthGfx!: Phaser.GameObjects.Graphics;
  private trajGfx!: Phaser.GameObjects.Graphics;
  private backdrop?: Phaser.GameObjects.Image;
  private bgRoot!: Phaser.GameObjects.Container;
  /** World y of the ground line: the bottom of the stack standing on the pad. */
  private groundY = 0;
  /** Camera zoom on the pad: below 1 for a rocket taller than the screen. */
  private groundZoom = 1;
  private site?: Phaser.GameObjects.Container;
  private siteFront?: Phaser.GameObjects.Container;
  private clamps: Phaser.GameObjects.Image[] = [];
  private clouds: Cloud[] = [];
  private lastCamY = 0;

  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private worldObjects: Phaser.GameObjects.GameObject[] = [];
  private uiObjects: Phaser.GameObjects.GameObject[] = [];

  private hudText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private fuelBar!: Phaser.GameObjects.Graphics;
  private pauseIcon!: Phaser.GameObjects.Image | Phaser.GameObjects.Container;
  private hintText?: Phaser.GameObjects.Text;

  private warp = 1;
  private paused = false;
  private wasPausedBeforeMenu = false;
  private inGameMenu!: InGameMenu;
  private simAcc = 0;
  private logLines: string[] = [];
  private ended = false;
  private sayQueue: { text: string; until: number }[] = [];
  private sayBubble?: Phaser.GameObjects.Container;
  private saySetter?: (s: string) => void;
  private previewPts: { x: number; y: number }[] = [];
  private previewTimer = 0;
  private chuteOpen = false;

  constructor() { super('flight'); }

  create(): void {
    this.resetState();
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(0x05050f);
    this.mission = missionById(state.missionId);
    ensureMusic(this, state.music, true);   // ducked under flight

    this.sim = new FlightSim(state.design.parts);
    const stats = computeStats(state.design.parts);
    this.control = defaultControl();
    // steering needs a flight computer or a crew pod; without one the rocket
    // still flies, straight up
    this.hasControl = stats.hasControl;

    // ---- HUD camera: fixed, never zooms, transparent so the world shows ----
    this.uiCam = this.cameras.add(0, 0, width, height);
    this.uiCam.setName('ui');
    this.uiCam.transparent = true;

    // ---- sky: a gradient for the daylight climb, the painted backdrops
    //      fading in as the air thins. All on the MAIN camera, in a container
    //      counter-scaled every frame so the zoom never touches it. A separate
    //      camera would draw the backdrop over the world.
    this.bgRoot = this.add.container(0, 0).setDepth(-100);
    this.skyTex = ensureSkyTexture(this);
    if (this.skyTex) {
      this.skyImg = this.add.image(0, 0, SKY_KEY).setDisplaySize(width * BG_OVERSCAN, height * BG_OVERSCAN);
      this.bgRoot.add(this.skyImg);
    }
    if (this.textures.exists(BG.flightEarth)) {
      this.backdrop = this.add.image(0, 0, BG.flightEarth).setDisplaySize(width * BG_OVERSCAN, height * BG_OVERSCAN).setAlpha(0);
      this.bgRoot.add(this.backdrop);
    }
    this.skyGfx = this.add.graphics();
    this.bgRoot.add(this.skyGfx);   // added after the backdrop → draws on top
    this.starGfx = this.add.graphics();
    this.bgRoot.add(this.starGfx);
    this.buildStars();

    // ---- world layers (zoomed by the main camera) ----
    this.trajGfx = this.add.graphics().setDepth(-8);
    this.earthGfx = this.add.graphics().setDepth(-9);
    this.buildRocketArt();
    this.worldObjects.push(this.trajGfx, this.earthGfx, this.rocket);
    this.buildLaunchSite();
    this.buildClouds();

    // Exhaust smoke: the v2 cloud art when it is there, the ui_v1 puff otherwise.
    // The v2 puffs are cut small (90 px), so they need a bigger scale ramp than
    // the old atlas frame to cover the same ground.
    const useV2Smoke = hasV2(this, FX_ART.cloudM);
    const smokeKey = useV2Smoke ? V2 : UI;
    const smokeFrame = useV2Smoke ? FX_ART.cloudM : 'fx_smoke';
    // the scale ramps were tuned on today's frames; overhaul clouds are drawn
    // at 2x, so their ramps shrink by the same factor
    const kM = nativeRatio(this, smokeKey, smokeFrame);
    const padFrame = useV2Smoke ? FX_ART.cloudL : smokeFrame;
    const kL = nativeRatio(this, smokeKey, padFrame);
    // the overhaul puffs are outlined with a flat, shaded underside: spun at
    // random they pile into a tangle of tilted outlines, so they stay upright
    const spin = isOverhaul(this, smokeKey, smokeFrame) ? { min: -12, max: 12 } : { min: 0, max: 360 };
    if (useV2Smoke || hasFrame(this, 'fx_smoke')) {
      this.smoke = this.add.particles(0, 0, smokeKey, {
        frame: smokeFrame,
        lifespan: 900,
        speed: { min: 8, max: 32 },
        // kept light: the additive plume is the bright element, and a dense
        // white puff in front of it swallowed the flame entirely
        scale: useV2Smoke ? { start: 0.5 * kM, end: 1.2 * kM } : { start: 0.16 * kM, end: 0.42 * kM },
        alpha: { start: useV2Smoke ? 0.42 : 0.34, end: 0 },
        rotate: spin,
        quantity: 1,
        emitting: false,
      }).setDepth(4);
      this.worldObjects.push(this.smoke);
      // the ground cloud a launch kicks up: wide, slow, rolling out along the pad
      this.padSmoke = this.add.particles(0, 0, smokeKey, {
        frame: padFrame,
        lifespan: { min: 1800, max: 3000 },
        speedX: { min: -280, max: 280 },
        speedY: { min: -46, max: -6 },
        scale: useV2Smoke ? { start: 0.7 * kL, end: 2.4 * kL } : { start: 0.3 * kL, end: 0.9 * kL },
        alpha: { start: 0.62, end: 0 },
        rotate: spin,
        tint: 0xf3f1ee,
        quantity: 1,
        emitting: false,
      }).setDepth(6);
      this.worldObjects.push(this.padSmoke);
    }

    this.buildHUD(width, height);

    // the keyboard hint is dead weight on a phone, where the same actions are
    // four on-screen buttons
    const offInputMode = onInputModeChange(() => this.refreshHintText());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offInputMode);

    // the main camera renders the world + backdrop; the HUD camera only the HUD
    this.uiCam.ignore(this.worldObjects);
    this.uiCam.ignore(this.bgRoot);
    this.cameras.main.ignore(this.uiObjects);

    // ---- controls ----
    // Space lights or cuts the engine, Q drops a stage, C pops the chute; the
    // held keys (W/S throttle, A/D tilt) are read every sim step.
    this.keys = this.input.keyboard?.addKeys('W,S,A,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key> | undefined;
    this.input.keyboard?.on('keydown-SPACE', () => { if (!this.inGameMenu?.isOpen) this.toggleEngine(); });
    this.input.keyboard?.on('keydown-Q', () => { if (!this.inGameMenu?.isOpen) this.requestStage(); });
    this.input.keyboard?.on('keydown-C', () => { if (!this.inGameMenu?.isOpen) this.requestChute(); });
    this.input.keyboard?.on('keydown-P', () => { if (!this.inGameMenu?.isOpen) this.togglePause(); });
    this.input.keyboard?.on('keydown-OPEN_BRACKET', () => { if (!this.inGameMenu?.isOpen) this.setWarp(-1); });
    this.input.keyboard?.on('keydown-CLOSE_BRACKET', () => { if (!this.inGameMenu?.isOpen) this.setWarp(1); });
    this.input.keyboard?.on('keydown-R', () => { if (!this.inGameMenu?.isOpen) this.restart(); });
    this.inGameMenu = new InGameMenu(this, {
      musicDucked: true,
      extraAction: { labelKey: 'result.rebuild', variant: 'blue', onClick: () => this.leave('builder') },
      onHub: () => this.leave('hub'),
      onQuit: () => this.leave('menu'),
      onOpen: () => {
        this.wasPausedBeforeMenu = this.paused;
        this.paused = true;
      },
      onClose: () => {
        this.paused = this.wasPausedBeforeMenu;
      },
    });

    this.cameras.main.startFollow(this.rocket, true, 0.12, 0.12);
    this.cameras.main.setZoom(this.groundZoom);
    // The follow moves the camera during render, after update() has run, so a
    // backdrop placed in update() trails a frame behind and a fast climb
    // opened a black strip along the top edge. Re-centre it once the camera
    // has actually moved.
    this.cameras.main.on(Phaser.Cameras.Scene2D.Events.FOLLOW_UPDATE, (cam: Phaser.Cameras.Scene2D.Camera) => {
      this.bgRoot.setPosition(cam.midPoint.x, cam.midPoint.y);
    });
    this.lastCamY = this.cameras.main.midPoint.y;

    this.tip('flight.tip_start');
  }

  private resetState(): void {
    this.ended = false;
    this.warp = 1;
    this.paused = false;
    this.simAcc = 0;
    this.logLines = [];
    this.sayQueue = [];
    this.sayBubble = undefined;
    this.saySetter = undefined;
    this.touchTilt = 0;
    this.touchThrottle = 0;
    this.engineBtn = undefined;
    this.tipsShown = new Set();
    this.previewTimer = 0;
    this.previewPts = [];
    this.worldObjects = [];
    this.uiObjects = [];
    this.chuteOpen = false;
    this.engines = [];
    this.partStage = new Map();
    this.detached = new Set();
    this.debris = [];
    this.clamps = [];
    this.clouds = [];
    this.stars = [];
    this.skyAlt = -1;
    this.site = undefined;
    this.siteFront = undefined;
    this.chute = undefined;
    this.backdrop = undefined;
    this.skyImg = undefined;
    this.smoke = undefined;
    this.padSmoke = undefined;
    this.fading = false;
  }

  // ---------------- HUD ----------------

  private buildHUD(width: number, height: number): void {
    const panel = makePanel(this, 8, 8, 300, 236, 0.82);
    this.uiObjects.push(panel);

    this.hudText = this.add.text(20, 18, '', { ...TXT.small, fontSize: '14px', lineSpacing: 2 })
      .setDepth(50);
    this.logText = this.add.text(12, height - 150, '', {
      ...TXT.small, fontSize: '14px', lineSpacing: 4,
      backgroundColor: '#0b0b2acc', padding: { x: 8, y: 6 },
    }).setDepth(50);
    this.statusText = this.add.text(width / 2, 54, '', {
      ...TXT.h2, color: '#ffd23f', stroke: '#1d1b2e', strokeThickness: 6,
    }).setOrigin(0.5, 0).setDepth(50);
    this.fuelBar = this.add.graphics().setDepth(50);
    this.uiObjects.push(this.hudText, this.logText, this.statusText, this.fuelBar);
    if (hasV2(this, UI_V2_ART.iconFuel)) {
      const fuelIcon = fitInto(this.add.image(28, 204, V2, UI_V2_ART.iconFuel), 22, 26).setDepth(51);
      this.uiObjects.push(fuelIcon);
    }

    // icon controls, bottom-right
    this.pauseIcon = makeIconButton(this, width - 250, height - 40, 'ico_pause', () => this.togglePause(), 46);
    const warpIcon = makeIconButton(this, width - 190, height - 40, 'ico_x2', () => this.setWarp(1), 46);
    const restartIcon = makeIconButton(this, width - 130, height - 40, 'ico_reset', () => this.restart(), 46);
    const backIcon = makeIconButton(this, width - 70, height - 40, 'ico_back', () => this.leave('builder'), 46);
    this.uiObjects.push(this.pauseIcon, warpIcon, restartIcon, backIcon);

    const giveUp = makeButton(this, width - 90, 34, t('flight.give_up'), {
      w: 150, h: 44, variant: 'red', onClick: () => this.finish('fail.give_up'),
    });
    this.uiObjects.push(giveUp);
    if (giveUp.hitZone) this.uiObjects.push(giveUp.hitZone);

    this.buildPilotPad(height - 44);

    this.hintText = this.add.text(14, 256, '', {
      ...TXT.small, fontSize: '12px', color: '#b9bde0', lineSpacing: 2,
      backgroundColor: '#0b0b2acc', padding: { x: 8, y: 4 },
      wordWrap: { width: 290 },
    }).setOrigin(0, 0).setDepth(50);
    this.uiObjects.push(this.hintText);
    this.refreshHintText();
  }

  /**
   * The pilot's buttons along the bottom edge. They work with a mouse as well
   * as a finger, so they stay up on every device; the keyboard does the same
   * things. Tilt and throttle act while held, the rest on a tap.
   */
  private buildPilotPad(y: number): void {
    const hold = (b: LabelButton, set: (v: number) => void, v: number) => {
      const z = b.hitZone;
      if (!z) return;
      z.on('pointerdown', () => set(v));
      z.on('pointerup', () => set(0));
      z.on('pointerout', () => set(0));
    };
    const add = (b: LabelButton) => {
      this.uiObjects.push(b);
      if (b.hitZone) this.uiObjects.push(b.hitZone);
      return b;
    };
    const noop = () => undefined;
    const small = { w: 58, h: 50, fontSize: 22, onClick: noop };

    const tiltL = add(makeButton(this, 400, y, '⟲', { ...small, variant: 'purple' }));
    const tiltR = add(makeButton(this, 462, y, '⟳', { ...small, variant: 'purple' }));
    hold(tiltL, (v) => { this.touchTilt = v; }, -1);
    hold(tiltR, (v) => { this.touchTilt = v; }, 1);

    const thrDown = add(makeButton(this, 540, y, '−', { ...small, variant: 'blue' }));
    const thrUp = add(makeButton(this, 602, y, '+', { ...small, variant: 'blue' }));
    hold(thrDown, (v) => { this.touchThrottle = v; }, -1);
    hold(thrUp, (v) => { this.touchThrottle = v; }, 1);

    this.engineBtn = add(makeButton(this, 704, y, t('flight.btn.engine_on'), {
      w: 130, h: 50, fontSize: 16, variant: 'orange', onClick: () => this.toggleEngine(),
    }));
    add(makeButton(this, 832, y, t('flight.btn.stage'), {
      w: 110, h: 50, fontSize: 16, variant: 'yellow', onClick: () => this.requestStage(),
    }));
    add(makeButton(this, 950, y, t('flight.btn.chute'), {
      w: 110, h: 50, fontSize: 16, variant: 'green', onClick: () => this.requestChute(),
    }));
  }

  // ---------------- pilot input ----------------

  private toggleEngine(): void {
    if (this.ended || this.sim.phase === 'crashed' || this.sim.phase === 'landed') return;
    this.control.engineOn = !this.control.engineOn;
    // the "light the engine" coaching is done once the player has done it
    if (this.control.engineOn) this.sayQueue = [];
    if (this.control.engineOn && this.control.throttle <= 0) this.control.throttle = 1;
    this.pushLog(t(this.control.engineOn ? 'flight.engine_lit' : 'flight.engine_cut'));
    this.engineBtn?.setLabel?.(t(this.control.engineOn ? 'flight.btn.engine_off' : 'flight.btn.engine_on'));
  }

  private requestStage(): void {
    if (this.ended || !this.sim.launched) return;
    if (this.sim.stageIndex >= this.sim.stages.length - 1) {
      this.pushLog(`⚠ ${t('warn.no_more_stages')}`);
      return;
    }
    this.control.stageRequest = true;
  }

  private requestChute(): void {
    if (this.ended || this.sim.parachuteDeployed) return;
    if (!this.sim.stats.hasParachute) {
      this.pushLog(`⚠ ${t('warn.no_parachute')}`);
      return;
    }
    this.control.parachute = true;
  }

  /** Fold the held keys and pad buttons into the control block, once per sim step. */
  private applyPilot(dt: number): void {
    const k = this.keys;
    const kb = (a?: Phaser.Input.Keyboard.Key, b?: Phaser.Input.Keyboard.Key) => !!(a?.isDown || b?.isDown);
    const menuOpen = !!this.inGameMenu?.isOpen;
    const tilt = menuOpen ? 0
      : (kb(k?.A, k?.LEFT) ? -1 : 0) + (kb(k?.D, k?.RIGHT) ? 1 : 0) || this.touchTilt;
    const thr = menuOpen ? 0
      : (kb(k?.W, k?.UP) ? 1 : 0) + (kb(k?.S, k?.DOWN) ? -1 : 0) || this.touchThrottle;

    if (thr !== 0) {
      this.control.throttle = Phaser.Math.Clamp(this.control.throttle + thr * THROTTLE_RATE * dt, 0, 1);
    }
    if (tilt !== 0) {
      if (!this.hasControl) {
        this.tip('flight.tip_no_control');
        return;
      }
      this.control.targetAngle = Phaser.Math.Clamp(
        this.control.targetAngle + tilt * TILT_RATE * dt, -TILT_MAX, TILT_MAX,
      );
    }
  }

  /** Mid-flight coaching, each line at most once per flight. */
  private updateTips(tel: Telemetry): void {
    if (!this.sim.launched) return;
    const st = this.sim.stage;
    const moreStages = this.sim.stageIndex < this.sim.stages.length - 1;
    if (st && st.fuel <= 0 && moreStages) this.tip('flight.tip_stage');
    if (this.mission?.id === 'm2' && tel.altitude >= SPACE_ALT && this.control.engineOn) this.tip('flight.tip_cutoff');
    if (this.mission?.id === 'm2' && tel.altitude > 15000 && tel.altitude < 25000 && this.hasControl) this.tip('flight.tip_tilt');
    const falling = tel.vspeed < -20 && tel.altitude < 8000;
    if (falling && this.sim.stats.hasParachute && !this.sim.parachuteDeployed) this.tip('flight.tip_chute');
  }

  private tip(key: string): void {
    if (this.tipsShown.has(key)) return;
    this.tipsShown.add(key);
    const text = t(key);
    this.pushLog(`💡 ${text}`);
    this.sayQueue.push({ text, until: this.sim.t + 5 });
  }

  /** Name the controls the player actually has in front of them. */
  private refreshHintText(): void {
    this.hintText?.setText(t(isTouchMode() ? 'flight.hint_keys_touch' : 'flight.hint_keys'));
  }

  private togglePause(): void {
    this.paused = !this.paused;
    const tex = this.paused ? 'ico_play' : 'ico_pause';
    if (this.pauseIcon instanceof Phaser.GameObjects.Image && hasFrame(this, tex)) {
      this.pauseIcon.setTexture(UI, tex);
    }
  }

  private setWarp(dir: 1 | -1): void {
    const steps = [1, 2, 5, 10];
    let i = steps.indexOf(this.warp) + dir;
    if (dir === 1 && i >= steps.length) i = 0; // wrap around on tap so mobile players can return to 1×
    i = Phaser.Math.Clamp(i, 0, steps.length - 1);
    const want = steps[i];
    // warp > 2 is disabled in the atmosphere with the engine burning
    const tel = this.sim.telemetry(this.control);
    const inAtmo = tel.bodyName === 'earth' && tel.altitude < EARTH.atmHeight;
    if (want > 2 && inAtmo && this.control.engineOn && this.sim.stage && this.sim.stage.fuel > 0) {
      this.warp = 1;
      return;
    }
    this.warp = want;
  }

  // ---------------- rocket art ----------------

  private buildRocketArt(): void {
    const { height } = this.scale;
    const asm = assemblyFromDesign(state.design);
    this.art = buildRocketArt(this, asm);
    this.rocket = this.art.container.setDepth(5);
    this.rocketH = this.art.spineH;
    this.groundY = this.art.bottom;
    // a tall stack is framed whole on the pad instead of running off the top
    const tall = this.art.bottom - this.art.top;
    this.groundZoom = Phaser.Math.Clamp((height * 0.6) / Math.max(1, tall), 0.4, 1);

    // Which stage each part flies in, so separation drops the right ones. The
    // physics stages the flat part list; the art is the same list laid out, so
    // the two are tied together by flattening the assembly the same way.
    const flat = flatten(asm);
    const sameDesign = flat.ids.length === state.design.parts.length
      && flat.ids.every((id, i) => id === state.design.parts[i]);
    if (sameDesign) {
      const groups = splitStages(flat.ids);
      let idx = 0;
      groups.forEach((g, gi) => {
        for (let k = 0; k < g.length; k += 1) this.partStage.set(flat.uids[idx++], groups.length - 1 - gi);
      });
    }

    // One plume per engine, at its own bell mouth: strap-on boosters burn too.
    // Today's v2 plumes are painted on black, so they are drawn additively and
    // the black drops out against the sky instead of fringing the sprite. The
    // overhaul plumes have real alpha and an outline: drawn additively they
    // would wash out to white, so they blend normally.
    const v2Flame = hasV2(this, FLAME_ART.large);
    this.flameMode = !v2Flame ? 'stub' : isOverhaul(this, V2, FLAME_ART.large) ? 'painted' : 'additive';
    const additive = this.flameMode === 'additive';
    const glowKey = ensureGlowTexture(this);
    for (const p of this.art.parts) {
      const def = partDef(p.node.id);
      if (def.kind !== 'engine') continue;
      const fx: EngineFx = {
        uid: p.node.uid,
        stage: this.partStage.get(p.node.uid) ?? 0,
        x: p.x,
        y: p.y + p.h / 2 - 2 + p.bell,
        w: p.w,
        mouth: bellWidth(this, p.node.id, p.w),
        power: Math.pow((def.thrustVac ?? 60000) / 60000, 0.3),
      };
      if (additive) {
        fx.flame = this.add.image(fx.x, fx.y, V2, FLAME_ART.large)
          .setOrigin(0.5, 0.04).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      } else if (v2Flame) {
        // the painted plume's top edge is the nozzle
        fx.flame = this.add.image(fx.x, fx.y, V2, FLAME_ART.large).setOrigin(0.5, 0).setVisible(false);
      } else if (hasFrame(this, 'fx_flame_m')) {
        fx.flame = this.add.image(fx.x, fx.y, UI, 'fx_flame_m').setOrigin(0.5, 0).setVisible(false);
      }
      if (this.textures.exists(glowKey)) {
        fx.glow = this.add.image(fx.x, fx.y + 4, GLOW_KEY)
          .setVisible(false).setTint(0xffb347).setBlendMode(Phaser.BlendModes.ADD);
      }
      // behind the bell, so the plume grows out of the nozzle, not over it
      if (fx.flame) this.rocket.addAt(fx.flame, 0);
      if (fx.glow) this.rocket.add(fx.glow);
      this.engines.push(fx);
    }

    if (hasFrame(this, 'fx_chute')) {
      this.chute = this.add.image(0, this.art.top + 4, UI, 'fx_chute')
        .setOrigin(0.5, 1).setVisible(false);
      this.rocket.add(this.chute);
    }
  }

  // ---------------- launch site ----------------

  /**
   * The pad the rocket stands on: grass, distant hills, a concrete slab with
   * hazard stripes, the service tower on the left, hold-down clamps either
   * side and a few tanks and crates for scale. World space, so it falls away
   * as the camera climbs and fades out once the curved Earth takes over.
   */
  private buildLaunchSite(): void {
    const gy = this.groundY;
    const site = this.add.container(0, 0).setDepth(-7);
    this.site = site;
    const rng = new Phaser.Math.RandomDataGenerator(['launch-site']);
    const outline = 0x1d1b2e;

    const hills = this.add.graphics();
    const ridge = (color: number, alpha: number, minH: number, maxH: number, step: number, line: number) => {
      const pts: Phaser.Types.Math.Vector2Like[] = [{ x: -9000, y: gy + 4 }];
      for (let x = -9000; x <= 9000; x += step) {
        pts.push({ x, y: gy - rng.between(minH, maxH) });
      }
      pts.push({ x: 9000, y: gy + 4 });
      hills.fillStyle(color, alpha).fillPoints(pts, true, true);
      if (line > 0) hills.lineStyle(line, outline, 0.55).strokePoints(pts.slice(1, -1), false, false);
    };
    ridge(0xa9d6e8, 1, 160, 420, 520, 0);         // far range, hazy
    ridge(0x86c99a, 1, 70, 210, 340, 3);          // middle hills
    ridge(0x5fb24f, 1, 18, 70, 220, 3);           // near rise
    site.add(hills);

    // The ground in front of the rocket is its own layer above it: a plume
    // that reaches the pad disappears into the trench instead of being drawn
    // over the grass and the dirt below.
    const front = this.add.container(0, 0).setDepth(7);
    this.siteFront = front;
    const ground = this.add.graphics();
    ground.fillStyle(0x4c9a42, 1).fillRect(-60000, gy, 120000, 7000);
    ground.fillStyle(0x6cc257, 1).fillRect(-60000, gy, 120000, 16);
    ground.fillStyle(0x3c7d36, 1).fillRect(-60000, gy + 40, 120000, 8);
    ground.lineStyle(4, outline, 1).lineBetween(-60000, gy, 60000, gy);
    // a few tufts so the grass line is not a ruler edge
    ground.fillStyle(0x7fd463, 1);
    for (let i = 0; i < 90; i++) {
      const x = rng.between(-4200, 4200);
      ground.fillTriangle(x - 6, gy + 1, x + 6, gy + 1, x + rng.between(-3, 3), gy - rng.between(6, 14));
    }
    front.add(ground);

    // concrete pad with a flame trench under the engines: the deck stands
    // behind the rocket, the slab's face and its stripes in front
    const halfW = Math.max(150, (this.art.maxX - this.art.minX) / 2 + 110);
    const deck = this.add.graphics();
    deck.fillStyle(0x9aa0b4, 1).fillRect(-halfW, gy - 16, halfW * 2, 16);
    deck.fillStyle(0xb9bfd1, 1).fillRect(-halfW, gy - 16, halfW * 2, 4);
    const trench = Math.max(46, (this.art.maxX - this.art.minX) * 0.7);
    deck.fillStyle(0x2a2a38, 1).fillRect(-trench / 2, gy - 14, trench, 16);
    deck.lineStyle(3, outline, 1).strokeRect(-halfW, gy - 16, halfW * 2, 16);
    site.add(deck);
    const face = this.add.graphics();
    face.fillStyle(0x6f7486, 1).fillRect(-halfW - 18, gy - 2, halfW * 2 + 36, 32);
    face.fillStyle(0xffd23f, 1).fillRect(-halfW, gy, halfW * 2, 10);
    face.fillStyle(0x1d1b2e, 1);
    for (let x = -halfW; x < halfW; x += 22) {
      face.fillTriangle(x, gy + 10, x + 10, gy, x + 18, gy);
      face.fillTriangle(x, gy + 10, x + 8, gy + 10, x + 18, gy);
    }
    face.lineStyle(3, outline, 1).strokeRect(-halfW - 18, gy - 2, halfW * 2 + 36, 32);
    front.add(face);

    const stackH = this.art.bottom - this.art.top;
    if (hasV2(this, BASE_ART.tower)) {
      // the tower art carries its access arm at about a third of its height,
      // pointing right: standing just left of the rocket it reaches the hull
      const towerH = Phaser.Math.Clamp(stackH * 1.12, 260, 1100);
      const tower = this.add.image(this.art.minX - 6, gy + 6, V2, BASE_ART.tower).setOrigin(1, 1);
      tower.setDisplaySize(towerH * (tower.width / tower.height), towerH);
      site.add(tower);
    } else {
      const tw = 46;
      const g = this.add.graphics();
      const left = this.art.minX - 40 - tw;
      g.fillStyle(0xc4482f, 1).fillRect(left, gy - stackH, tw, stackH);
      g.lineStyle(3, outline, 1).strokeRect(left, gy - stackH, tw, stackH);
      for (let y = gy - stackH; y < gy; y += tw) g.lineBetween(left, y, left + tw, y + tw);
      site.add(g);
    }
    if (hasV2(this, BASE_ART.tanks)) {
      const tanks = this.add.image(this.art.maxX + 170, gy - 8, V2, BASE_ART.tanks).setOrigin(0.5, 1);
      tanks.setDisplaySize(150, 150 * (tanks.height / tanks.width));
      site.add(tanks);
    }
    for (const [frame, dx, h] of [[BASE_ART.crateA, 300, 54], [BASE_ART.crateB, 352, 44], [BASE_ART.crateC, -halfW - 90, 50]] as const) {
      if (!hasV2(this, frame)) continue;
      const x = dx > 0 ? this.art.maxX + dx : dx;
      const crate = this.add.image(x, gy - 2, V2, frame).setOrigin(0.5, 1);
      crate.setDisplaySize(h * (crate.width / crate.height), h);
      site.add(crate);
    }
    this.worldObjects.push(site, front);

    // hold-down clamps hug the base and swing clear at liftoff
    if (hasV2(this, BASE_ART.padClamp)) {
      const h = Phaser.Math.Clamp(stackH * 0.22, 56, 120);
      for (const side of [-1, 1] as const) {
        const edge = side < 0 ? this.art.minX : this.art.maxX;
        const clamp = this.add.image(edge + side * (h * 0.22), gy - 14, V2, BASE_ART.padClamp)
          .setOrigin(0.5, 1).setDepth(6).setFlipX(side > 0);
        clamp.setDisplaySize(h * (clamp.width / clamp.height), h);
        this.clamps.push(clamp);
        this.worldObjects.push(clamp);
      }
    }
  }

  private releaseClamps(): void {
    for (const clamp of this.clamps) {
      const out = clamp.flipX ? 1 : -1;
      this.tweens.add({ targets: clamp, angle: out * 38, duration: 700, ease: 'Back.out' });
    }
  }

  // ---------------- clouds ----------------

  private buildClouds(): void {
    if (!hasV2(this, FX_ART.cloudXl)) return;
    const rng = new Phaser.Math.RandomDataGenerator([`${Date.now() % 7919}`]);
    const frames = [FX_ART.cloudXl, FX_ART.cloudL, FX_ART.cloudM];
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const front = i % 4 === 0;
      const c = this.add.container(0, 0).setDepth(front ? 8 : 2).setAlpha(front ? 0.55 : 0.92);
      // a cloud bank is a few puffs side by side, so it reads as weather and
      // not as one stretched sprite
      const puffs = rng.between(3, 5);
      for (let k = 0; k < puffs; k++) {
        const frame = rng.pick(frames);
        const img = this.add.image(
          (k - (puffs - 1) / 2) * rng.between(70, 110), rng.between(-26, 26),
          V2, frame,
        );
        img.setScale(rng.realInRange(1.2, 2.1) * nativeRatio(this, V2, frame)).setFlipX(rng.frac() < 0.5);
        c.add(img);
      }
      c.setScale(rng.realInRange(0.9, 1.6));
      c.setPosition(rng.between(-2200, 2200), -rng.between(CLOUD_MIN, CLOUD_MAX));
      this.clouds.push({ c });
      this.worldObjects.push(c);
    }
  }

  /** Recycle clouds that fell out of view to just beyond the edge the camera
   *  is heading for, so the deck keeps streaming past for the whole climb. */
  private updateClouds(dt: number, onEarth: boolean): void {
    if (this.clouds.length === 0) return;
    const cam = this.cameras.main;
    const view = cam.worldView;
    const goingUp = cam.midPoint.y <= this.lastCamY;
    this.lastCamY = cam.midPoint.y;
    const fade = onEarth ? Phaser.Math.Clamp((cam.zoom - 0.1) / 0.2, 0, 1) : 0;
    for (const cl of this.clouds) {
      const c = cl.c;
      c.x += 9 * dt;   // a light breeze
      const far = c.y > view.bottom + view.height * 0.9 || c.y < view.top - view.height * 3.2
        || c.x < view.left - view.width * 1.2 || c.x > view.right + view.width * 1.2;
      if (far) {
        const y = goingUp
          ? view.top - Phaser.Math.FloatBetween(0.15, 3) * view.height
          : view.bottom + Phaser.Math.FloatBetween(0.15, 0.8) * view.height;
        c.setPosition(Phaser.Math.FloatBetween(view.left - view.width * 0.4, view.right + view.width * 0.4), y);
      }
      const alt = -c.y;
      c.setVisible(fade > 0 && alt >= CLOUD_MIN && alt <= CLOUD_MAX);
      if (c.visible) c.setAlpha((c.depth > 5 ? 0.55 : 0.92) * fade);
    }
  }

  // ---------------- frame ----------------

  override update(_time: number, delta: number): void {
    if (this.ended) return;
    const frameSec = Math.min(delta / 1000, 0.1);
    const running = !this.paused && this.sim.phase !== 'crashed' && this.sim.phase !== 'landed';

    if (running) {
      this.simAcc += frameSec * this.warp;
      let steps = 0;
      while (this.simAcc >= DT && steps < 10 * this.warp) {
        this.simAcc -= DT;
        steps++;
        const events: SimEvent[] = [];
        this.applyPilot(DT);
        this.sim.step(this.control, events);
        for (const e of events) this.onSimEvent(e);
      }
    }

    const tel = this.sim.telemetry(this.control);
    const zoom = this.zoomFor(tel.altitude);
    this.cameras.main.setZoom(zoom);

    // the backdrop rides the camera centre at 1/zoom so it always fills the
    // frame exactly once, no matter how far the camera pulls out
    const camMid = this.cameras.main.midPoint;
    this.bgRoot.setPosition(camMid.x, camMid.y).setScale(1 / zoom);

    // ---- rocket transform ----
    const px = this.sim.x;
    const py = -(this.sim.y - EARTH.R);
    this.rocket.setPosition(px, py);
    const localUp = Math.atan2(this.sim.y, this.sim.x);
    this.rocket.setRotation(localUp - Math.PI / 2 + this.sim.angle);
    // keep the rocket readable when the camera pulls far out
    const visScale = zoom < 0.15 ? Phaser.Math.Clamp(0.15 / zoom, 1, 24) : 1;
    this.rocket.setScale(visScale);

    this.drawFlames(tel);
    this.drawChute();
    this.emitSmoke(tel);
    this.updateDebris(this.paused ? 0 : frameSec * this.warp);

    const onEarth = tel.bodyName === 'earth';
    const siteAlpha = onEarth ? Phaser.Math.Clamp((zoom - 0.12) / 0.16, 0, 1) : 0;
    this.site?.setAlpha(siteAlpha);
    this.siteFront?.setAlpha(siteAlpha);
    for (const clamp of this.clamps) clamp.setAlpha(siteAlpha);
    this.updateClouds(this.paused ? 0 : frameSec, onEarth);

    this.drawBackdrop(tel);
    this.drawEarth(tel, zoom);
    this.previewTimer += frameSec;
    if (this.previewTimer > 0.5) {
      this.previewTimer = 0;
      this.previewPts = this.sim.launched && tel.altitude > 200 ? this.sim.previewTrajectory(300) : [];
    }
    this.drawTrajectory(zoom);

    this.updateHUD(tel);
    this.updateTips(tel);
    this.updateSay();

    if (this.mission) {
      const res = this.mission.check(this.sim, { engineOn: this.control.engineOn });
      if (res === 'success') this.finish('success');
      else if (res !== 'running') this.finish(res.fail, res.vars);
    } else if (this.sim.phase === 'crashed') {
      this.statusText.setText(t('flight.crashed'));
    }
  }

  private zoomFor(alt: number): number {
    const base = this.groundZoom;
    if (alt < 200) return base;
    const k = Math.min(1, (alt - 200) / 60000);
    return Math.max(ZOOM_FLOOR, Phaser.Math.Linear(base, M2PX_MAX, k));
  }

  // ---------------- effects ----------------

  private engineBurning(tel: Telemetry): boolean {
    const st = this.sim.stage;
    return tel.engineOn && tel.throttle > 0 && !!st && st.fuel > 0
      && this.sim.phase !== 'crashed' && this.sim.phase !== 'landed';
  }

  /** Air pressure fraction at this altitude: 1 on the pad, 0 in space. */
  private airFraction(tel: Telemetry): number {
    if (tel.bodyName !== 'earth' || tel.altitude >= EARTH.atmHeight) return 0;
    return Math.exp(-tel.altitude / EARTH.scaleH);
  }

  private drawFlames(tel: Telemetry): void {
    const on = this.engineBurning(tel);
    const air = this.airFraction(tel);
    for (const fx of this.engines) {
      const active = on && fx.stage === this.sim.stageIndex && !this.detached.has(fx.uid);
      fx.flame?.setVisible(active);
      fx.glow?.setVisible(active);
      if (!active) continue;
      const flicker = 0.86 + Math.random() * 0.28;
      // the plume stays in proportion to its own engine, and in thin air it
      // swells longer and wider, the way a real exhaust balloons in vacuum
      const len = fx.w * (1.9 + 2.9 * tel.throttle) * fx.power * (1 + 0.45 * (1 - air)) * flicker;
      if (fx.flame) {
        if (this.flameMode === 'additive') {
          // additive art keeps its own aspect (219×420) and must not be tinted
          // or dimmed: ADD multiplies by alpha, so any fade kills the bright core
          fx.flame.setDisplaySize(len * (0.5 + 0.32 * (1 - air)), len);
          fx.flame.setAlpha(1);
        } else if (this.flameMode === 'painted') {
          // the painted plume fills its canvas, so it is drawn narrower than
          // the black-background art; never narrower than the nozzle it leaves
          const pw = Math.max(fx.mouth * 1.3, len * 0.3 * (1 + 0.35 * (1 - air)));
          fx.flame.setDisplaySize(pw, len);
          fx.flame.setAlpha(1);
        } else {
          fx.flame.setDisplaySize(fx.w * 0.6 + 14 * tel.throttle, len);
          fx.flame.setAlpha(0.9);
          fx.flame.setTint(this.sim.launched ? 0xffffff : 0xffe9b0);
        }
      }
      if (fx.glow) {
        const g = fx.w * (1.7 + 1.1 * tel.throttle) * fx.power * flicker;
        fx.glow.setDisplaySize(g, g * 0.8).setAlpha(0.55 + 0.3 * tel.throttle);
      }
    }
  }

  private drawChute(): void {
    if (!this.chute) return;
    const open = this.sim.parachuteDeployed;
    this.chute.setVisible(open);
    if (open) {
      const wobble = 1 + Math.sin(this.sim.t * 3) * 0.05;
      const w = Math.max(this.rocketH, 160) * 1.4 * wobble;
      this.chute.setDisplaySize(w, w * 0.7);
    }
  }

  /** A point in rocket-container space, in world coordinates. */
  private rocketToWorld(lx: number, ly: number): { x: number; y: number } {
    const r = this.rocket.rotation;
    const s = this.rocket.scaleX;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    return {
      x: this.rocket.x + (lx * cos - ly * sin) * s,
      y: this.rocket.y + (lx * sin + ly * cos) * s,
    };
  }

  private emitSmoke(tel: Telemetry): void {
    if (!this.smoke || this.paused) return;
    const inAtmo = tel.bodyName === 'earth' && tel.altitude < EARTH.atmHeight * 0.6;
    if (!inAtmo || !this.engineBurning(tel)) return;
    for (const fx of this.engines) {
      if (fx.stage !== this.sim.stageIndex || this.detached.has(fx.uid)) continue;
      const p = this.rocketToWorld(fx.x + Phaser.Math.Between(-6, 6), fx.y + fx.w * 0.9);
      this.smoke.emitParticleAt(p.x + Phaser.Math.Between(-8, 8), p.y + Phaser.Math.Between(0, 14));
    }
    // the exhaust hits the pad and rolls out sideways for the first seconds
    const nearPad = tel.bodyName === 'earth' && tel.altitude < 260;
    if (nearPad && this.padSmoke) {
      const n = tel.altitude < 80 ? 3 : 1;
      for (let i = 0; i < n; i++) {
        this.padSmoke.emitParticleAt(this.rocket.x + Phaser.Math.Between(-40, 40), this.groundY - Phaser.Math.Between(6, 30));
      }
    }
  }

  /** Drop every part of the spent stages: they leave the rocket and tumble
   *  away on their own, with a puff where the separator fired. */
  private separateStage(newIndex: number): void {
    const dropped = this.art.parts.filter((p) => {
      const stage = this.partStage.get(p.node.uid);
      return stage !== undefined && stage < newIndex && !this.detached.has(p.node.uid);
    });
    if (dropped.length === 0) return;

    const c = this.add.container(this.rocket.x, this.rocket.y)
      .setRotation(this.rocket.rotation).setScale(this.rocket.scaleX).setDepth(4);
    this.uiCam.ignore(c);
    let jointY = Infinity;
    for (const p of dropped) {
      this.rocket.remove(p.go);
      c.add(p.go);
      this.detached.add(p.node.uid);
      jointY = Math.min(jointY, p.y - p.h / 2);
    }
    for (const fx of this.engines) {
      if (!this.detached.has(fx.uid)) continue;
      fx.flame?.setVisible(false);
      fx.glow?.setVisible(false);
    }

    // world velocity is the sim's (1 m = 1 px), plus a push along the stack's
    // own "down" scaled to the zoom so the gap opens visibly at any altitude
    const zoom = this.cameras.main.zoom;
    const push = 46 / Math.max(zoom, 0.02);
    const r = this.rocket.rotation;
    this.debris.push({
      c,
      vx: this.sim.vx - Math.sin(r) * push,
      vy: -this.sim.vy + Math.cos(r) * push,
      spin: Phaser.Math.FloatBetween(0.35, 0.8) * (Math.random() < 0.5 ? -1 : 1),
      age: 0,
    });

    const joint = this.rocketToWorld(0, Number.isFinite(jointY) ? jointY : 0);
    const size = Math.max(80, (this.art.maxX - this.art.minX) * 2.4) * this.rocket.scaleX;
    this.fxPop(joint.x, joint.y, FX_ART.cloudL, size, 2.4, 900);
    this.fxPop(joint.x, joint.y, FX_ART.sparkleM, size * 0.5, 1.8, 420);
  }

  private updateDebris(dt: number): void {
    if (this.debris.length === 0) return;
    const zoom = this.cameras.main.zoom;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      // pulled back toward Earth (world Earth centre is (0, R)); thick air
      // brakes it, which is what makes it fall behind the still-burning rocket
      const gx = 0 - d.c.x;
      const gy = EARTH.R - d.c.y;
      const r = Math.hypot(gx, gy) || 1;
      const g = EARTH.GM / (r * r);
      d.vx += (gx / r) * g * dt;
      d.vy += (gy / r) * g * dt;
      const alt = r - EARTH.R;
      const brake = alt < EARTH.atmHeight ? 0.25 * Math.exp(-Math.max(0, alt) / EARTH.scaleH) + 0.04 : 0.02;
      const keep = Math.exp(-brake * dt);
      d.vx *= keep;
      d.vy *= keep;
      d.c.x += d.vx * dt;
      d.c.y += d.vy * dt;
      d.c.rotation += d.spin * dt;
      // never let the spent stage shrink into a dot when the camera pulls out
      d.c.setScale(Math.max(d.c.scaleX, zoom < 0.15 ? Phaser.Math.Clamp(0.15 / zoom, 1, 24) : 1));
      d.c.setAlpha(Phaser.Math.Clamp(1 - (d.age - 3.5) / 2.5, 0, 1));
      if (d.age > 6 || d.c.y > this.groundY) {
        d.c.destroy();
        this.debris.splice(i, 1);
      }
    }
  }

  /** One-shot effect sprite: pops in small, expands and fades, then destroys. */
  private fxPop(x: number, y: number, frame: string, size: number, grow: number, ms: number): void {
    if (!hasV2(this, frame)) return;
    const from = 0.55;
    const img = this.add.image(x, y, V2, frame)
      .setDisplaySize(size * from, size * from)
      .setDepth(20);
    this.uiCam.ignore(img);
    this.tweens.add({
      targets: img,
      displayWidth: size * grow,
      displayHeight: size * grow,
      alpha: 0,
      duration: ms,
      ease: 'Quad.out',
      onComplete: () => img.destroy(),
    });
  }

  private explode(worldX: number, worldY: number): void {
    const size = Math.max(80, this.rocketH * 2.6) * this.rocket.scaleX;

    if (hasV2(this, FX_ART.blastBurst)) {
      // three layers: the white-hot flash, the fireball, and the ground-hugging
      // trail, plus a few slow clouds that outlive the fire
      this.fxPop(worldX, worldY, FX_ART.blastBurst, size * 1.2, 2.1, 620);
      this.fxPop(worldX, worldY, FX_ART.blastHit, size * 1.5, 1.8, 900);
      this.fxPop(worldX, worldY + this.rocketH * 0.35, FX_ART.blastGround, size, 1.6, 1200);
      for (let i = 0; i < 3; i++) {
        this.fxPop(
          worldX + Phaser.Math.Between(-size * 0.5, size * 0.5),
          worldY + Phaser.Math.Between(-size * 0.3, size * 0.4),
          FX_ART.cloudXl, size * 0.9, 1.9, 1400,
        );
      }
    } else {
      const frame = hasFrame(this, 'fx_blast') ? 'fx_blast' : 'fx_explosion';
      if (hasFrame(this, frame)) {
        const img = this.add.image(worldX, worldY, UI, frame).setDepth(20);
        this.uiCam.ignore(img);
        img.setDisplaySize(size * 1.7, size * 1.7).setScale(img.scaleX * 0.35, img.scaleY * 0.35);
        this.tweens.add({
          targets: img,
          scaleX: img.scaleX * 2.4,
          scaleY: img.scaleY * 2.4,
          alpha: 0,
          duration: 850,
          ease: 'Quad.out',
          onComplete: () => img.destroy(),
        });
      }
    }
    if (this.smoke) {
      for (let i = 0; i < 16; i++) {
        this.smoke.emitParticleAt(worldX + Phaser.Math.Between(-40, 40), worldY + Phaser.Math.Between(-40, 40));
      }
    }
    this.cameras.main.shake(420, 0.008);
    this.rocket.setVisible(false);
  }

  // ---------------- scenery ----------------

  private buildStars(): void {
    const rng = new Phaser.Math.RandomDataGenerator(['flight-stars']);
    for (let i = 0; i < 150; i++) {
      this.stars.push({
        x: rng.frac(), y: rng.frac(),
        r: rng.realInRange(0.7, 2.1),
        phase: rng.realInRange(0, Math.PI * 2),
        rate: rng.realInRange(0.6, 2.2),
      });
    }
  }

  private drawBackdrop(tel: Telemetry): void {
    const { width, height } = this.scale;
    const onMoon = tel.bodyName === 'moon';
    const alt = tel.altitude;

    // the daylight sky, repainted only when the altitude moved enough to show
    if (this.skyTex && this.skyImg) {
      const bucket = onMoon ? -2 : Math.round(Math.min(alt, 70000) / 250);
      if (bucket !== this.skyAlt) {
        this.skyAlt = bucket;
        const [top, mid, bottom] = onMoon ? [0x020208, 0x04040e, 0x070716] : skyColors(alt);
        paintSky(this.skyTex, top, mid, bottom);
      }
    }

    // painted layers, cross-faded by altitude / body: the Earth-from-orbit
    // painting as the air thins, deep space far out, the Moon in its sphere
    const want = onMoon
      ? BG.flightMoon
      : alt > 300000 ? BG.flightSpace : BG.flightEarth;
    this.crossfade(want);
    const paintAlpha = onMoon ? 1 : smoothstep(14000, 46000, alt);
    this.backdrop?.setAlpha(paintAlpha);

    // a little dimming over the painting so the HUD and rocket stay on top
    const g = this.skyGfx;
    g.clear();
    const left = -width / 2;
    const top = -height / 2;
    const dim = onMoon ? 0.25 : Phaser.Math.Linear(0, 0.4, smoothstep(30000, 120000, alt));
    if (dim > 0.01) {
      g.fillStyle(0x05050f, dim);
      g.fillRect(left * BG_OVERSCAN, top * BG_OVERSCAN, width * BG_OVERSCAN, height * BG_OVERSCAN);
    }

    // twinkling stars come out as the sky goes dark; fixed in place, so they
    // read as a starfield instead of the static snow they used to be
    const sg = this.starGfx;
    sg.clear();
    const starVis = onMoon ? 1 : smoothstep(22000, 60000, alt);
    if (starVis > 0.02) {
      const now = this.time.now / 1000;
      for (const s of this.stars) {
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(now * s.rate + s.phase));
        sg.fillStyle(0xffffff, starVis * tw);
        sg.fillCircle(left + s.x * width, top + s.y * height, s.r);
      }
    }
  }

  private crossfade(key: string): void {
    if (!this.backdrop) return;
    if (this.backdrop.texture.key === key) return;
    if (!this.textures.exists(key)) return;
    if (this.fading) return;
    this.fading = true;
    const { width, height } = this.scale;
    // new layer sits inside bgRoot so it inherits the counter-scale
    const next = this.add.image(0, 0, key).setDisplaySize(width * BG_OVERSCAN, height * BG_OVERSCAN).setAlpha(0);
    this.bgRoot.addAt(next, this.bgRoot.getIndex(this.backdrop) + 1);
    this.tweens.add({
      targets: next,
      alpha: this.backdrop.alpha,
      duration: 500,
      onComplete: () => {
        this.backdrop!.setTexture(key);
        next.destroy();
        this.fading = false;
      },
    });
  }

  private fading = false;

  private drawEarth(tel: Telemetry, zoom: number): void {
    const g = this.earthGfx;
    g.clear();
    // Only draw the live planet once the camera is far enough out that the
    // painted backdrop no longer reads as the ground.
    if (zoom > 0.2) return;

    // centred so the planet's top meets the pad's ground line
    const ey = EARTH.R + this.groundY;
    g.fillStyle(0x4a90e2, 1);
    g.fillCircle(0, ey, EARTH.R);
    g.fillStyle(0x7ac74f, 0.85);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 1;
      g.fillEllipse(Math.cos(a) * EARTH.R * 0.55, ey + Math.sin(a) * EARTH.R * 0.55,
        EARTH.R * 0.5, EARTH.R * 0.3);
    }
    // a layered blue limb: the atmosphere as a soft halo, not one hard ring
    const band = Math.max(9000, 3 / zoom);
    for (let i = 0; i < 4; i++) {
      g.lineStyle(band, 0x6ec6ff, 0.26 - i * 0.05);
      g.strokeCircle(0, ey, EARTH.R + band * (0.5 + i));
    }

    if (tel.bodyName === 'moon' || tel.altitude > 40000) {
      const my = -(MOON.y - EARTH.R);
      g.fillStyle(0xbfc3c7, 1);
      g.fillCircle(MOON.x, my, MOON.R);
      g.fillStyle(0x8f939a, 1);
      for (let i = 0; i < 6; i++) {
        g.fillCircle(MOON.x + (i - 3) * MOON.R * 0.3, my + ((i % 3) - 1) * MOON.R * 0.3, MOON.R * 0.09);
      }
    }
  }

  /** Dashed gravity-only path ahead, with a marker at its highest point. */
  private drawTrajectory(zoom: number): void {
    const g = this.trajGfx;
    g.clear();
    if (this.previewPts.length < 2) return;
    g.lineStyle(Math.max(2, 1.6 / zoom), 0xffd23f, 0.85);
    let apo = { x: 0, y: 0, r: -Infinity };
    for (let i = 1; i < this.previewPts.length; i++) {
      const a = this.previewPts[i - 1];
      const b = this.previewPts[i];
      if (i % 2 === 1) g.lineBetween(a.x, -(a.y - EARTH.R), b.x, -(b.y - EARTH.R));
      const r = Math.hypot(b.x, b.y);
      if (r > apo.r) apo = { x: b.x, y: -(b.y - EARTH.R), r };
    }
    const last = this.previewPts[this.previewPts.length - 1];
    // only mark a real summit, not the end of a still-climbing preview
    if (Math.hypot(last.x, last.y) < apo.r - 1) {
      const rad = Math.max(5, 6 / zoom);
      g.fillStyle(0xffd23f, 1).fillCircle(apo.x, apo.y, rad);
      g.lineStyle(Math.max(2, 2 / zoom), 0x1d1b2e, 1).strokeCircle(apo.x, apo.y, rad);
    }
  }

  // ---------------- HUD ----------------

  private updateHUD(tel: Telemetry): void {
    const lines = [
      `${t('flight.hud.alt')}: ${fmtDist(tel.altitude)}`,
      `${t('flight.hud.speed')}: ${fmtSpeed(tel.speed)}`,
      `${t('flight.hud.vspeed')}: ${fmtSpeed(tel.vspeed)}`,
      `${t('flight.hud.engine')}: ${t(tel.engineOn ? 'common.on' : 'common.off')} · ${t('flight.hud.throttle')} ${Math.round(tel.throttle * 100)}%`,
      `${t('flight.hud.pitch')}: ${Math.round(tel.targetAngle)}°`,
      `${t('flight.hud.stage')}: ${tel.stage}`,
      `${t('flight.hud.apo')}: ${tel.apoapsis === Infinity ? t('flight.escape') : fmtDist(tel.apoapsis)}`,
      `${t('flight.hud.time')}: ${fmtTime(tel.time)}`,
    ];
    if (this.warp > 1) lines.push(t('flight.hud.warp', { n: this.warp }));
    if (this.paused) lines.push(`⏸ ${t('flight.hud.paused')}`);
    this.hudText.setText(lines.join('\n'));

    // fuel bar + fuel canister badge
    const g = this.fuelBar;
    g.clear();
    const barX = hasV2(this, UI_V2_ART.iconFuel) ? 44 : 20;
    const barW = hasV2(this, UI_V2_ART.iconFuel) ? 252 : 276;
    g.fillStyle(0x1d1b2e, 1).fillRoundedRect(barX, 196, barW, 16, 8);
    const frac = Phaser.Math.Clamp(tel.fuelPercent, 0, 1);
    if (frac > 0) {
      g.fillStyle(frac > 0.3 ? 0xffd23f : 0xff6b6b, 1)
        .fillRoundedRect(barX, 196, Math.max(16, barW * frac), 16, 8);
    }

    this.logText.setText(this.logLines.slice(-5).join('\n'));
  }

  private updateSay(): void {
    if (this.sayQueue.length === 0) { this.sayBubble?.setVisible(false); return; }
    const top = this.sayQueue[this.sayQueue.length - 1];
    if (this.sim.t > top.until) { this.sayQueue.pop(); return; }

    if (!this.sayBubble) {
      const { width, height } = this.scale;
      const { container, setText } = makeSpeechBubble(this, 290, 96, '', {
        fontSize: 14,
        portrait: 'astronaut',
      });
      container.setPosition(width / 2 + 140, height / 2 - 130).setDepth(60);
      this.sayBubble = container;
      this.saySetter = setText;
      this.cameras.main.ignore(container);
    }
    this.sayBubble.setVisible(true);
    this.saySetter?.(String(top.text));
  }

  // ---------------- events ----------------

  private onSimEvent(e: SimEvent): void {
    switch (e.type) {
      case 'liftoff':
        this.pushLog(t('flight.liftoff'));
        this.releaseClamps();
        this.cameras.main.shake(900, 0.0035);
        break;
      case 'stage':
        this.pushLog(t('flight.stage_sep'));
        this.separateStage((e.data ?? 1) - 1);
        break;
      case 'fuel_empty': this.pushLog(t('flight.fuel_empty')); break;
      case 'parachute': this.pushLog('⛱ ' + t('part.parachute.name')); break;
      case 'landed': this.pushLog(t('flight.landed')); break;
      case 'crashed':
        this.pushLog(t('flight.crashed'));
        this.explode(this.rocket.x, this.rocket.y);
        break;
    }
  }

  private pushLog(s: string): void {
    this.logLines.push(s);
    if (this.logLines.length > 8) this.logLines.shift();
  }

  // ---------------- lifecycle ----------------

  private finish(reason: string, vars?: Record<string, string | number>): void {
    if (this.ended) return;
    this.ended = true;
    const tel = this.sim.telemetry(this.control);
    const success = reason === 'success';
    const mass = computeStats(state.design.parts).mass;
    const result = {
      success,
      failKey: success ? undefined : reason,
      failVars: vars,
      maxAltitude: tel.maxAltitude,
      fuelPercent: tel.fuelPercent,
      time: tel.time,
    };
    const stars = this.mission
      ? this.mission.stars(result, { landedSoftly: this.sim.phase === 'landed', mass })
      : (success ? 1 : 0);
    if (this.mission && success) state.recordResult(this.mission.id, stars, tel.time);
    this.statusText.setText(success ? t('result.success') : t(reason, vars));
    this.time.delayedCall(success ? 900 : 1400, () => {
      this.leave('result', { result, stars });
    });
  }

  private restart(): void {
    this.scene.restart();
  }

  private leave(scene: string, data?: object): void {
    this.scene.start(scene, data);
  }
}

/**
 * Flight simulation — pure TS, deterministic, fixed timestep dt = 1/60 s.
 * Semi-implicit Euler, patched conic (Earth + static Moon), CORE_SPEC §4.
 */
import { partDef, PART_AREA } from '../data/parts';
import { EARTH, G0, Body } from '../data/bodies';
import { atmosphere, flightWorld, PROFILES, type Difficulty } from './environment';
import { splitStages, computeStats } from './rocket';

export const DT = 1 / 60;

/** What the pilot's controls ask of the rocket, read every tick. */
export interface RocketControl {
  engineOn: boolean;
  throttle: number;        // 0..1
  targetAngle: number;     // radians, 0 = up, + = east
  stageRequest: boolean;
  parachute: boolean;
}

export function defaultControl(): RocketControl {
  return {
    engineOn: false, throttle: 1, targetAngle: 0,
    stageRequest: false, parachute: false,
  };
}

export type FlightPhase = 'pad' | 'flying' | 'landed' | 'crashed';

export interface SimEvent {
  type: 'fuel_empty' | 'stage' | 'liftoff' | 'landed' | 'crashed' | 'parachute';
  /** for 'stage': the new stage number (1-based) */
  data?: number;
}

export interface Telemetry {
  density: number;
  dynamicPressure: number;
  dragForce: number;
  mass: number;
  mach: number;
  thrust: number;
  altitude: number;        // m above dominant body
  speed: number;
  vspeed: number;          // radial (up = +)
  hspeed: number;          // tangential
  fuelPercent: number;     // 0..1 of TOTAL starting fuel
  stageFuel: number;       // kg in current stage
  stageFuelMax: number;
  apoapsis: number;        // altitude, m; Infinity = escape
  periapsis: number;
  angle: number;           // deg, current pointing
  targetAngle: number;
  throttle: number;
  engineOn: boolean;
  stage: number;           // 1-based
  time: number;            // sim time, s
  bodyName: 'earth' | 'moon';
  maxAltitude: number;
  launched: boolean;
}

interface StageState {
  parts: string[];
  fuel: number;          // remaining kg
  fuelMax: number;
  thrustVac: number;
  thrustAslIspFrac: number; // Σ F_i·ispAsl_i / F_total — for isp_eff
  ispVac: number;        // combined
  dry: number;           // dry mass of this stage
  hasEngine: boolean;
}

/**
 * Wind speed toward the east at height h, m/s, for a surface wind `w10`.
 * Wind grows with height to a jet-stream peak around 11 km, then dies out in
 * the thin upper air: the strong winds aloft are why rockets are checked for
 * wind shear near max-Q, not only at the pad. Kept simple: 3× the surface
 * value at the peak, zero by 25 km.
 */
export function windAt(h: number, w10: number): number {
  if (w10 === 0 || h < 0) return 0;
  if (h <= 11000) return w10 * (1 + 2 * (h / 11000));
  if (h >= 25000) return 0;
  return w10 * 3 * (1 - (h - 11000) / 14000);
}

export interface FlightOptions {
  /** Surface wind blowing toward the east, m/s (negative = toward the west). */
  windEast?: number;
  difficulty?: Difficulty;
}

export class FlightSim {
  x = 0;
  y = EARTH.R;             // start on the pad at the top of Earth
  vx = 0;
  vy = 0;
  angle = 0;               // rad from local vertical
  angularVelocity = 0;     // rad/s; steering applies torque, never instant rotation
  t = 0;
  phase: FlightPhase = 'pad';
  launched = false;
  stageIndex = 0;          // index into stagesBotUp; 0 = stage 1
  fuelBurnedTotal = 0;
  fuelTotalStart = 0;
  maxAltitude = 0;
  parachuteDeployed = false;

  /** stages bottom-first */
  readonly stages: StageState[];
  readonly stats = { mass: 0, stable: true, cd: 0.5, hasParachute: false };
  /** Surface wind toward the east, m/s. */
  readonly windEast: number;
  readonly earth: Body;
  readonly moon: Body;
  readonly moonSOI: number;
  readonly difficulty: Difficulty;
  readonly profile: typeof PROFILES[Difficulty];
  dragForce = 0;
  thrust = 0;
  constructor(partIds: string[], options: FlightOptions | Difficulty = {}) {
    const opts = typeof options === 'string' ? { difficulty: options } : options;
    this.difficulty = opts.difficulty ?? 'normal';
    this.windEast = opts.windEast ?? 0;
    const world = flightWorld(this.difficulty);
    this.earth=world.earth; this.moon=world.moon; this.moonSOI=world.moonSOI;
    this.profile=PROFILES[this.difficulty]; this.y=this.earth.R;
    const stats = computeStats(partIds);
    this.stats.stable = stats.stable;
    this.stats.cd = stats.cd;
    this.stats.hasParachute = stats.hasParachute;
    this.stats.mass = stats.mass;

    const groupsBotUp = [...splitStages(partIds)].reverse();
    this.stages = groupsBotUp.map((g) => {
      const engines = g.filter((id) => partDef(id).kind === 'engine').map(partDef);
      const F = engines.reduce((s, e) => s + (e.thrustVac ?? 0), 0);
      const fuel = g.reduce((s, id) => s + (partDef(id).fuel ?? 0), 0);
      return {
        parts: g,
        fuel, fuelMax: fuel,
        thrustVac: F,
        thrustAslIspFrac:
          F > 0 ? engines.reduce((s, e) => s + (e.thrustVac ?? 0) * (e.ispAsl ?? 0), 0) / F : 0,
        ispVac:
          F > 0
            ? F / engines.reduce((s, e) => s + (e.thrustVac ?? 0) / (e.ispVac ?? 1), 0)
            : 0,
        dry: g.reduce((s, id) => s + partDef(id).massDry, 0)*this.profile.dryMass,
        hasEngine: engines.length > 0,
      };
    });
    this.fuelTotalStart = this.stages.reduce((s, st) => s + st.fuel, 0);
  }

  /** current total mass: dry + remaining fuel of live stages (≥ current) */
  get mass(): number {
    let m = 0;
    for (let i = this.stageIndex; i < this.stages.length; i++) {
      m += this.stages[i].dry + this.stages[i].fuel;
    }
    return Math.max(m, 1);
  }

  get body(): Body {
    const dx = this.x - this.moon.x;
    const dy = this.y - this.moon.y;
    return Math.hypot(dx, dy) < this.moonSOI ? this.moon : this.earth;
  }

  get stage(): StageState | null {
    return this.stages[this.stageIndex] ?? null;
  }

  /** one fixed step; appends events. */
  step(control: RocketControl, events: SimEvent[]): void {
    if (this.phase === 'crashed' || this.phase === 'landed') {
      this.t += DT;
      return;
    }

    // --- staging command ---
    if (control.stageRequest) {
      control.stageRequest = false;
      if (this.stageIndex < this.stages.length - 1) {
        this.stageIndex++;
        events.push({ type: 'stage', data: this.stageIndex + 1 });
      }
    }

    const st = this.stage;
    // --- parachute command ---
    if (control.parachute && !this.parachuteDeployed) {
      control.parachute = false;
      if (this.stats.hasParachute) {
        this.parachuteDeployed = true;
        events.push({ type: 'parachute' });
      }
    }

    // --- dominant body + gravity ---
    const body = this.body;
    const rx = this.x - body.x;
    const ry = this.y - body.y;
    const r = Math.hypot(rx, ry) || 1;
    const ux = rx / r; // local up (radial)
    const uy = ry / r;
    const ex = uy;     // local east = up rotated 90° clockwise
    const ey = -ux;
    const h = r - body.R;
    const g = body.GM / (r * r);

    // --- atmosphere (Earth only) ---
    const air=atmosphere(h,this.earth,this.difficulty === 'realistic');
    const rho=body === this.earth ? air.density : 0;
    const f=body === this.earth ? Math.min(1,air.pressure/101325) : 0;

    // A bounded attitude controller with rotational inertia. Gimbals lose
    // authority when throttled down; no reaction-control thrusters are fitted.
    let da = control.targetAngle - this.angle;
    // normalize to [-π, π]
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const authority = control.engineOn && st?.hasEngine && st.fuel > 0 ? 0.6*Math.max(0,Math.min(1,control.throttle)) : 0;
    const inertia = Math.max(0.6, this.mass / 1750)*this.profile.inertia;
    const command = Math.max(-authority,Math.min(authority,da*1.2-this.angularVelocity*0.65));
    const speed = Math.hypot(this.vx,this.vy);
    const flowAngle = Math.atan2(this.vx*ex+this.vy*ey,this.vx*ux+this.vy*uy);
    const dynamicPressure = 0.5*rho*speed*speed;
    const aero = this.launched ? Math.min(0.8,dynamicPressure/40000) : 0;
    const restoring = Math.sin(flowAngle-this.angle)*aero*(this.stats.stable ? 0.8 : -0.25);
    this.angularVelocity += (command/inertia+restoring-this.angularVelocity*aero*0.5)*DT;
    this.angle += this.angularVelocity*DT;

    // wobble: unstable rocket gets pitch noise in atmosphere
    let thrustAngle = this.angle;
    if (!this.stats.stable && rho > 0 && this.launched) {
      thrustAngle += (5 * Math.PI / 180) * Math.sin(this.t * 7);
    }

    // --- thrust ---
    let Fx = 0;
    let Fy = 0;
    let fuelEmptyEvent = false;
    const canThrust = control.engineOn && st !== null && st.fuel > 0 && st.hasEngine;
    this.thrust=0;
    if (canThrust) {
      const ispEff = st.ispVac - (st.ispVac - st.thrustAslIspFrac) * f;
      const requestedF = Math.max(0,Math.min(1,control.throttle)) * st.thrustVac * (ispEff / st.ispVac);
      const F = Math.min(requestedF, st.fuel * ispEff * G0 / (DT*this.profile.consumption));
      this.thrust=F;
      const mdot = F / (ispEff * G0)*this.profile.consumption;
      const burn = mdot * DT;
      st.fuel -= burn;
      this.fuelBurnedTotal += burn;
      if (st.fuel <= 0) {
        st.fuel = 0;
        fuelEmptyEvent = true;
      }
      const tx = Math.cos(thrustAngle) * ux + Math.sin(thrustAngle) * ex;
      const ty = Math.cos(thrustAngle) * uy + Math.sin(thrustAngle) * ey;
      Fx = tx * F;
      Fy = ty * F;
    }
    if (fuelEmptyEvent) events.push({ type: 'fuel_empty' });

    // --- drag ---
    let Dx = 0;
    let Dy = 0;
    this.dragForce=0;
    if (rho > 0) {
      // drag acts on the speed through the air, so wind pushes the rocket
      // sideways once it has left the pad
      const w = this.launched && body === this.earth ? windAt(h, this.windEast) : 0;
      const relX = this.vx - w * ex;
      const relY = this.vy - w * ey;
      const sp = Math.hypot(relX, relY);
      if (sp > 0.01) {
        let cd = this.stats.cd*this.profile.drag;
        if(this.difficulty !== 'normal') cd *= 1+0.6*Math.exp(-Math.pow((sp/air.sound-1)/0.35,2));
        let area = PART_AREA;
        // A sideways hull presents more area to the airflow.
        area *= 1+3*Math.abs(Math.sin(this.angle-flowAngle));
        if (this.parachuteDeployed && h < 20000 && body === this.earth) {
          cd = 1.5;
          area += 30;
        }
        const D = Math.min(0.5 * rho * sp * sp * cd * area,this.mass*sp/DT);
        this.dragForce=D;
        Dx = (-relX / sp) * D;
        Dy = (-relY / sp) * D;
      }
    }

    // --- integrate (semi-implicit Euler) ---
    const m = this.mass;
    const ax = (Fx + Dx) / m - g * ux;
    const ay = (Fy + Dy) / m - g * uy;
    this.vx += ax * DT;
    this.vy += ay * DT;
    this.x += this.vx * DT;
    this.y += this.vy * DT;
    this.t += DT;

    // --- ground ---
    const r2 = Math.hypot(this.x - body.x, this.y - body.y);
    const h2 = r2 - body.R;
    if (!this.launched) {
      // on pad: stay put until net upward force > 0
      const vUp = this.vx * ux + this.vy * uy;
      if (vUp > 0.01) {
        this.launched = true;
        this.phase = 'flying';
        events.push({ type: 'liftoff' });
      } else {
        this.x = body.x + (this.x - body.x) / r2 * body.R;
        this.y = body.y + (this.y - body.y) / r2 * body.R;
        this.vx = 0;
        this.vy = 0;
      }
    } else if (h2 <= 0) {
      const sp = Math.hypot(this.vx, this.vy);
      const angDeg = Math.abs(this.angle) * 180 / Math.PI;
      // clamp to surface
      this.x = body.x + (this.x - body.x) / r2 * body.R;
      this.y = body.y + (this.y - body.y) / r2 * body.R;
      if (sp < 6 && angDeg < 15) {
        this.phase = 'landed';
        events.push({ type: 'landed' });
      } else {
        this.phase = 'crashed';
        events.push({ type: 'crashed' });
      }
      this.vx = 0;
      this.vy = 0;
    }

    const alt = Math.max(0, h2);
    if (this.launched && alt > this.maxAltitude) this.maxAltitude = alt;
  }

  telemetry(control?: RocketControl): Telemetry {
    const body = this.body;
    const rx = this.x - body.x;
    const ry = this.y - body.y;
    const r = Math.hypot(rx, ry) || 1;
    const ux = rx / r;
    const uy = ry / r;
    const ex = uy;
    const ey = -ux;
    const vUp = this.vx * ux + this.vy * uy;
    const vEast = this.vx * ex + this.vy * ey;
    const speed = Math.hypot(this.vx, this.vy);
    const h = r - body.R;

    // orbital elements vs dominant body
    const eps = (speed * speed) / 2 - body.GM / r;
    const hVec = rx * this.vy - ry * this.vx; // z of r×v
    let apo = Infinity;
    let peri = 0;
    if (eps < 0) {
      const a = -body.GM / (2 * eps);
      const e = Math.sqrt(Math.max(0, 1 + (2 * eps * hVec * hVec) / (body.GM * body.GM)));
      apo = a * (1 + e) - body.R;
      peri = a * (1 - e) - body.R;
    }

    const st = this.stage;
    const fuelLeft = this.stages.slice(this.stageIndex).reduce((s, s_) => s + s_.fuel, 0);
    const air=atmosphere(h,this.earth,this.difficulty === 'realistic');
    const density=body === this.earth ? air.density : 0;
    return {
      density, dynamicPressure:0.5*density*speed*speed, dragForce:this.dragForce, mass:this.mass, mach:density>0?speed/air.sound:0, thrust:this.thrust,
      altitude: Math.max(0, h),
      speed, vspeed: vUp, hspeed: vEast,
      fuelPercent: this.fuelTotalStart > 0 ? fuelLeft / this.fuelTotalStart : 0,
      stageFuel: st?.fuel ?? 0,
      stageFuelMax: st?.fuelMax ?? 0,
      apoapsis: apo, periapsis: peri,
      angle: this.angle * 180 / Math.PI,
      targetAngle: (control?.targetAngle ?? 0) * 180 / Math.PI,
      throttle: control?.throttle ?? 1,
      engineOn: control?.engineOn ?? false,
      stage: this.stageIndex + 1,
      time: this.t,
      bodyName: body.name,
      maxAltitude: this.maxAltitude,
      launched: this.launched,
    };
  }

  /** gravity-only trajectory preview: returns points ahead (for the dashed line). */
  previewTrajectory(maxPoints = 400): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    let x = this.x, y = this.y, vx = this.vx, vy = this.vy;
    const step = DT * 10; // coarser preview
    for (let i = 0; i < maxPoints; i++) {
      const body = Math.hypot(x-this.moon.x,y-this.moon.y)<this.moonSOI ? this.moon : this.earth;
      const rx = x - body.x, ry = y - body.y;
      const r = Math.hypot(rx, ry) || 1;
      if (r - body.R < 0) break; // hit ground
      const g = body.GM / (r * r);
      vx += (-g * rx / r) * step;
      vy += (-g * ry / r) * step;
      x += vx * step;
      y += vy * step;
      if (i % 4 === 0) pts.push({ x, y });
      // closed loop detection: returned near the start after travelling
      const backToStart = Math.hypot(x - this.x, y - this.y) < (r - body.R) * 0.005;
      if (i > 20 && backToStart) break;
    }
    return pts;
  }
}

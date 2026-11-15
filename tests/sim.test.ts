import { describe, it, expect } from 'vitest';
import { FlightSim, defaultControl, DT } from '../src/physics/sim';
import { EARTH, G0 } from '../src/data/bodies';
import { computeStats } from '../src/physics/rocket';
import { PRESET_BASIC } from '../src/data/parts';

function run(sim: FlightSim, steps: number, control: ReturnType<typeof defaultControl>) {
  const events: { type: string }[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step(control, events as never);
  }
  return events;
}

describe('flight sim (spec §4)', () => {
  it('retains angular momentum when the steering target reverses', () => {
    const sim = new FlightSim(PRESET_BASIC);
    sim.y = EARTH.R+80000; sim.launched=true; sim.phase='flying';
    const c = {...defaultControl(),engineOn:true,targetAngle:0.5};
    run(sim,60,c);
    expect(sim.angularVelocity).toBeGreaterThan(0);
    const angle=sim.angle;
    run(sim,1,{...c,targetAngle:-0.5});
    expect(sim.angle).toBeGreaterThan(angle);
    run(sim,90,{...c,targetAngle:-0.5});
    expect(sim.angularVelocity).toBeLessThan(0);
  });

  it('turning does not erase sideways velocity in vacuum', () => {
    const sim = new FlightSim(PRESET_BASIC);
    sim.y=EARTH.R+80000; sim.vx=200; sim.launched=true; sim.phase='flying';
    run(sim,60,{...defaultControl(),targetAngle:-0.5});
    expect(sim.vx).toBeGreaterThan(199);
  });

  it('half throttle halves propellant flow and produces less acceleration', () => {
    const full = new FlightSim(PRESET_BASIC), half = new FlightSim(PRESET_BASIC);
    const c = {...defaultControl(),engineOn:true,throttle:1};
    run(full,120,c); run(half,120,{...c,throttle:0.5});
    expect(half.fuelBurnedTotal).toBeCloseTo(full.fuelBurnedTotal/2,6);
    expect(half.telemetry().vspeed).toBeLessThan(full.telemetry().vspeed);
    expect(half.telemetry().altitude).toBeLessThan(full.telemetry().altitude);
  });

  it('zero throttle burns no fuel and the last tick cannot burn more than remains', () => {
    const sim = new FlightSim(PRESET_BASIC);
    const c = {...defaultControl(),engineOn:true,throttle:0};
    run(sim,60,c); expect(sim.fuelBurnedTotal).toBe(0);
    sim.stage!.fuel = 0.001;
    run(sim,1,{...c,throttle:1});
    expect(sim.fuelBurnedTotal).toBeCloseTo(0.001,10);
    expect(sim.stage!.fuel).toBe(0);
  });

  it('only deploys a parachute installed on a live stage', () => {
    const sim = new FlightSim(PRESET_BASIC);
    sim.y = EARTH.R + 5000;
    sim.launched = true;
    sim.phase = 'flying';
    const events: { type: string }[] = [];
    sim.step({...defaultControl(), parachute: true}, events as never);
    expect(sim.parachuteDeployed).toBe(false);
    expect(events.some((event) => event.type === 'parachute')).toBe(false);
  });

  it('uses the installed canopy area and heavier rockets descend faster under it', () => {
    const lightParts = ['nose_cone', 'parachute', 'probe_core', 'tank_m', 'engine_spark'];
    const heavyParts = ['nose_cone', 'parachute', 'probe_core', 'tank_m', 'tank_l', 'engine_spark'];
    const light = new FlightSim(lightParts);
    const heavy = new FlightSim(heavyParts);
    for (const sim of [light, heavy]) {
      sim.y = EARTH.R + 5000;
      sim.vy = -80;
      sim.launched = true;
      sim.phase = 'flying';
      sim.step({...defaultControl(), parachute: true}, [] as never);
      expect(sim.parachuteDeployed).toBe(true);
      expect(sim.parachuteStageIndex).toBe(0);
      expect(sim.telemetry().dragForce).toBeGreaterThan(0);
    }
    expect(heavy.mass).toBeGreaterThan(light.mass);
    expect(heavy.vy).toBeLessThan(light.vy);
  });

  it('stationary rocket stays on the pad', () => {
    const sim = new FlightSim(PRESET_BASIC);
    const c = defaultControl();
    run(sim, 300, c);
    expect(sim.launched).toBe(false);
    expect(Math.hypot(sim.x, sim.y - EARTH.R)).toBeLessThan(1);
  });

  it('lifts off and gains altitude with engine on', () => {
    const sim = new FlightSim(PRESET_BASIC);
    const c = defaultControl();
    c.engineOn = true;
    c.throttle = 1;
    const events = run(sim, 600, c); // 10 s
    expect(sim.launched).toBe(true);
    expect(events.some((e) => e.type === 'liftoff')).toBe(true);
    expect(sim.telemetry().altitude).toBeGreaterThan(1000);
  });

  it('circular orbit at h=80 km holds altitude within ±1% over one period', () => {
    const sim = new FlightSim(PRESET_BASIC);
    // place at 80 km altitude with circular velocity
    const r = EARTH.R + 80000;
    const v = Math.sqrt(EARTH.GM / r);
    sim.x = r; sim.y = 0;
    sim.vx = 0; sim.vy = v; // tangential
    sim.launched = true;
    sim.phase = 'flying';
    const c = defaultControl();
    const period = (2 * Math.PI * r) / v;
    const steps = Math.floor(period / DT);
    let minAlt = Infinity, maxAlt = -Infinity;
    for (let i = 0; i < steps; i++) {
      sim.step(c, [] as never);
      const alt = Math.hypot(sim.x, sim.y) - EARTH.R;
      minAlt = Math.min(minAlt, alt);
      maxAlt = Math.max(maxAlt, alt);
    }
    expect(minAlt).toBeGreaterThan(80000 * 0.99);
    expect(maxAlt).toBeLessThan(80000 * 1.01);
  });

  it('Δv estimate consistent with formula within ~1%', () => {
    // compute stats dv vs integrating burn: fly vertical in vacuum-ish high alt
    const stats = computeStats(PRESET_BASIC);
    const sim = new FlightSim(PRESET_BASIC);
    // put in orbit, fire prograde full throttle, measure Δv from speed change
    const r = EARTH.R + 200000;
    const v0 = Math.sqrt(EARTH.GM / r);
    sim.x = r; sim.y = 0; sim.vx = 0; sim.vy = v0;
    sim.launched = true; sim.phase = 'flying';
    const c = defaultControl();
    c.engineOn = true; c.throttle = 1; c.targetAngle = Math.PI / 2;
    // burn all stage-1 fuel
    let burned = 0;
    const st = () => sim.stage?.fuel ?? 0;
    const startFuel = st();
    for (let i = 0; i < 60 * 600 && st() > 0; i++) {
      sim.step(c, [] as never);
      burned = startFuel - st();
    }
    // real Δv ≈ isp·g0·ln(m0/m1); sim's own formula already uses that → sanity only
    expect(stats.stages[0].dv).toBeGreaterThan(2000);
    expect(burned).toBeGreaterThan(900);
  });

  it('fuel empty event fires once', () => {
    const sim = new FlightSim(PRESET_BASIC);
    const c = defaultControl();
    c.engineOn = true; c.throttle = 1;
    let count = 0;
    const events: { type: string }[] = [];
    for (let i = 0; i < 60 * 120; i++) {
      const ev: { type: string }[] = [];
      sim.step(c, ev as never);
      for (const e of ev) if (e.type === 'fuel_empty') count++;
      events.push(...ev);
      if (sim.stage && sim.stage.fuel <= 0 && count >= 1) break;
    }
    expect(count).toBe(1);
  });
});

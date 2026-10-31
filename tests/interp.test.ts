import { describe, it, expect } from 'vitest';
import { compileBlocklyJSON } from '../src/rocketscript/compile';
import { Interpreter, type InterpEvent } from '../src/rocketscript/interp';
import { defaultControl } from '../src/physics/sim';
import type { Telemetry } from '../src/physics/sim';
import { computeStats } from '../src/physics/rocket';
import { PRESET_BASIC } from '../src/data/parts';

const OPTS = (over: Partial<Parameters<typeof Interpreter.prototype.tick>[0]> = {}) => {
  void over;
  const s = computeStats(PRESET_BASIC);
  return { hasAltSensor: s.hasAltSensor, hasSpeedSensor: s.hasSpeedSensor, hasParachute: s.hasParachute, hasControl: true };
};

function tel(alt: number, time: number, fuel = 1): Telemetry {
  return {
    altitude: alt, speed: 0, vspeed: 0, hspeed: 0, fuelPercent: fuel,
    stageFuel: fuel > 0 ? 100 : 0, stageFuelMax: 100, apoapsis: 0, periapsis: 0,
    angle: 0, targetAngle: 0, throttle: 1, engineOn: false, stage: 1,
    time, bodyName: 'earth', maxAltitude: alt, launched: true,
  };
}

function program(inner: object[]): object {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'rs_when_launched', id: 'hat1', x: 0, y: 0,
          next: inner.length ? { block: inner[0] } : undefined,
        },
      ],
    },
  };
}

// chain helper: next.block → next
function chain(...blocks: object[]): object[] {
  for (let i = 0; i < blocks.length - 1; i++) {
    (blocks[i] as Record<string, unknown>).next = { block: blocks[i + 1] };
  }
  return blocks;
}

const num = (n: number) => ({ type: 'math_number', fields: { NUM: n } });

describe('rocketscript interpreter', () => {
  it('when_launched → engine on sets control', () => {
    const json = program(chain({ type: 'rs_engine', id: 'e1', fields: { ON: 'ON' } }));
    const c = compileBlocklyJSON(json);
    const interp = new Interpreter(c, OPTS());
    const control = defaultControl();
    interp.tick(control, tel(0, 0.016), []);
    expect(control.engineOn).toBe(true);
  });

  it('rs_wait sleeps N sim-seconds', () => {
    const json = program(chain(
      { type: 'rs_engine', id: 'e1', fields: { ON: 'ON' } },
      { type: 'rs_wait', id: 'w1', inputs: { NUM: { shadow: num(2) } } },
      { type: 'rs_engine', id: 'e2', fields: { ON: 'OFF' } },
    ));
    const interp = new Interpreter(compileBlocklyJSON(json), OPTS());
    const control = defaultControl();
    const ev: InterpEvent[] = [];
    interp.tick(control, tel(0, 0), ev);
    expect(control.engineOn).toBe(true);
    // still waiting at t=1
    interp.tick(control, tel(0, 1), ev);
    expect(control.engineOn).toBe(true);
    // off by t=2.1
    interp.tick(control, tel(0, 2.1), ev);
    expect(control.engineOn).toBe(false);
  });

  it('rs_wait_until blocks until condition true', () => {
    const json = program(chain(
      { type: 'rs_wait_until', id: 'wu', inputs: { COND: { block: { type: 'logic_compare', fields: { OP: 'GT' }, inputs: { A: { block: { type: 'rs_get', fields: { PROP: 'altitude' } } }, B: { shadow: num(5000) } } } } } },
      { type: 'rs_engine', id: 'e2', fields: { ON: 'OFF' } },
    ));
    const interp = new Interpreter(compileBlocklyJSON(json), OPTS());
    const control = defaultControl();
    control.engineOn = true;
    interp.tick(control, tel(1000, 0), []);
    expect(control.engineOn).toBe(true);
    interp.tick(control, tel(6000, 1), []);
    expect(control.engineOn).toBe(false);
  });

  it('controls_if picks the right branch', () => {
    const json = program(chain(
      {
        type: 'controls_if', id: 'if1',
        inputs: {
          IF0: { block: { type: 'logic_boolean', fields: { BOOL: 'TRUE' } } },
          DO0: { block: { type: 'rs_engine', id: 'e1', fields: { ON: 'ON' } } },
          ELSE: { block: { type: 'rs_engine', id: 'e2', fields: { ON: 'OFF' } } },
        },
      },
    ));
    const interp = new Interpreter(compileBlocklyJSON(json), OPTS());
    const control = defaultControl();
    interp.tick(control, tel(0, 0), []);
    expect(control.engineOn).toBe(true);
  });

  it('repeat N runs body N times', () => {
    const json = program(chain(
      { type: 'variables_set', id: 's0', fields: { VAR: 'n' }, inputs: { VALUE: { shadow: num(0) } } },
      {
        type: 'controls_repeat_ext', id: 'r1',
        inputs: {
          TIMES: { shadow: num(3) },
          DO: { block: { type: 'math_change', id: 'ch', fields: { VAR: 'n' }, inputs: { DELTA: { shadow: num(1) } } } },
        },
      },
    ));
    const interp = new Interpreter(compileBlocklyJSON(json), OPTS());
    const control = defaultControl();
    for (let i = 0; i < 10; i++) interp.tick(control, tel(0, i), []);
    expect(interp.variables().get('n')).toBe(3);
  });

  it('forever loop with an empty body → error', () => {
    const json = program(chain({ type: 'rs_forever', id: 'f1' }));
    const interp = new Interpreter(compileBlocklyJSON(json), OPTS());
    const ev: InterpEvent[] = [];
    interp.tick(defaultControl(), tel(0, 0), ev);
    expect(ev.some((e) => e.type === 'error' && e.key === 'warn.infinite_loop')).toBe(true);
  });

  it('giant condition burns the budget without yielding → guard trips', () => {
    // wait_until with a 500-node AND chain: each tick re-evaluates the whole
    // condition and exhausts the 200-op budget before any yield point.
    let cond: Record<string, unknown> = { type: 'logic_boolean', fields: { BOOL: 'FALSE' } };
    for (let i = 0; i < 500; i++) {
      cond = {
        type: 'logic_operation', id: `op${i}`, fields: { OP: 'AND' },
        inputs: {
          A: { block: cond },
          B: { block: { type: 'logic_boolean', fields: { BOOL: 'FALSE' } } },
        },
      };
    }
    const json = program(chain({
      type: 'rs_wait_until', id: 'wu',
      inputs: { COND: { block: cond } },
    }));
    const interp = new Interpreter(compileBlocklyJSON(json), OPTS());
    const control = defaultControl();
    const ev: InterpEvent[] = [];
    for (let i = 0; i < 400; i++) interp.tick(control, tel(0, i / 60), ev);
    expect(ev.some((e) => e.type === 'error' && e.key === 'warn.infinite_loop')).toBe(true);
  });

  it('loose blocks produce a warning and do not run', () => {
    const json = {
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: 'rs_engine', id: 'loose', fields: { ON: 'ON' }, x: 0, y: 0 }, // not under a hat
        ],
      },
    };
    const c = compileBlocklyJSON(json);
    expect(c.warnings.some((w) => w.key === 'warn.loose_blocks')).toBe(true);
    const interp = new Interpreter(c, OPTS());
    const control = defaultControl();
    interp.tick(control, tel(0, 0), []);
    expect(control.engineOn).toBe(false);
  });

  it('altitude above event fires once', () => {
    const json = {
      blocks: {
        languageVersion: 0,
        blocks: [{
          type: 'rs_when_altitude_above', id: 'hat2', fields: { NUM: 5000 },
          next: { block: { type: 'rs_engine', id: 'e1', fields: { ON: 'OFF' } } },
        }],
      },
    };
    const interp = new Interpreter(compileBlocklyJSON(json), OPTS());
    const control = defaultControl();
    control.engineOn = true;
    interp.tick(control, tel(1000, 0), []);
    expect(control.engineOn).toBe(true);
    interp.tick(control, tel(6000, 1), []);
    expect(control.engineOn).toBe(false);
    // once-only: engine back on, crossing again does nothing
    control.engineOn = true;
    interp.tick(control, tel(7000, 2), []);
    interp.tick(control, tel(6000, 3), []);
    expect(control.engineOn).toBe(true);
  });

  it('division by zero → runtime error', () => {
    const json = program(chain({
      type: 'rs_throttle', id: 'th',
      inputs: { NUM: { block: { type: 'math_arithmetic', fields: { OP: 'DIVIDE' }, inputs: { A: { shadow: num(1) }, B: { shadow: num(0) } } } } },
    }));
    const interp = new Interpreter(compileBlocklyJSON(json), OPTS());
    const ev: InterpEvent[] = [];
    interp.tick(defaultControl(), tel(0, 0), ev);
    expect(ev.some((e) => e.type === 'error' && e.key === 'warn.div_zero')).toBe(true);
  });
});

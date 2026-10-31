/**
 * RocketScript step interpreter — pure TS, deterministic (CORE_SPEC §6).
 * Each sim tick, every thread runs until it yields or burns 200 ops.
 */
import type { ASTNode, CompileResult } from './compile';
import { numField } from './compile';
import type { RocketControl, Telemetry } from '../physics/sim';

const OPS_PER_TICK = 200;
const LOOP_GUARD_TICKS = 300;

/** thrown when an expression eval blows the per-tick op budget */
class BudgetExceeded extends Error {}

export type Value = number | boolean;

export interface InterpEvent {
  type: 'say' | 'warn' | 'error' | 'button' | 'engine_off';
  text?: string;
  key?: string;
  vars?: Record<string, string | number>;
  blockId?: string;
}

/** A single stack frame = a sequence + an index. Loop state lives in the
 *  thread's loopState map keyed by blockId, so frames stay clean. */
interface Frame {
  seq: ASTNode[];
  i: number;
}

interface Thread {
  hat: ASTNode;
  frames: Frame[];
  waitUntil?: number;        // sim-time wakeup
  sleeping: boolean;
  done: boolean;
  /** consecutive ticks where the thread burned the whole budget — loop guard */
  stuckTicks: number;
  /** repeat/while counters keyed by blockId */
  loopState: Map<string, number>;
}

export interface InterpOptions {
  hasAltSensor: boolean;
  hasSpeedSensor: boolean;
  hasParachute: boolean;
  hasControl: boolean;
  /** sim runs even without control? (debug) */
  debug?: boolean;
}

export class Interpreter {
  private hats: ASTNode[];
  private threads: Thread[] = [];
  private triggeredHats = new Set<string>();
  private ops = 0;
  private opts: InterpOptions;
  private vars = new Map<string, Value>();
  /** named buttons registered by rs_when_button hats */
  readonly buttons: { name: string; hatId: string }[] = [];

  constructor(compiled: CompileResult, opts: InterpOptions) {
    this.hats = compiled.hats;
    this.opts = opts;
    for (const hat of this.hats) {
      if (hat.type === 'rs_when_button') {
        const name = String(hat.fields?.TEXT ?? '?');
        this.buttons.push({ name, hatId: hat.blockId });
      }
    }
  }

  variables(): Map<string, Value> {
    return this.vars;
  }

  /** called by the UI when an on-screen button is clicked */
  pressButton(name: string): void {
    for (const hat of this.hats) {
      if (hat.type === 'rs_when_button' && String(hat.fields?.TEXT ?? '?') === name) {
        this.spawn(hat);
      }
    }
  }

  private spawn(hat: ASTNode): void {
    // a hat already running is ignored
    if (this.threads.some((th) => th.hat.blockId === hat.blockId && !th.done)) return;
    this.threads.push({
      hat, frames: [{ seq: hatBody(hat), i: 0 }], sleeping: false, done: false,
      stuckTicks: 0, loopState: new Map(),
    });
  }

  /** one sim tick at sim-time t (seconds). Mutates control; returns UI events. */
  tick(control: RocketControl, tel: Telemetry, events: InterpEvent[]): void {
    if (!this.opts.hasControl && !this.opts.debug) {
      // no flight computer → the program does nothing at all
      return;
    }

    // fire event hats
    for (const hat of this.hats) {
      switch (hat.type) {
        case 'rs_when_launched':
          if (tel.launched || tel.time > 0) this.fireOnce(hat);
          break;
        case 'rs_when_altitude_above': {
          const n = numField(hat.fields?.NUM, 0);
          if (tel.altitude > n) this.fireOnce(hat);
          break;
        }
        case 'rs_when_fuel_empty':
          if (tel.stageFuel <= 0 && tel.stageFuelMax > 0) this.fireOnce(hat);
          break;
        case 'rs_when_button': break; // fired via pressButton
      }
    }

    // run threads
    this.ops = 0;
    for (const th of this.threads) {
      if (th.done) continue;
      // sleeping (rs_wait)
      if (th.waitUntil !== undefined) {
        if (tel.time < th.waitUntil) continue;
        th.waitUntil = undefined;
        th.sleeping = false;
      }
      const startOps = this.ops;
      const yielded = this.runThread(th, control, tel, events);
      if (!yielded) {
        // thread ran the whole budget without yielding
        th.stuckTicks++;
        if (th.stuckTicks > LOOP_GUARD_TICKS) {
          events.push({ type: 'error', key: 'warn.infinite_loop', blockId: th.hat.blockId });
          th.done = true;
        }
      } else {
        th.stuckTicks = 0;
      }
      void startOps;
      if (this.ops >= OPS_PER_TICK) break; // shared budget exhausted
    }
    // prune finished
    this.threads = this.threads.filter((th) => !th.done);
  }

  private fireOnce(hat: ASTNode): void {
    if (this.triggeredHats.has(hat.blockId)) return;
    this.triggeredHats.add(hat.blockId);
    this.spawn(hat);
  }

  /** run a thread until it yields/dies or the op budget is gone. Returns true if it yielded (not stuck). */
  private runThread(th: Thread, control: RocketControl, tel: Telemetry, events: InterpEvent[]): boolean {
    try {
      while (this.ops < OPS_PER_TICK) {
        const frame = th.frames[th.frames.length - 1];
        if (!frame) { th.done = true; return true; }
        if (frame.i >= frame.seq.length) {
          th.frames.pop();
          if (th.frames.length === 0) { th.done = true; return true; }
          continue;
        }
        const node = frame.seq[frame.i];
        const res = this.execBlock(th, node, control, tel, events);
        this.ops++;
        if (res === 'yield') return true;
        if (res === 'sleep') return true;
        if (res === 'err') { th.done = true; return true; }
        if (res === 'next') frame.i++;
        // 'stay' = loop pushed a body frame; keep running
      }
    } catch (e) {
      if (e instanceof BudgetExceeded) return false;
      throw e;
    }
    return this.ops < OPS_PER_TICK;
  }

  /** returns 'next' | 'stay' | 'yield' | 'sleep' | 'err' */
  private execBlock(th: Thread, node: ASTNode, control: RocketControl, tel: Telemetry, events: InterpEvent[]): string {
    if (node.kind !== 'block') return 'next';
    switch (node.type) {
      case 'rs_engine': {
        const on = node.fields?.ON !== 'OFF';
        control.engineOn = on;
        if (!on) events.push({ type: 'engine_off' });
        return 'next';
      }
      case 'rs_throttle': {
        const v = this.evalNum(node.inputs?.NUM, tel, events);
        if (v === null) return 'err';
        control.throttle = Math.max(0, Math.min(100, v)) / 100;
        return 'next';
      }
      case 'rs_point': {
        const v = this.evalNum(node.inputs?.NUM, tel, events);
        if (v === null) return 'err';
        control.targetAngle = v * Math.PI / 180;
        return 'next';
      }
      case 'rs_stage':
        control.stageRequest = true;
        return 'next';
      case 'rs_parachute':
        if (!this.opts.hasParachute) {
          events.push({ type: 'warn', key: 'warn.no_parachute', blockId: node.blockId });
        } else {
          control.parachute = true;
        }
        return 'next';
      case 'rs_say': {
        const sub = node.inputs?.TEXT;
        const v = sub ? this.evalExpr(sub, tel, events) : '';
        events.push({ type: 'say', text: String(v ?? ''), blockId: node.blockId });
        return 'next';
      }
      case 'rs_wait': {
        const v = this.evalNum(node.inputs?.NUM, tel, events);
        if (v === null) return 'err';
        th.waitUntil = tel.time + Math.max(0, v);
        th.frames[th.frames.length - 1].i++; // advance past the wait before sleeping
        return 'sleep';
      }
      case 'rs_wait_until': {
        const c = this.evalBool(node.inputs?.COND, tel, events);
        if (c === null) return 'err';
        if (c) return 'next';
        return 'yield'; // re-check next tick
      }
      case 'controls_if':
        return this.execIf(th, node, tel, events);
      case 'controls_repeat_ext':
        return this.execRepeat(th, node, tel, events);
      case 'controls_whileUntil':
        return this.execWhile(th, node, tel, events);
      case 'rs_forever':
        return this.execForever(th, node, tel, events);
      case 'variables_set': {
        const name = String(node.fields?.VAR ?? 'x');
        const sub = node.inputs?.VALUE;
        const v = sub ? this.evalExpr(sub, tel, events) : 0;
        if (v === null) return 'err';
        this.vars.set(name, v);
        return 'next';
      }
      case 'math_change': {
        const name = String(node.fields?.VAR ?? 'x');
        const cur = this.vars.get(name) ?? 0;
        const delta = this.evalNum(node.inputs?.DELTA, tel, events);
        if (delta === null) return 'err';
        this.vars.set(name, (typeof cur === 'number' ? cur : 0) + delta);
        return 'next';
      }
      default:
        // unknown statement — skip
        return 'next';
    }
  }

  // ----- control-flow helpers -----

  private pushBody(th: Thread, node: ASTNode, inputName: string): boolean {
    const seqNode = node.inputs?.[inputName];
    if (seqNode && seqNode.kind === 'seq') {
      th.frames.push({ seq: seqNode.items, i: 0 });
      return true;
    }
    return false;
  }

  private execIf(th: Thread, node: ASTNode, tel: Telemetry, events: InterpEvent[]): string {
    // IF0/DO0, IF1/DO1 … ELSE
    for (let k = 0; k < 5; k++) {
      const condInput = `IF${k}`;
      const doInput = `DO${k}`;
      if (!(condInput in node.inputs) && !(doInput in node.inputs)) break;
      if (condInput in node.inputs) {
        const c = this.evalBool(node.inputs[condInput], tel, events);
        if (c === null) return 'err';
        if (c) {
          this.pushBody(th, node, doInput);
          return 'stay';
        }
        continue;
      }
    }
    if ('ELSE' in node.inputs) {
      this.pushBody(th, node, 'ELSE');
      return 'stay';
    }
    return 'next';
  }

  private execRepeat(th: Thread, node: ASTNode, tel: Telemetry, events: InterpEvent[]): string {
    const key = `rep:${node.blockId}`;
    let left = th.loopState.get(key);
    if (left === undefined) {
      const times = this.evalNum(node.inputs?.TIMES, tel, events);
      if (times === null) return 'err';
      left = Math.floor(times);
    }
    if (left <= 0) {
      th.loopState.delete(key);
      return 'next';
    }
    th.loopState.set(key, left - 1);
    this.pushBody(th, node, 'DO');
    return 'yield'; // yield each iteration so the loop guard can watch
  }

  private execWhile(th: Thread, node: ASTNode, tel: Telemetry, events: InterpEvent[]): string {
    const mode = String(node.fields?.MODE ?? 'WHILE');
    const c = this.evalBool(node.inputs?.BOOL, tel, events);
    if (c === null) return 'err';
    const go = mode === 'UNTIL' ? !c : c;
    if (!go) return 'next';
    this.pushBody(th, node, 'DO');
    return 'yield';
  }

  private execForever(th: Thread, node: ASTNode, tel: Telemetry, events: InterpEvent[]): string {
    void tel;
    const seq = node.inputs?.DO;
    if (!seq || seq.kind !== 'seq' || seq.items.length === 0) {
      // empty forever-loop spins forever doing nothing — flag it
      events.push({ type: 'error', key: 'warn.infinite_loop', blockId: node.blockId });
      return 'err';
    }
    this.pushBody(th, node, 'DO');
    return 'yield';
  }

  // ----- expression evaluation -----

  private evalExpr(node: ASTNode | null | undefined, tel: Telemetry, events: InterpEvent[]): Value | null {
    if (!node) return null;
    if (node.kind !== 'expr' && node.kind !== 'block') return null;
    if (++this.ops > OPS_PER_TICK) throw new BudgetExceeded();
    switch (node.type) {
      case 'math_number':
        return numField(node.fields?.NUM, 0);
      case 'text': {
        const s = node.fields?.TEXT;
        const n = parseFloat(String(s));
        return Number.isFinite(n) ? n : 0;
      }
      case 'logic_boolean':
        return node.fields?.BOOL === 'TRUE';
      case 'variables_get':
        return this.vars.get(String(node.fields?.VAR ?? 'x')) ?? 0;
      case 'math_arithmetic': {
        const a = this.evalNum(node.inputs?.A, tel, events);
        const b = this.evalNum(node.inputs?.B, tel, events);
        if (a === null || b === null) return null;
        switch (node.fields?.OP) {
          case 'ADD': return a + b;
          case 'MINUS': return a - b;
          case 'MULTIPLY': return a * b;
          case 'DIVIDE':
            if (b === 0) {
              events.push({ type: 'error', key: 'warn.div_zero', blockId: node.blockId });
              return null;
            }
            return a / b;
          case 'POWER': return Math.pow(a, b);
          default: return a + b;
        }
      }
      case 'math_change_reporter': return 0;
      case 'logic_compare': {
        const a = this.evalExpr(node.inputs?.A, tel, events);
        const b = this.evalExpr(node.inputs?.B, tel, events);
        if (a === null || b === null) return null;
        switch (node.fields?.OP) {
          case 'EQ': return a === b;
          case 'NEQ': return a !== b;
          case 'LT': return a < b;
          case 'LTE': return a <= b;
          case 'GT': return a > b;
          case 'GTE': return a >= b;
          default: return false;
        }
      }
      case 'logic_operation': {
        const a = this.evalBool(node.inputs?.A, tel, events);
        const b = this.evalBool(node.inputs?.B, tel, events);
        if (a === null || b === null) return null;
        return node.fields?.OP === 'OR' ? a || b : a && b;
      }
      case 'logic_negate': {
        const a = this.evalBool(node.inputs?.BOOL, tel, events);
        return a === null ? null : !a;
      }
      case 'rs_get':
        return this.sensor(String(node.fields?.PROP ?? 'altitude'), tel, events, node.blockId);
      default:
        return 0;
    }
  }

  private evalNum(node: ASTNode | null | undefined, tel: Telemetry, events: InterpEvent[]): number | null {
    const v = this.evalExpr(node, tel, events);
    if (v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  }

  private evalBool(node: ASTNode | null | undefined, tel: Telemetry, events: InterpEvent[]): boolean | null {
    const v = this.evalExpr(node, tel, events);
    if (v === null) return null;
    if (typeof v === 'boolean') return v;
    return v !== 0;
  }

  private sensor(prop: string, tel: Telemetry, events: InterpEvent[], blockId: string): number {
    switch (prop) {
      case 'altitude':
        if (!this.opts.hasAltSensor) {
          events.push({ type: 'warn', key: 'warn.no_sensor_alt', blockId });
          return 0;
        }
        return tel.altitude;
      case 'speed':
      case 'vertical_speed':
        if (!this.opts.hasSpeedSensor) {
          events.push({ type: 'warn', key: 'warn.no_sensor_speed', blockId });
          return 0;
        }
        return prop === 'speed' ? tel.speed : tel.vspeed;
      case 'fuel_percent': return tel.fuelPercent * 100;
      case 'apoapsis': return tel.apoapsis;
      case 'time': return tel.time;
      case 'angle': return tel.angle;
      default: return 0;
    }
  }

  get alive(): boolean {
    return this.threads.length > 0;
  }
}

function hatBody(hat: ASTNode): ASTNode[] {
  return hat.kind === 'hat' ? hat.body : [];
}

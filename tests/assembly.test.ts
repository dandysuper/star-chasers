import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendToSide, assemblyCount, assemblyFromDesign, assemblyFromIds, columnAt, emptyAssembly,
  flatten, fromSlots, insertAtBottom, insertAtTop, makeNode, removeNode, resetUids, toSlots,
} from '../src/data/assembly';
import { computeAssemblyStats, computeStats } from '../src/physics/rocket';

const isNose = (id: string) => id === 'nose_cone';
const isEngine = (id: string) => id.startsWith('engine');

beforeEach(() => resetUids());

describe('stack insertion never dead-ends', () => {
  it('puts a part dropped at the top below an existing fairing', () => {
    const asm = assemblyFromIds(['nose_cone', 'tank_m', 'engine_spark']);
    insertAtTop(asm, makeNode('parachute'), isNose);
    expect(asm.spine.map((n) => n.id)).toEqual(['nose_cone', 'parachute', 'tank_m', 'engine_spark']);
  });

  it('puts a fairing at the very top when there is none', () => {
    const asm = assemblyFromIds(['tank_m', 'engine_spark']);
    insertAtTop(asm, makeNode('nose_cone'), isNose);
    expect(asm.spine.map((n) => n.id)).toEqual(['nose_cone', 'tank_m', 'engine_spark']);
  });

  it('puts a part dropped at the bottom above a trailing engine', () => {
    const asm = assemblyFromIds(['nose_cone', 'tank_m', 'engine_spark']);
    insertAtBottom(asm, makeNode('tank_s'), isEngine);
    // the engine must stay the lowest thing in the stack
    expect(asm.spine.map((n) => n.id)).toEqual(['nose_cone', 'tank_m', 'tank_s', 'engine_spark']);
  });

  it('still appends below a tank', () => {
    const asm = assemblyFromIds(['tank_m']);
    insertAtBottom(asm, makeNode('engine_spark'), isEngine);
    expect(asm.spine.map((n) => n.id)).toEqual(['tank_m', 'engine_spark']);
  });
});

describe('booster columns', () => {
  it('keeps one column per side of a host', () => {
    const asm = assemblyFromIds(['tank_m', 'engine_spark']);
    const hostUid = asm.spine[0].uid;
    appendToSide(asm, hostUid, 'left', makeNode('tank_s'));
    appendToSide(asm, hostUid, 'left', makeNode('engine_bull'));
    appendToSide(asm, hostUid, 'right', makeNode('tank_s'));

    expect(columnAt(asm, hostUid, 'left')?.nodes.map((n) => n.id)).toEqual(['tank_s', 'engine_bull']);
    expect(columnAt(asm, hostUid, 'right')?.nodes.map((n) => n.id)).toEqual(['tank_s']);
    expect(assemblyCount(asm)).toBe(5);
  });

  it('removes a spine part together with its boosters', () => {
    const asm = assemblyFromIds(['nose_cone', 'tank_m', 'engine_spark']);
    const hostUid = asm.spine[1].uid;
    appendToSide(asm, hostUid, 'left', makeNode('tank_s'));
    removeNode(asm, hostUid);
    expect(asm.spine.map((n) => n.id)).toEqual(['nose_cone', 'engine_spark']);
    expect(asm.sides).toHaveLength(0);
  });

  it('flattens a booster right after its host, on its own column', () => {
    const asm = assemblyFromIds(['tank_m', 'engine_spark']);
    appendToSide(asm, asm.spine[0].uid, 'left', makeNode('tank_s'));
    const flat = flatten(asm);
    expect(flat.ids).toEqual(['tank_m', 'tank_s', 'engine_spark']);
    expect(flat.columns[0]).toBe(0);
    expect(flat.columns[1]).not.toBe(0);
    expect(flat.columns[2]).toBe(0);
  });
});

describe('saving the layout', () => {
  it('round-trips a three-column rocket through the save format', () => {
    const asm = assemblyFromIds(['nose_cone', 'tank_m', 'engine_spark']);
    const host = asm.spine[1].uid;
    appendToSide(asm, host, 'left', makeNode('tank_s'));
    appendToSide(asm, host, 'left', makeNode('engine_bull'));
    appendToSide(asm, host, 'right', makeNode('tank_m'));

    const slots = toSlots(asm);
    const back = fromSlots(slots);
    expect(back.spine.map((n) => n.id)).toEqual(['nose_cone', 'tank_m', 'engine_spark']);
    expect(columnAt(back, back.spine[1].uid, 'left')?.nodes.map((n) => n.id)).toEqual(['tank_s', 'engine_bull']);
    expect(columnAt(back, back.spine[1].uid, 'right')?.nodes.map((n) => n.id)).toEqual(['tank_m']);
  });

  it('opens an old save with no layout as a plain stack', () => {
    const asm = assemblyFromDesign({ parts: ['nose_cone', 'tank_m', 'engine_spark'] });
    expect(asm.spine.map((n) => n.id)).toEqual(['nose_cone', 'tank_m', 'engine_spark']);
    expect(asm.sides).toHaveLength(0);
  });

  it('drops a booster whose host index does not exist instead of throwing', () => {
    const asm = fromSlots([
      { id: 'tank_m' },
      { id: 'tank_s', side: 'left', host: 7 },
    ]);
    expect(asm.spine.map((n) => n.id)).toEqual(['tank_m']);
    expect(asm.sides).toHaveLength(0);
  });

  it('starting empty is empty', () => {
    expect(assemblyCount(emptyAssembly())).toBe(0);
  });
});

describe('physics of a side booster', () => {
  it('accepts an engine at the bottom of its own column', () => {
    const asm = assemblyFromIds(['nose_cone', 'probe_core', 'tank_m', 'engine_spark']);
    const host = asm.spine[2].uid;
    appendToSide(asm, host, 'left', makeNode('tank_s'));
    appendToSide(asm, host, 'left', makeNode('engine_bull'));

    const stats = computeAssemblyStats(asm);
    expect(stats.warnings.some((w) => w.key === 'warn.engine_bottom')).toBe(false);
    expect(stats.blocking).toBe(false);
    // the booster's fuel and thrust are part of the rocket
    const plain = computeStats(['nose_cone', 'probe_core', 'tank_m', 'engine_spark']);
    expect(stats.mass).toBeGreaterThan(plain.mass);
    expect(stats.stages[0].thrustVac).toBeGreaterThan(60000);
  });

  it('still rejects an engine buried inside its column', () => {
    const asm = assemblyFromIds(['tank_m', 'engine_spark']);
    const host = asm.spine[0].uid;
    appendToSide(asm, host, 'left', makeNode('engine_bull'));
    appendToSide(asm, host, 'left', makeNode('tank_s'));

    const stats = computeAssemblyStats(asm);
    expect(stats.warnings.some((w) => w.key === 'warn.engine_bottom')).toBe(true);
  });

  it('a plain stack keeps the original stage-group rule', () => {
    // an engine in the middle of a single stage is still wrong
    const stats = computeStats(['tank_m', 'engine_spark', 'tank_s']);
    expect(stats.warnings.some((w) => w.key === 'warn.engine_bottom')).toBe(true);
  });
});

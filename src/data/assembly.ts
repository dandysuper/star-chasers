/**
 * assembly.ts — how a rocket is physically put together.
 *
 * A design is not one column any more. The core stack (the *spine*) can carry a
 * booster column bolted to its left and another to its right, so up to three
 * columns standing abreast is a legal rocket — a centre stage flanked by two
 * strap-on boosters.
 *
 * Everything here is pure and free of Phaser: the builder renders from it, the
 * flight scene draws from it, and the physics flattens it back into a top-to-
 * bottom list so staging keeps working exactly as before.
 */

export type Side = 'left' | 'right';

/** A placed part. `uid` is stable for the life of one editing session, so
 *  selection and deletion can name a part without depending on its position. */
export interface Node {
  uid: number;
  id: string;
}

/** A booster column: a little stack of its own, hung off one spine part. */
export interface SideColumn {
  /** uid of the spine part this column is bolted to. */
  hostUid: number;
  side: Side;
  /** top → bottom within the column. */
  nodes: Node[];
}

export interface Assembly {
  /** top → bottom. */
  spine: Node[];
  sides: SideColumn[];
}

/** Persisted shape. `host` is the index into the spine, not a uid, because uids
 *  are a session detail and must not leak into the save file. */
export interface DesignSlot {
  id: string;
  side?: Side;
  host?: number;
}

let nextUid = 1;

export function makeNode(id: string): Node {
  return { uid: nextUid++, id };
}

/** Reset the uid counter. Test-only, so a suite can assert on exact uids. */
export function resetUids(): void {
  nextUid = 1;
}

export function emptyAssembly(): Assembly {
  return { spine: [], sides: [] };
}

/** Build an assembly from a plain top-to-bottom list — the shape every older
 *  save file and every preset is written in. */
export function assemblyFromIds(ids: string[]): Assembly {
  const asm: Assembly = { spine: ids.map(makeNode), sides: [] };
  return asm;
}

export function assemblyCount(asm: Assembly): number {
  return asm.spine.length + asm.sides.reduce((n, c) => n + c.nodes.length, 0);
}

export function isEmpty(asm: Assembly): boolean {
  return assemblyCount(asm) === 0;
}

export function spineIndexOf(asm: Assembly, uid: number): number {
  return asm.spine.findIndex((n) => n.uid === uid);
}

export function columnAt(asm: Assembly, hostUid: number, side: Side): SideColumn | undefined {
  return asm.sides.find((c) => c.hostUid === hostUid && c.side === side);
}

/** Every uid in the assembly, spine first then columns. */
export function allNodes(asm: Assembly): Node[] {
  const out: Node[] = [...asm.spine];
  for (const col of asm.sides) out.push(...col.nodes);
  return out;
}

export function findNode(asm: Assembly, uid: number): Node | undefined {
  return allNodes(asm).find((n) => n.uid === uid);
}

/** Where a node sits: on the spine, or in a nameable booster column. */
export function locate(
  asm: Assembly, uid: number,
): { kind: 'spine'; index: number } | { kind: 'side'; column: SideColumn; index: number } | null {
  const index = spineIndexOf(asm, uid);
  if (index >= 0) return { kind: 'spine', index };
  for (const column of asm.sides) {
    const i = column.nodes.findIndex((n) => n.uid === uid);
    if (i >= 0) return { kind: 'side', column, index: i };
  }
  return null;
}

/** Insert a part at the top of the spine, below any nose already sitting there. */
export function insertAtTop(asm: Assembly, node: Node, isNose: (id: string) => boolean): void {
  const tipIsNose = asm.spine.length > 0 && isNose(asm.spine[0].id);
  asm.spine.splice(tipIsNose ? 1 : 0, 0, node);
}

/**
 * Insert at the bottom, but never underneath a trailing engine — an engine that
 * is not lowest in its column would be buried, so the insertion goes just above
 * it instead. This is what keeps "add a tank, then add an engine" working from
 * the bottom zone without a dead end.
 */
export function insertAtBottom(
  asm: Assembly, node: Node, isEngine: (id: string) => boolean,
): void {
  let at = asm.spine.length;
  while (at > 0 && isEngine(asm.spine[at - 1].id)) at -= 1;
  asm.spine.splice(at, 0, node);
}

/** Append to a booster column, creating the column on first use. */
export function appendToSide(asm: Assembly, hostUid: number, side: Side, node: Node): void {
  const existing = columnAt(asm, hostUid, side);
  if (existing) existing.nodes.push(node);
  else asm.sides.push({ hostUid, side, nodes: [node] });
}

/** Remove a part. Removing a spine part takes its booster columns with it. */
export function removeNode(asm: Assembly, uid: number): boolean {
  const index = spineIndexOf(asm, uid);
  if (index >= 0) {
    asm.spine.splice(index, 1);
    asm.sides = asm.sides.filter((c) => c.hostUid !== uid);
    return true;
  }
  for (let i = 0; i < asm.sides.length; i += 1) {
    const column = asm.sides[i];
    const at = column.nodes.findIndex((n) => n.uid === uid);
    if (at >= 0) {
      column.nodes.splice(at, 1);
      if (column.nodes.length === 0) asm.sides.splice(i, 1);
      return true;
    }
  }
  return false;
}

export interface FlatDesign {
  /** top → bottom, one entry per part. */
  ids: string[];
  /**
   * Column id per entry. Every spine part is column 0; each booster column gets
   * its own number. The physics uses this to check that an engine is the lowest
   * part *of its own column* rather than of the whole stack.
   */
  columns: number[];
  /** Node uid per entry, so a renderer can map a flat index (and so a stage)
   *  back to the part it drew. */
  uids: number[];
}

/**
 * Flatten to a single top-to-bottom list for the stage maths.
 *
 * A booster column is emitted immediately after the spine part it hangs off, so
 * the fuel and engines of a strap-on stage land in the same stage group as its
 * host — which is exactly how a real side booster behaves.
 */
export function flatten(asm: Assembly): FlatDesign {
  const ids: string[] = [];
  const columns: number[] = [];
  const uids: number[] = [];
  for (const node of asm.spine) {
    ids.push(node.id);
    columns.push(0);
    uids.push(node.uid);
    for (const col of asm.sides) {
      if (col.hostUid !== node.uid) continue;
      const columnId = 1 + asm.sides.indexOf(col);
      for (const child of col.nodes) {
        ids.push(child.id);
        columns.push(columnId);
        uids.push(child.uid);
      }
    }
  }
  return { ids, columns, uids };
}

/** Flat spine ids only — used where a plain stack is genuinely wanted. */
export function spineIds(asm: Assembly): string[] {
  return asm.spine.map((n) => n.id);
}

/** Rebuild the assembly behind a saved design, falling back to a plain stack
 *  for designs written before the builder could build sideways. */
export function assemblyFromDesign(design: { parts: string[]; slots?: DesignSlot[] }): Assembly {
  return design.slots?.length ? fromSlots(design.slots) : assemblyFromIds(design.parts);
}

/** Serialise for the save file. */
export function toSlots(asm: Assembly): DesignSlot[] {
  const slots: DesignSlot[] = asm.spine.map((n) => ({ id: n.id }));
  for (const col of asm.sides) {
    const host = spineIndexOf(asm, col.hostUid);
    if (host < 0) continue;
    for (const node of col.nodes) slots.push({ id: node.id, side: col.side, host });
  }
  return slots;
}

/** Rebuild from a save file. Bad host indices are dropped rather than thrown,
 *  so one corrupt entry cannot make a saved rocket unopenable. */
export function fromSlots(slots: DesignSlot[]): Assembly {
  const asm: Assembly = { spine: [], sides: [] };
  const hostUids: number[] = [];
  for (const slot of slots) {
    if (slot.side && typeof slot.host === 'number') continue;
    const node = makeNode(slot.id);
    asm.spine.push(node);
    hostUids.push(node.uid);
  }
  for (const slot of slots) {
    if (!slot.side || typeof slot.host !== 'number') continue;
    const hostUid = hostUids[slot.host];
    if (hostUid === undefined) continue;
    appendToSide(asm, hostUid, slot.side, makeNode(slot.id));
  }
  return asm;
}

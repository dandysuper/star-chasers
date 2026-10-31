/**
 * Blockly serialization JSON → AST. Pure TS (CORE_SPEC §6).
 * No eval: we walk the saved JSON and build our own node tree.
 */

export type ASTNode =
  | { kind: 'hat'; type: string; fields: Record<string, unknown>; inputs: Record<string, ASTNode | null>; body: ASTNode[]; blockId: string }
  | { kind: 'block'; type: string; fields: Record<string, unknown>; inputs: Record<string, ASTNode | null>; next: ASTNode[]; blockId: string }
  | { kind: 'expr'; type: string; fields: Record<string, unknown>; inputs: Record<string, ASTNode | null>; blockId: string }
  | { kind: 'seq'; type: '__seq__'; fields: Record<string, unknown>; inputs: Record<string, ASTNode | null>; items: ASTNode[]; blockId: string };

export interface CompileResult {
  hats: ASTNode[];
  warnings: { key: string; vars?: Record<string, string | number> }[];
  /** block ids that failed to compile (empty required inputs) */
  errors: string[];
  blockCount: number;
}

interface RawBlock {
  type: string;
  id?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: RawBlock; shadow?: RawBlock }>;
  next?: { block?: RawBlock };
  extraState?: unknown;
}

/** Event hats = thread roots. */
export const HAT_TYPES = new Set([
  'rs_when_launched', 'rs_when_button', 'rs_when_altitude_above', 'rs_when_fuel_empty',
]);

/** Statement inputs that hold a nested body (sequence). */
const BODY_INPUTS: Record<string, string[]> = {
  controls_if: ['DO0', 'DO1', 'DO2', 'DO3', 'DO4', 'ELSE'],
  controls_repeat_ext: ['DO'],
  controls_whileUntil: ['DO'],
  rs_forever: ['DO'],
};

export function numField(v: unknown, def = 0): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : def;
}

function isRequiredInput(type: string, name: string): boolean {
  switch (type) {
    case 'rs_wait': return name === 'NUM';
    case 'rs_wait_until': return name === 'COND';
    case 'rs_throttle': return name === 'NUM';
    case 'rs_point': return name === 'NUM';
    case 'controls_repeat_ext': return name === 'TIMES';
    case 'controls_whileUntil': return name === 'BOOL';
    case 'controls_if': return name === 'IF0';
    case 'math_arithmetic': case 'logic_compare': case 'logic_operation':
      return name === 'A' || name === 'B';
    case 'logic_negate': return name === 'BOOL';
    default: return false;
  }
}

interface Ctx {
  errors: string[];
  counter: { n: number };
}

function compileSeq(raw: RawBlock | undefined, out: ASTNode[], ctx: Ctx): void {
  let cur = raw;
  while (cur) {
    ctx.counter.n++;
    const blockId = cur.id ?? `b${ctx.counter.n}`;
    const inputs: Record<string, ASTNode | null> = {};

    // value inputs → expressions; body inputs → sequences
    for (const [name, conn] of Object.entries(cur.inputs ?? {})) {
      if (BODY_INPUTS[cur.type]?.includes(name)) {
        const body: ASTNode[] = [];
        if (conn.block) compileSeq(conn.block, body, ctx);
        inputs[name] = { kind: 'seq', type: '__seq__', fields: {}, inputs: {}, items: body, blockId: `${blockId}:${name}` };
      } else {
        const sub = conn.block ?? conn.shadow;
        if (sub) {
          inputs[name] = compileExpr(sub, ctx);
        } else {
          if (isRequiredInput(cur.type, name)) ctx.errors.push(blockId);
          inputs[name] = null;
        }
      }
    }
    // flag missing required inputs that aren't even present
    for (const name of requiredInputsOf(cur.type)) {
      if (!(name in inputs)) {
        ctx.errors.push(blockId);
        inputs[name] = null;
      }
    }

    const node: ASTNode = {
      kind: 'block', type: cur.type, fields: cur.fields ?? {},
      inputs, next: [], blockId,
    };
    out.push(node);
    cur = cur.next?.block;
  }
}

function requiredInputsOf(type: string): string[] {
  switch (type) {
    case 'rs_wait': case 'rs_throttle': case 'rs_point': case 'controls_repeat_ext':
      return [type === 'controls_repeat_ext' ? 'TIMES' : 'NUM'];
    case 'rs_wait_until': return ['COND'];
    case 'controls_whileUntil': return ['BOOL'];
    case 'controls_if': return ['IF0'];
    case 'math_arithmetic': case 'logic_compare': case 'logic_operation':
      return ['A', 'B'];
    case 'logic_negate': return ['BOOL'];
    default: return [];
  }
}

function compileExpr(raw: RawBlock, ctx: Ctx): ASTNode {
  ctx.counter.n++;
  const blockId = raw.id ?? `b${ctx.counter.n}`;
  const inputs: Record<string, ASTNode | null> = {};
  for (const [name, conn] of Object.entries(raw.inputs ?? {})) {
    const sub = conn.block ?? conn.shadow;
    if (sub) {
      inputs[name] = compileExpr(sub, ctx);
    } else {
      if (isRequiredInput(raw.type, name)) ctx.errors.push(blockId);
      inputs[name] = null;
    }
  }
  for (const name of requiredInputsOf(raw.type)) {
    if (!(name in inputs)) {
      ctx.errors.push(blockId);
      inputs[name] = null;
    }
  }
  return { kind: 'expr', type: raw.type, fields: raw.fields ?? {}, inputs, blockId };
}

export function compileBlocklyJSON(json: unknown): CompileResult {
  const result: CompileResult = { hats: [], warnings: [], errors: [], blockCount: 0 };
  const ctx: Ctx = { errors: result.errors, counter: { n: 0 } };
  const ws = json as { blocks?: { blocks?: RawBlock[] } } | null;
  const topBlocks = ws?.blocks?.blocks ?? [];

  let looseCount = 0;
  for (const top of topBlocks) {
    if (HAT_TYPES.has(top.type)) {
      ctx.counter.n++;
      const blockId = top.id ?? `b${ctx.counter.n}`;
      const body: ASTNode[] = [];
      compileSeq(top.next?.block, body, ctx);
      result.hats.push({
        kind: 'hat', type: top.type, fields: top.fields ?? {},
        inputs: {}, body, blockId,
      });
    } else {
      let cur: RawBlock | undefined = top;
      while (cur) {
        looseCount++;
        ctx.counter.n++;
        cur = cur.next?.block;
      }
    }
  }

  if (looseCount > 0) result.warnings.push({ key: 'warn.loose_blocks' });
  if (result.errors.length > 0) result.warnings.push({ key: 'warn.empty_input' });
  result.blockCount = ctx.counter.n;
  return result;
}

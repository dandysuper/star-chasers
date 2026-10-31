/**
 * Blockly block definitions + toolbox for RocketScript (CORE_SPEC §5).
 * Labels come from our i18n dict, so re-mounting the workspace after a
 * language switch rebuilds the blocks with new text.
 */
import * as Blockly from 'blockly';
import { t } from '../core/i18n';
import { state } from '../core/state';

// custom theme colours (spec §5)
const C = {
  events: '#f2c138',
  control: '#ff9a3d',
  logic: '#7ac74f',
  math: '#5b9bd5',
  vars: '#e05a5a',
  rocket: '#9b6dd6',
  sensors: '#4ecdc4',
};

let lastLang: string | null = null;

/** (Re)define all custom blocks using the current language labels. */
export function defineRocketScriptBlocks(): void {
  if (lastLang === state.lang) return;
  lastLang = state.lang;

  const hat = (build: (b: Blockly.Block) => void): object => ({
    init(this: Blockly.Block) {
      build(this);
      this.setNextStatement(true);
      this.setStyle('rs_events');
    },
  });
  const stmt = (build: (b: Blockly.Block) => void, style = 'rs_control'): object => ({
    init(this: Blockly.Block) {
      build(this);
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setStyle(style);
    },
  });

  Blockly.Blocks['rs_when_launched'] = hat((b) =>
    b.appendDummyInput().appendField(t('block.when_launched')));
  Blockly.Blocks['rs_when_button'] = hat((b) =>
    b.appendDummyInput()
      .appendField(fieldParts(t('block.when_button'), 0))
      .appendField(new Blockly.FieldTextInput('GO'), 'TEXT')
      .appendField(fieldParts(t('block.when_button'), 1)));
  Blockly.Blocks['rs_when_altitude_above'] = hat((b) =>
    b.appendDummyInput()
      .appendField(fieldParts(t('block.when_altitude'), 0))
      .appendField(new Blockly.FieldNumber(10000, 0), 'NUM')
      .appendField(fieldParts(t('block.when_altitude'), 1)));
  Blockly.Blocks['rs_when_fuel_empty'] = hat((b) =>
    b.appendDummyInput().appendField(t('block.when_fuel_empty')));

  Blockly.Blocks['rs_wait'] = stmt((b) =>
    b.appendDummyInput()
      .appendField(fieldParts(t('block.wait'), 0))
      .appendField(new Blockly.FieldNumber(1, 0), 'NUM')
      .appendField(fieldParts(t('block.wait'), 1)));
  Blockly.Blocks['rs_wait_until'] = stmt((b) =>
    b.appendValueInput('COND').setCheck('Boolean')
      .appendField(fieldParts(t('block.wait_until'), 0)));
  Blockly.Blocks['rs_forever'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(t('block.forever'));
      this.appendStatementInput('DO');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setStyle('rs_control');
    },
  };

  Blockly.Blocks['rs_engine'] = stmt((b) =>
    b.appendDummyInput()
      .appendField(fieldParts(t('block.engine'), 0))
      .appendField(
        new Blockly.FieldDropdown(() => [
          [t('block.engine_on'), 'ON'],
          [t('block.engine_off'), 'OFF'],
        ]),
        'ON',
      ), 'rs_rocket');
  Blockly.Blocks['rs_throttle'] = stmt((b) =>
    b.appendValueInput('NUM').setCheck('Number')
      .appendField(fieldParts(t('block.throttle'), 0))
      .appendField(fieldParts(t('block.throttle'), 1)), 'rs_rocket');
  Blockly.Blocks['rs_point'] = stmt((b) =>
    b.appendValueInput('NUM').setCheck('Number')
      .appendField(fieldParts(t('block.point'), 0))
      .appendField(fieldParts(t('block.point'), 1)), 'rs_rocket');
  Blockly.Blocks['rs_stage'] = stmt((b) =>
    b.appendDummyInput().appendField(t('block.stage')), 'rs_rocket');
  Blockly.Blocks['rs_parachute'] = stmt((b) =>
    b.appendDummyInput().appendField(t('block.parachute')), 'rs_rocket');
  Blockly.Blocks['rs_say'] = stmt((b) =>
    b.appendValueInput('TEXT').appendField(t('block.say')), 'rs_rocket');

  Blockly.Blocks['rs_get'] = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField(
        new Blockly.FieldDropdown(() => [
          [t('block.get.altitude'), 'altitude'],
          [t('block.get.speed'), 'speed'],
          [t('block.get.vspeed'), 'vertical_speed'],
          [t('block.get.fuel_percent'), 'fuel_percent'],
          [t('block.get.apoapsis'), 'apoapsis'],
          [t('block.get.time'), 'time'],
          [t('block.get.angle'), 'angle'],
        ]),
        'PROP',
      );
      this.setOutput(true, 'Number');
      this.setStyle('rs_sensors');
    },
  };

  // localise the built-in blocks we ship in the toolbox
  const L = state.lang === 'ru' ? BUILTIN_RU : BUILTIN_EN;
  for (const [k, v] of Object.entries(L)) Blockly.Msg[k] = v;
}

/** split "text %1 text" into the field-adjacent pieces */
function fieldParts(s: string, part: 0 | 1): string {
  const bits = s.split('%1');
  return (bits[part] ?? '').trim();
}

const BUILTIN_RU: Record<string, string> = {
  CONTROLS_IF_MSG_IF: 'если', CONTROLS_IF_MSG_THEN: 'то',
  CONTROLS_IF_MSG_ELSE: 'иначе', CONTROLS_IF_MSG_ELSEIF: 'иначе если',
  CONTROLS_REPEAT_TITLE: 'повторить %1 раз',
  CONTROLS_WHILEUNTIL_OPERATOR_WHILE: 'повторять пока',
  CONTROLS_WHILEUNTIL_OPERATOR_UNTIL: 'повторять до',
  LOGIC_OPERATION_AND: 'и', LOGIC_OPERATION_OR: 'или',
  LOGIC_NEGATE_TITLE: 'не %1',
  LOGIC_BOOLEAN_TRUE: 'истина', LOGIC_BOOLEAN_FALSE: 'ложь',
  VARIABLES_SET: 'присвоить %1 = %2',
  MATH_CHANGE_TITLE: 'изменить %1 на %2',
  VARIABLES_GET: '%1',
};
const BUILTIN_EN: Record<string, string> = {
  CONTROLS_IF_MSG_IF: 'if', CONTROLS_IF_MSG_THEN: 'then',
  CONTROLS_IF_MSG_ELSE: 'else', CONTROLS_IF_MSG_ELSEIF: 'else if',
  CONTROLS_REPEAT_TITLE: 'repeat %1 times',
  CONTROLS_WHILEUNTIL_OPERATOR_WHILE: 'repeat while',
  CONTROLS_WHILEUNTIL_OPERATOR_UNTIL: 'repeat until',
  LOGIC_OPERATION_AND: 'and', LOGIC_OPERATION_OR: 'or',
  LOGIC_NEGATE_TITLE: 'not %1',
  LOGIC_BOOLEAN_TRUE: 'true', LOGIC_BOOLEAN_FALSE: 'false',
  VARIABLES_SET: 'set %1 to %2',
  MATH_CHANGE_TITLE: 'change %1 by %2',
  VARIABLES_GET: '%1',
};

export function rsTheme(): Blockly.Theme {
  return Blockly.Theme.defineTheme('rocketscript', {
    name: 'rocketscript',
    blockStyles: {
      rs_events: { colourPrimary: C.events, colourSecondary: '#d9a92f', colourTertiary: '#b98d1f' },
      rs_control: { colourPrimary: C.control, colourSecondary: '#e07f2a', colourTertiary: '#c96a1d' },
      rs_logic: { colourPrimary: C.logic, colourSecondary: '#63a84a', colourTertiary: '#4f8a3a' },
      rs_math: { colourPrimary: C.math, colourSecondary: '#4a87c0', colourTertiary: '#3a6fa3' },
      rs_vars: { colourPrimary: C.vars, colourSecondary: '#c44a4a', colourTertiary: '#a83b3b' },
      rs_rocket: { colourPrimary: C.rocket, colourSecondary: '#8658c0', colourTertiary: '#6f45a3' },
      rs_sensors: { colourPrimary: C.sensors, colourSecondary: '#3fb3aa', colourTertiary: '#2f978f' },
    },
    componentStyles: {
      workspaceBackgroundColour: '#12122b',
      toolboxBackgroundColour: '#1d1d3a',
      flyoutBackgroundColour: '#252549',
      flyoutOpacity: 0.95,
      scrollbarColour: '#5a5aa0',
    },
    fontStyle: { family: 'system-ui, sans-serif', weight: '600', size: 13 },
  });
}

export function toolboxJSON(): Blockly.utils.toolbox.ToolboxDefinition {
  return {
    kind: 'categoryToolbox',
    contents: [
      {
        kind: 'category', name: t('code.cat.events'), colour: C.events,
        contents: [
          { kind: 'block', type: 'rs_when_launched' },
          { kind: 'block', type: 'rs_when_button' },
          { kind: 'block', type: 'rs_when_altitude_above' },
          { kind: 'block', type: 'rs_when_fuel_empty' },
        ],
      },
      {
        kind: 'category', name: t('code.cat.rocket'), colour: C.rocket,
        contents: [
          { kind: 'block', type: 'rs_engine' },
          { kind: 'block', type: 'rs_throttle', inputs: { NUM: shadowNum(100) } },
          { kind: 'block', type: 'rs_point', inputs: { NUM: shadowNum(0) } },
          { kind: 'block', type: 'rs_stage' },
          { kind: 'block', type: 'rs_parachute' },
          { kind: 'block', type: 'rs_say', inputs: { TEXT: shadowText('hi!') } },
        ],
      },
      {
        kind: 'category', name: t('code.cat.sensors'), colour: C.sensors,
        contents: [{ kind: 'block', type: 'rs_get' }],
      },
      {
        kind: 'category', name: t('code.cat.control'), colour: C.control,
        contents: [
          { kind: 'block', type: 'rs_wait', inputs: { NUM: shadowNum(1) } },
          { kind: 'block', type: 'rs_wait_until' },
          { kind: 'block', type: 'controls_if' },
          { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: shadowNum(3) } },
          { kind: 'block', type: 'controls_whileUntil' },
          { kind: 'block', type: 'rs_forever' },
        ],
      },
      {
        kind: 'category', name: t('code.cat.logic'), colour: C.logic,
        contents: [
          { kind: 'block', type: 'logic_compare' },
          { kind: 'block', type: 'logic_operation' },
          { kind: 'block', type: 'logic_negate' },
          { kind: 'block', type: 'logic_boolean' },
        ],
      },
      {
        kind: 'category', name: t('code.cat.math'), colour: C.math,
        contents: [
          { kind: 'block', type: 'math_number' },
          { kind: 'block', type: 'math_arithmetic', inputs: { A: shadowNum(1), B: shadowNum(1) } },
          { kind: 'block', type: 'text' },
        ],
      },
      {
        kind: 'category', name: t('code.cat.vars'), colour: C.vars, custom: 'VARIABLE',
      },
    ],
  };
}

function shadowNum(n: number) {
  return { shadow: { type: 'math_number', fields: { NUM: n } } };
}
function shadowText(s: string) {
  return { shadow: { type: 'text', fields: { TEXT: s } } };
}

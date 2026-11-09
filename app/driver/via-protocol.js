/**
 * VIA keyboard protocol constants.
 *
 * Ported from the reference implementations:
 *   - the-via/app  -> src/utils/keyboard-api.ts
 *   - VIA spec      -> https://www.caniusevia.com/docs/specification
 *
 * The MQ80 firmware speaks raw HID on usage page 0xFF60 / usage 0x61.
 * Every command is sent as:  [reportId=0x00][command][...args]  (padded to the report size)
 * and the device echoes:     [command][...args][...data]
 */

/** HID Report ID used by VIA for every command packet. */
export const REPORT_ID = 0x00;

/** Default VIA raw-HID report size (bytes, excluding the report id). */
export const DEFAULT_REPORT_SIZE = 32;

/** Raw HID interface the firmware exposes. */
export const VIA_USAGE_PAGE = 0xff60;
export const VIA_USAGE = 0x61;

/** VIA command ids (keyboard-api.ts -> APICommand). */
export const CMD = {
  GET_PROTOCOL_VERSION: 0x01,
  GET_KEYBOARD_VALUE: 0x02,
  SET_KEYBOARD_VALUE: 0x03,
  DYNAMIC_KEYMAP_GET_KEYCODE: 0x04,
  DYNAMIC_KEYMAP_SET_KEYCODE: 0x05,
  CUSTOM_MENU_SET_VALUE: 0x07, // formerly BACKLIGHT_CONFIG_SET_VALUE
  CUSTOM_MENU_GET_VALUE: 0x08, // formerly BACKLIGHT_CONFIG_GET_VALUE
  CUSTOM_MENU_SAVE: 0x09, // formerly BACKLIGHT_CONFIG_SAVE
  EEPROM_RESET: 0x0a,
  BOOTLOADER_JUMP: 0x0b,
  DYNAMIC_KEYMAP_MACRO_GET_COUNT: 0x0c,
  DYNAMIC_KEYMAP_MACRO_GET_BUFFER_SIZE: 0x0d,
  DYNAMIC_KEYMAP_MACRO_GET_BUFFER: 0x0e,
  DYNAMIC_KEYMAP_MACRO_SET_BUFFER: 0x0f,
  DYNAMIC_KEYMAP_MACRO_RESET: 0x10,
  DYNAMIC_KEYMAP_GET_LAYER_COUNT: 0x11,
  DYNAMIC_KEYMAP_GET_BUFFER: 0x12,
  DYNAMIC_KEYMAP_SET_BUFFER: 0x13,
  DYNAMIC_KEYMAP_GET_ENCODER: 0x14,
  DYNAMIC_KEYMAP_SET_ENCODER: 0x15,
  UI_SYNC_REQUEST: 0x16,
};

export const CMD_NAME = Object.fromEntries(
  Object.entries(CMD).map(([k, v]) => [v, k]),
);

/** Protocol version thresholds. */
export const PROTOCOL = {
  ALPHA: 7,
  BETA: 8, // 16-bit keycodes + fast buffer read/write
  GAMMA: 9, // VIA v2 definitions
};

/**
 * Command id a QMK/VIA firmware returns whenever it does not implement the
 * requested custom value / channel. In stock QMK this is produced by the weak
 * `via_custom_value_command_kb()` hook, whose default body sets it.
 */
export const ID_UNHANDLED = 0xff;

/** get_keyboard_value sub-commands (keyboard-values.ts -> KeyboardValue). */
export const KEYBOARD_VALUE = {
  UPTIME: 0x01,
  LAYOUT_OPTIONS: 0x02,
  SWITCH_MATRIX_STATE: 0x03,
  FIRMWARE_VERSION: 0x04,
  DEVICE_INDICATION: 0x05,
  KEYCODES_VERSION: 0x06,
};

/** Largest payload the firmware accepts for a single buffer transfer. */
export const MAX_BUFFER_CHUNK = 28;

/** hue/sat defaults used by the built-in colour picker. */
export const COLOR_VALUE = 255;

export const shiftTo16Bit = (hi, lo) => ((hi & 0xff) << 8) | (lo & 0xff);
export const shiftFrom16Bit = (value) => [(value >> 8) & 0xff, value & 0xff];

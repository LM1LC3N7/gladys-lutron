// -----------------------------------------------------------------------------
// LEAP command bodies, pure (no I/O): what goes in the `Command` of a
// `CreateRequest /zone/{id}/commandprocessor`, after pylutron-caseta
// (Apache-2.0, see NOTICE).
// -----------------------------------------------------------------------------

import { KINDS } from './deviceTypes.js';

/** Longest fade accepted: 4 hours (a sunrise alarm). */
export const MAX_FADE_SECONDS = 4 * 3600;

/** The fan speeds of LEAP, slowest first, and their percentage in Gladys. */
export const FAN_SPEEDS = Object.freeze([
  ['Off', 0],
  ['Low', 25],
  ['Medium', 50],
  ['MediumHigh', 75],
  ['High', 100],
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * @param {number} value
 * @returns {number} an integer level 0-100
 */
export function toLevel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`Not a level: ${value}`);
  return clamp(Math.round(number), 0, 100);
}

/**
 * LEAP durations are "hh:mm:ss".
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  const total = clamp(Math.floor(Number(seconds) || 0), 0, MAX_FADE_SECONDS);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(Math.floor(total / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`;
}

/**
 * @param {number} percent 0-100, rounded to the closest speed
 * @returns {string} Off, Low, Medium, MediumHigh or High
 */
export function percentToFanSpeed(percent) {
  const value = clamp(Number(percent) || 0, 0, 100);
  let best = FAN_SPEEDS[0];
  for (const speed of FAN_SPEEDS) {
    if (Math.abs(speed[1] - value) < Math.abs(best[1] - value)) best = speed;
  }
  return best[0];
}

/**
 * @param {unknown} speed
 * @returns {number | null}
 */
export function fanSpeedToPercent(speed) {
  return FAN_SPEEDS.find(([name]) => name === speed)?.[1] ?? null;
}

const goToLevel = (level) => ({
  CommandType: 'GoToLevel',
  Parameter: [{ Type: 'Level', Value: level }],
});

/**
 * Set the level of a zone: brightness of a light, on/off of a switch,
 * position of a shade.
 *
 * @param {string} kind KINDS value
 * @param {number} level 0-100
 * @param {number} [fadeSeconds] lights only; 0 = the device's own fade
 * @returns {object}
 */
export function levelCommand(kind, level, fadeSeconds = 0) {
  const value = toLevel(level);
  const fade = fadeSeconds > 0 ? { FadeTime: formatDuration(fadeSeconds) } : {};
  switch (kind) {
    case KINDS.DIMMER:
      return fadeSeconds > 0
        ? { CommandType: 'GoToDimmedLevel', DimmedLevelParameters: { Level: value, ...fade } }
        : goToLevel(value);
    case KINDS.WHITE_TUNE:
      return {
        CommandType: 'GoToWhiteTuningLevel',
        WhiteTuningLevelParameters: { Level: value, ...fade },
      };
    case KINDS.SPECTRUM:
      return {
        CommandType: 'GoToSpectrumTuningLevel',
        SpectrumTuningLevelParameters: { Level: value, ...fade },
      };
    case KINDS.CCO:
      return {
        CommandType: 'GoToCCOLevel',
        CCOLevelParameters: { CCOLevel: value > 0 ? 'Closed' : 'Open' },
      };
    default:
      return goToLevel(value);
  }
}

/** @param {number} tilt 0-100 (50 = slats open, 0 and 100 = closed) */
export function tiltCommand(tilt) {
  return { CommandType: 'GoToTilt', TiltParameters: { Tilt: toLevel(tilt) } };
}

/** @param {number} percent */
export function fanCommand(percent) {
  return {
    CommandType: 'GoToFanSpeed',
    FanSpeedParameters: { FanSpeed: percentToFanSpeed(percent) },
  };
}

/** @param {'Raise' | 'Lower' | 'Stop'} direction */
export function moveCommand(direction) {
  return { CommandType: direction };
}

/**
 * @param {string} kind WHITE_TUNE or SPECTRUM
 * @param {number} kelvin
 */
export function kelvinCommand(kind, kelvin) {
  const white = { WhiteTuningLevel: { Kelvin: Math.round(kelvin) } };
  return kind === KINDS.WHITE_TUNE
    ? { CommandType: 'GoToWhiteTuningLevel', WhiteTuningLevelParameters: white }
    : {
        CommandType: 'GoToSpectrumTuningLevel',
        SpectrumTuningLevelParameters: { ColorTuningStatus: white },
      };
}

/**
 * @param {number} hue 0-360
 * @param {number} saturation 0-100
 */
export function hsvCommand(hue, saturation) {
  return {
    CommandType: 'GoToSpectrumTuningLevel',
    SpectrumTuningLevelParameters: {
      ColorTuningStatus: {
        HSVTuningLevel: { Hue: Math.round(hue) % 360, Saturation: toLevel(saturation) },
      },
    },
  };
}

/**
 * Warm dimming: the light gets warmer as it dims, like a halogen bulb.
 *
 * @param {string} kind WHITE_TUNE or SPECTRUM
 * @param {boolean} enabled
 */
export function warmDimCommand(kind, enabled) {
  const curve = { CurveDimming: enabled ? { Curve: { href: '/curve/1' } } : null };
  return kind === KINDS.WHITE_TUNE
    ? { CommandType: 'GoToWarmDim', WarmDimParameters: curve }
    : {
        CommandType: 'GoToSpectrumTuningLevel',
        SpectrumTuningLevelParameters: { ColorTuningStatus: curve },
      };
}

/** A scene (virtual button) or a keypad button. */
export function pressCommand() {
  return { CommandType: 'PressAndRelease' };
}

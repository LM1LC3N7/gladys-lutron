// -----------------------------------------------------------------------------
// LEAP status bodies -> plain values. Tolerant: a missing or malformed field
// gives null (the value is unknown), never an exception.
// -----------------------------------------------------------------------------

import { idFromHref } from './framing.js';

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);

/**
 * @typedef {object} ZoneState
 * @property {string} zoneId
 * @property {number | null} level      0-100 (light, switch, shade lift)
 * @property {boolean | null} on        switch or CCO, when reported apart from the level
 * @property {string | null} fanSpeed   Off, Low, Medium, MediumHigh, High
 * @property {number | null} tilt       0-100
 * @property {number | null} kelvin
 * @property {number | null} hue        0-360
 * @property {number | null} saturation 0-100
 * @property {boolean | null} warmDim
 */

/**
 * @param {any} status one ZoneStatus
 * @returns {ZoneState | null}
 */
export function parseZoneStatus(status) {
  const zoneId = idFromHref(status?.Zone?.href) ?? idFromHref(status?.href);
  if (!zoneId) return null;
  const level = number(status.Level);
  let on = null;
  if (status.SwitchedLevel === 'On' || status.SwitchedLevel === 'Off') {
    on = status.SwitchedLevel === 'On';
  }
  if (status.CCOLevel === 'Closed' || status.CCOLevel === 'Open') {
    on = status.CCOLevel === 'Closed';
  }
  const color = status.ColorTuningStatus;
  const white = color?.WhiteTuningLevel;
  const hsv = color?.HSVTuningLevel;
  return {
    zoneId,
    level: level !== null && level >= 0 ? Math.min(100, level) : null,
    on,
    fanSpeed: typeof status.FanSpeed === 'string' ? status.FanSpeed : null,
    tilt: number(status.Tilt),
    kelvin: number(white?.Kelvin),
    hue: number(hsv?.Hue),
    saturation: number(hsv?.Saturation),
    warmDim: color && typeof color === 'object' ? Boolean(color.CurveDimming?.Curve) : null,
  };
}

/**
 * Zone statuses of an answer: OneZoneStatus or MultipleZoneStatus.
 *
 * @param {any} body
 * @returns {ZoneState[]}
 */
export function zoneStatesOf(body) {
  const statuses = body?.ZoneStatus ? [body.ZoneStatus] : list(body?.ZoneStatuses);
  return statuses.map(parseZoneStatus).filter(Boolean);
}

/**
 * @param {any} body ButtonStatus answer or event
 * @returns {{ buttonId: string, event: string } | null} event: Press, Release, MultiTap, LongHold
 */
export function parseButtonEvent(body) {
  const status = body?.ButtonStatus;
  const buttonId = idFromHref(status?.Button?.href);
  const event = status?.ButtonEvent?.EventType;
  return buttonId && typeof event === 'string' ? { buttonId, event } : null;
}

/**
 * @param {unknown} value Occupied, Unoccupied, Unknown
 * @returns {boolean | null}
 */
export function occupancyOf(value) {
  if (value === 'Occupied') return true;
  if (value === 'Unoccupied') return false;
  return null;
}

/**
 * Caséta occupancy groups.
 *
 * @param {any} body
 * @returns {{ groupId: string, occupied: boolean | null }[]}
 */
export function occupancyStatesOf(body) {
  const statuses = body?.OccupancyGroupStatus
    ? [body.OccupancyGroupStatus]
    : list(body?.OccupancyGroupStatuses);
  return statuses
    .map((status) => ({
      groupId: idFromHref(status?.OccupancyGroup?.href) ?? idFromHref(status?.href),
      occupied: occupancyOf(status?.OccupancyStatus),
    }))
    .filter((state) => state.groupId);
}

/**
 * RadioRA 3 / QSX area statuses: occupancy and the active area scene. A key
 * absent from the status is `undefined` (not reported), null means "none".
 *
 * @param {any} body
 * @returns {{ areaId: string, occupied: boolean | null | undefined, sceneId: string | null | undefined }[]}
 */
export function areaStatesOf(body) {
  const statuses = body?.AreaStatus ? [body.AreaStatus] : list(body?.AreaStatuses);
  return statuses
    .map((status) => ({
      areaId: idFromHref(status?.href) ?? idFromHref(status?.Area?.href),
      occupied:
        'OccupancyStatus' in (status ?? {}) ? occupancyOf(status.OccupancyStatus) : undefined,
      sceneId:
        'CurrentScene' in (status ?? {})
          ? (idFromHref(status.CurrentScene?.href) ?? null)
          : undefined,
    }))
    .filter((state) => state.areaId);
}

/**
 * @param {any} body
 * @returns {boolean | null} Smart Away enabled
 */
export function smartAwayOf(body) {
  const state = body?.AwayStatus?.EnabledState;
  if (state === 'Enabled') return true;
  if (state === 'Disabled') return false;
  return null;
}

/**
 * @param {any} body
 * @returns {{ ledId: string, on: boolean } | null}
 */
export function parseLedStatus(body) {
  const status = body?.LEDStatus;
  const ledId = idFromHref(status?.LED?.href) ?? idFromHref(status?.href);
  if (!ledId || (status.State !== 'On' && status.State !== 'Off')) return null;
  return { ledId, on: status.State === 'On' };
}

/**
 * @param {any} body `/device/{id}/status`
 * @returns {boolean | null} battery low, null when not reported
 */
export function batteryLowOf(body) {
  const state = body?.DeviceStatus?.BatteryStatus?.LevelState;
  if (state === 'Low') return true;
  if (state === 'Good') return false;
  return null;
}

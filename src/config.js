// -----------------------------------------------------------------------------
// Configuration: raw Gladys config -> normalized, typed values.
//
// The form fields (config_schema) are typed by the core but may be missing
// (never saved yet) or come back as strings; the pairing credentials are free
// internal storage written by the integration itself (see src/gladys/keys.js).
// Nothing here throws: a bad value falls back to its default, so a typo in
// the form never stops the integration.
// -----------------------------------------------------------------------------

import { isIPv4 } from 'node:net';
import { BUTTON_DETECTION, CONFIG_KEYS, STORAGE_KEYS } from './gladys/keys.js';

export const DEFAULTS = Object.freeze({
  buttonDetection: BUTTON_DETECTION.NORMAL,
  defaultFadeSeconds: 0,
});

export const MAX_FADE_SECONDS = 60;

/**
 * A bridge address as typed by the user: trimmed, IPv4 only (LEAP over IPv6
 * fails on some bridges, pylutron-caseta #139). Host names are refused: the
 * container resolves no `.local` name (no mDNS on the Docker bridge network).
 *
 * @param {unknown} value
 * @returns {string | null} the address, or null when empty or invalid
 */
export function normalizeHost(value) {
  if (typeof value !== 'string') return null;
  const host = value.trim();
  return isIPv4(host) ? host : null;
}

/**
 * @param {unknown} value
 * @returns {string} one of BUTTON_DETECTION
 */
export function normalizeButtonDetection(value) {
  return Object.values(BUTTON_DETECTION).includes(value) ? value : DEFAULTS.buttonDetection;
}

/**
 * @param {unknown} value
 * @returns {number} whole seconds in [0, MAX_FADE_SECONDS]
 */
export function normalizeFadeSeconds(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return DEFAULTS.defaultFadeSeconds;
  return Math.min(MAX_FADE_SECONDS, Math.max(0, Math.round(number)));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * @typedef {object} PairingCredentials
 * @property {string} key  PEM private key of the integration
 * @property {string} cert PEM certificate signed by the bridge
 * @property {string} ca   PEM authority the bridge certificate chains to
 */

/**
 * @typedef {object} LutronConfig
 * @property {string | null} bridgeHost       IPv4 of the bridge, or null
 * @property {boolean} bridgeHostInvalid      something was typed but it is not an IPv4
 * @property {string} buttonDetection         instant | normal | relaxed
 * @property {number} defaultFadeSeconds
 * @property {PairingCredentials | null} credentials null until paired
 * @property {string | null} bridgeSerial     serial of the paired bridge
 * @property {string | null} bridgeType       mDNS system type of the paired bridge
 */

/**
 * @param {Record<string, unknown>} [raw]
 * @returns {LutronConfig}
 */
export function normalizeConfig(raw = {}) {
  const typedHost = raw[CONFIG_KEYS.BRIDGE_HOST];
  const bridgeHost = normalizeHost(typedHost);
  const key = nonEmptyString(raw[STORAGE_KEYS.LEAP_KEY]);
  const cert = nonEmptyString(raw[STORAGE_KEYS.LEAP_CERT]);
  const ca = nonEmptyString(raw[STORAGE_KEYS.LEAP_CA]);
  return {
    bridgeHost,
    bridgeHostInvalid: bridgeHost === null && nonEmptyString(typedHost) !== null,
    buttonDetection: normalizeButtonDetection(raw[CONFIG_KEYS.BUTTON_DETECTION]),
    defaultFadeSeconds: normalizeFadeSeconds(raw[CONFIG_KEYS.DEFAULT_FADE_SECONDS]),
    credentials: key && cert && ca ? { key, cert, ca } : null,
    bridgeSerial: nonEmptyString(raw[STORAGE_KEYS.BRIDGE_SERIAL]),
    bridgeType: nonEmptyString(raw[STORAGE_KEYS.BRIDGE_TYPE]),
  };
}

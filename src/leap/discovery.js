// -----------------------------------------------------------------------------
// Lutron bridges found by an mDNS scan of `_lutron._tcp`.
//
// The container cannot see mDNS (Docker bridge network): the Gladys core runs
// the scan on the host network and hands over the raw answers
// ({ name, host, addresses, port, txt }). Bridges announce themselves as
// "Lutron-<serial in hex>.local" with a SYSTYPE TXT record (smartbridge,
// ra2select, radiora3, hwqs… — Home Assistant filters on the same values).
// -----------------------------------------------------------------------------

import { isIPv4 } from 'node:net';

/** @typedef {'caseta' | 'ra2select' | 'ra3' | 'qsx' | 'unknown'} BridgeFamily */

/**
 * @param {string | undefined} systype
 * @returns {BridgeFamily}
 */
export function familyOf(systype) {
  const value = String(systype ?? '').toLowerCase();
  if (value.startsWith('smartbridge')) return 'caseta';
  if (value.startsWith('ra2select')) return 'ra2select';
  if (value.startsWith('radiora3')) return 'ra3';
  if (value.startsWith('hwqs')) return 'qsx';
  return 'unknown';
}

/** Human name of a bridge family. */
export const FAMILY_LABELS = Object.freeze({
  caseta: 'Caséta',
  ra2select: 'RA2 Select',
  ra3: 'RadioRA 3',
  qsx: 'HomeWorks QSX',
  unknown: 'Lutron',
});

/**
 * @param {string[] | undefined} txt raw "KEY=value" records
 * @returns {Record<string, string>} keys in lower case
 */
export function parseTxt(txt) {
  const records = {};
  for (const entry of Array.isArray(txt) ? txt : []) {
    if (typeof entry !== 'string') continue;
    const equal = entry.indexOf('=');
    if (equal <= 0) continue;
    records[entry.slice(0, equal).trim().toLowerCase()] = entry.slice(equal + 1).trim();
  }
  return records;
}

/**
 * @typedef {object} DiscoveredBridge
 * @property {string} host        IPv4 address
 * @property {string | null} serial serial number (hex, upper case) from the host name
 * @property {string | null} systype raw SYSTYPE
 * @property {BridgeFamily} family
 */

/**
 * @param {Array<{ name?: string, host?: string | null, addresses?: string[], txt?: string[] }>} results
 * @returns {DiscoveredBridge[]} one entry per IPv4 bridge, sorted by address
 */
export function parseMdnsResults(results) {
  const bridges = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const host = (result?.addresses ?? []).find((address) => isIPv4(address));
    if (!host) continue;
    const match = /^lutron-([0-9a-f]+)(?:\.local)?\.?$/i.exec(String(result.host ?? ''));
    const txt = parseTxt(result.txt);
    const systype = txt.systype ?? null;
    if (!match && !systype) continue; // another device answering the scan
    bridges.set(host, {
      host,
      serial: match ? match[1].toUpperCase() : null,
      systype,
      family: familyOf(systype),
    });
  }
  return [...bridges.values()].sort((a, b) =>
    a.host.localeCompare(b.host, 'en', { numeric: true }),
  );
}

// -----------------------------------------------------------------------------
// Diagnostics: read-only crawl of the LEAP endpoints that describe a Lutron
// system, anonymized, turned into log lines a user can copy from the Gladys
// Logs tab and attach to a bug report (or that become test fixtures).
//
// Only ReadRequests: the crawl never changes anything on the bridge. Every
// endpoint is tried on its own: a 404 or a timeout is recorded, not fatal.
// The crawl is bounded (requests and time) to fit the action timeout.
// -----------------------------------------------------------------------------

import { anonymize, createPseudonymizer } from './anonymize.js';
import { LeapStatusError, LeapTimeoutError } from './errors.js';
import { idFromHref } from './framing.js';

export const DIAGNOSTICS_BEGIN = '===== LUTRON DIAGNOSTICS BEGIN =====';
export const DIAGNOSTICS_END = '===== LUTRON DIAGNOSTICS END =====';
export const LINE_PREFIX = 'LUTRON-DIAG ';

const COMMON = ['/server/1/status/ping', '/project', '/device?where=IsThisDevice:true', '/area'];
const CASETA = [
  '/device',
  '/button',
  '/buttongroup',
  '/zone',
  '/virtualbutton',
  '/occupancygroup',
  '/occupancygroup/status',
  '/system/away/1/status',
];
const PROCESSOR = ['/device', '/zone/status', '/area/status', '/occupancygroup'];

// Devices whose /device/{id}/status says something (battery of shades and
// sensors); asking every dimmer would only collect 404s.
const STATUS_DEVICE = /shade|blind|drape|tilt|serena|triathlon|sivoia|occupancy|sensor/i;
// Button devices of RA3/QSX, whose buttons are read per device (pylutron-caseta's
// "sensor" types: keypads, Picos, the shade remote; the Vierti keypad has no
// readable type name).
const KEYPAD_DEVICE = /keypad|pico|seetouch|fourgroupremote|^N-CVLpqtTTOIeG-4hcjKgw$/i;

const hrefsOf = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => item?.href)
    .filter((href) => typeof href === 'string');

/**
 * @typedef {object} DiagnosticsEntry
 * @property {string} url
 * @property {'ok' | 'status' | 'timeout' | 'error'} outcome
 * @property {string} [status] LEAP status of an error answer ("404 NotFound")
 * @property {string} [error]  short error message
 * @property {any} [body]      anonymized body (outcome "ok")
 */

/**
 * @param {{ read(url: string): Promise<any> }} connection a connected LeapConnection
 * @param {object} [options]
 * @param {'caseta' | 'ra3' | 'qsx'} [options.system] from bridgeInfo (read again when absent)
 * @param {number} [options.maxRequests]
 * @param {number} [options.timeBudgetMs]
 * @returns {Promise<{ entries: DiagnosticsEntry[], truncated: boolean, durationMs: number }>}
 */
export async function collectDiagnostics(
  connection,
  { system, maxRequests = 300, timeBudgetMs = 70_000 } = {},
) {
  const started = Date.now();
  const pseudonyms = createPseudonymizer();
  const entries = [];
  const raw = new Map();
  const seen = new Set();
  let truncated = false;

  const read = async (url) => {
    if (seen.has(url)) return raw.get(url);
    if (entries.length >= maxRequests || Date.now() - started > timeBudgetMs) {
      truncated = true;
      return undefined;
    }
    seen.add(url);
    try {
      const body = await connection.read(url);
      raw.set(url, body);
      entries.push({ url, outcome: 'ok', body: anonymize(body, pseudonyms) });
      return body;
    } catch (error) {
      if (error instanceof LeapStatusError) {
        entries.push({ url, outcome: 'status', status: error.status });
      } else if (error instanceof LeapTimeoutError) {
        entries.push({ url, outcome: 'timeout' });
      } else {
        entries.push({ url, outcome: 'error', error: String(error?.message ?? error) });
      }
      return undefined;
    }
  };

  for (const url of COMMON) await read(url);
  const productType = raw.get('/project')?.Project?.ProductType;
  const kind =
    system ??
    (productType === 'Lutron RadioRA 3 Project'
      ? 'ra3'
      : productType === 'Lutron HWQS Project'
        ? 'qsx'
        : 'caseta');

  if (kind === 'caseta') {
    for (const url of CASETA) await read(url);
    const devices = raw.get('/device')?.Devices ?? [];
    const zones = new Set(hrefsOf(raw.get('/zone')?.Zones));
    for (const device of devices) {
      for (const href of hrefsOf(device?.LocalZones)) zones.add(href);
    }
    for (const zone of zones) await read(`${zone}/status`);
    for (const device of devices) {
      if (device?.href && STATUS_DEVICE.test(String(device.DeviceType))) {
        await read(`${device.href}/status`);
      }
    }
  } else {
    for (const url of PROCESSOR) await read(url);
    const keypads = new Set();
    for (const area of hrefsOf(raw.get('/area')?.Areas)) {
      if (!idFromHref(area)) continue;
      const stations = await read(`${area}/associatedcontrolstation`);
      await read(`${area}/associatedzone`);
      await read(`${area}/areascene`);
      for (const station of stations?.ControlStations ?? []) {
        for (const ganged of station?.AssociatedGangedDevices ?? []) {
          const device = ganged?.Device;
          if (device?.href && KEYPAD_DEVICE.test(String(device.DeviceType)))
            keypads.add(device.href);
        }
      }
    }
    for (const keypad of keypads) await read(`${keypad}/buttongroup/expanded`);
  }

  return { entries, truncated, durationMs: Date.now() - started };
}

/**
 * One log line per entry, or per item of a collection (a big /device answer
 * becomes one line per device: log viewers cope badly with huge lines).
 *
 * @param {{ entries: DiagnosticsEntry[], truncated: boolean, durationMs: number }} report
 * @param {object} header context written first (versions, connection state…)
 * @returns {string[]}
 */
export function toLogLines(report, header) {
  const lines = [DIAGNOSTICS_BEGIN, `${LINE_PREFIX}${JSON.stringify({ header })}`];
  for (const entry of report.entries) {
    const { body, ...meta } = entry;
    const keys = body && typeof body === 'object' ? Object.keys(body) : [];
    const collection = keys.length === 1 && Array.isArray(body[keys[0]]) ? keys[0] : null;
    if (collection && body[collection].length > 0) {
      const items = body[collection];
      items.forEach((item, index) => {
        lines.push(
          `${LINE_PREFIX}${JSON.stringify({ ...meta, collection, index, count: items.length, item })}`,
        );
      });
    } else {
      lines.push(`${LINE_PREFIX}${JSON.stringify(entry)}`);
    }
  }
  lines.push(
    `${LINE_PREFIX}${JSON.stringify({ requests: report.entries.length, truncated: report.truncated, durationMs: report.durationMs })}`,
    DIAGNOSTICS_END,
  );
  return lines;
}

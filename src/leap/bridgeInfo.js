// -----------------------------------------------------------------------------
// Who is at the other end: the project type (picks the Caséta or the RA3/QSX
// code path) and the bridge / processor device itself.
// -----------------------------------------------------------------------------

import { LeapStatusError } from './errors.js';

/** @typedef {'caseta' | 'ra3' | 'qsx'} SystemKind */

/**
 * @param {string | undefined} productType Project.ProductType
 * @returns {SystemKind}
 */
export function systemOf(productType) {
  if (productType === 'Lutron RadioRA 3 Project') return 'ra3';
  if (productType === 'Lutron HWQS Project') return 'qsx';
  return 'caseta'; // "Lutron Smart Bridge Project": Caséta and RA2 Select
}

/**
 * Serial numbers are integers in LEAP and hexadecimal in the mDNS host name
 * ("Lutron-0123abcd"): the hex form, upper case, 8 digits, is the reference.
 *
 * @param {unknown} serial
 * @returns {string | null}
 */
export function serialToHex(serial) {
  const number = typeof serial === 'string' && /^\d+$/.test(serial) ? Number(serial) : serial;
  if (!Number.isSafeInteger(number) || number < 0) return null;
  return number.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * @typedef {object} BridgeInfo
 * @property {SystemKind} system
 * @property {string | null} productType
 * @property {string | null} name        name of the bridge device
 * @property {string | null} model       model number (L-BDG2-WH…)
 * @property {string | null} serial      hex serial (see serialToHex)
 * @property {string | null} firmware
 */

/**
 * @param {{ read(url: string): Promise<any> }} connection
 * @returns {Promise<BridgeInfo>}
 */
export async function readBridgeInfo(connection) {
  const project = (await connection.read('/project'))?.Project ?? {};
  let device = null;
  try {
    const body = await connection.read('/device?where=IsThisDevice:true');
    device = body?.Devices?.[0] ?? body?.Device ?? null;
  } catch (error) {
    if (!(error instanceof LeapStatusError)) throw error;
  }
  if (!device) {
    // Older bridges: the bridge is device 1 (lutron-leap does the same).
    device = (await connection.read('/device/1').catch(() => null))?.Device ?? null;
  }
  return {
    system: systemOf(project.ProductType),
    productType: project.ProductType ?? null,
    name: device?.Name ?? null,
    model: device?.ModelNumber ?? null,
    serial: serialToHex(device?.SerialNumber),
    firmware: device?.FirmwareImage?.Firmware?.DisplayName ?? null,
  };
}

// -----------------------------------------------------------------------------
// The Lutron project, read from the bridge and normalized: areas, zones (what
// can be controlled), occupancy groups, scenes, Smart Away, batteries.
//
// Caséta and RA2 Select ("Lutron Smart Bridge Project") are read here, after
// pylutron-caseta (Apache-2.0, see NOTICE). Optional endpoints (scenes,
// occupancy, Smart Away, batteries) that a bridge does not have are skipped;
// only `/area` and `/device` are required. An unknown device type is
// reported in `unknownTypes` and skipped, never fatal.
// -----------------------------------------------------------------------------

import { serialToHex } from './bridgeInfo.js';
import { KINDS, MAY_HAVE_BATTERY, ZONE_KINDS, kindOf } from './deviceTypes.js';
import { LeapStatusError, LeapTimeoutError } from './errors.js';
import { idFromHref } from './framing.js';
import { batteryLowOf, smartAwayOf } from './status.js';

/**
 * @typedef {object} Area
 * @property {string} id
 * @property {string} name
 * @property {string | null} parentId
 */

/**
 * @typedef {object} Zone
 * @property {string} id         zone id
 * @property {string} kind       KINDS value
 * @property {string} type       Lutron DeviceType or ControlType
 * @property {string} name       "<Area> <Name>"
 * @property {string | null} area
 * @property {string | null} deviceId   the device driving the zone (Caséta)
 * @property {string | null} serial     hex serial of that device
 * @property {string | null} model
 * @property {{ min: number, max: number } | null} whiteRange kelvin range (tunable white)
 * @property {boolean} battery  the device reports a battery
 */

/**
 * @typedef {object} Button
 * @property {string} id
 * @property {number} number   ButtonNumber
 * @property {string} name
 * @property {boolean} raiseLower  a raise / lower button (long press detected later)
 * @property {string | null} ledId
 */

/**
 * @typedef {object} ButtonDevice
 * @property {string} id       device id
 * @property {string} kind     REMOTE or KEYPAD
 * @property {string} type
 * @property {string} name
 * @property {string | null} area
 * @property {string | null} serial
 * @property {string | null} model
 * @property {Button[]} buttons
 */

/**
 * @typedef {object} Scene
 * @property {string} id
 * @property {string} name
 * @property {'virtualbutton' | 'areascene'} source
 * @property {string | null} areaId
 * @property {string | null} area
 */

/**
 * @typedef {object} OccupancyGroup
 * @property {string} id       occupancy group id (Caséta) or area id (RA3/QSX)
 * @property {string} name
 * @property {string | null} area
 * @property {string[]} sensorDeviceIds devices of the sensors (battery)
 * @property {boolean} battery at least one sensor reports a battery
 */

/**
 * @typedef {object} LutronModel
 * @property {'caseta' | 'ra3' | 'qsx'} system
 * @property {import('./bridgeInfo.js').BridgeInfo} bridge
 * @property {Map<string, Area>} areas
 * @property {Zone[]} zones
 * @property {ButtonDevice[]} buttonDevices
 * @property {Scene[]} scenes
 * @property {OccupancyGroup[]} occupancyGroups
 * @property {boolean} smartAway   the bridge has Smart Away
 * @property {Map<string, boolean>} batteries device id -> battery low, as read at load
 * @property {boolean | null} smartAwayEnabled as read at load
 * @property {string[]} unknownTypes
 */

/**
 * Read an endpoint a bridge may not have: absent (404, 204…) or silent gives
 * null; a closed connection still fails the load.
 *
 * @param {{ read(url: string): Promise<any> }} connection
 * @param {string} url
 */
export async function readOptional(connection, url) {
  try {
    return await connection.read(url);
  } catch (error) {
    if (error instanceof LeapStatusError || error instanceof LeapTimeoutError) return null;
    throw error;
  }
}

/** @param {any} body `/area` */
export function parseAreas(body) {
  const areas = new Map();
  for (const area of body?.Areas ?? []) {
    const id = idFromHref(area?.href);
    if (!id) continue;
    areas.set(id, {
      id,
      name: typeof area.Name === 'string' ? area.Name : `Area ${id}`,
      parentId: idFromHref(area.Parent?.href),
    });
  }
  return areas;
}

/**
 * "Living room" + "Lamp" -> "Living room Lamp"; no repetition when the name
 * already starts with the area.
 *
 * @param {string | null | undefined} area
 * @param {string} name
 */
export function displayName(area, name) {
  if (!area) return name;
  return name.toLocaleLowerCase().startsWith(area.toLocaleLowerCase()) ? name : `${area} ${name}`;
}

const isBridgeDevice = (device) =>
  device?.IsThisDevice === true || /bridge|repeater|processor/i.test(String(device?.DeviceType));

/**
 * @param {{ read(url: string): Promise<any> }} connection
 * @param {import('./bridgeInfo.js').BridgeInfo} bridge
 * @returns {Promise<LutronModel>}
 */
export async function loadCasetaModel(connection, bridge) {
  const areas = parseAreas(await connection.read('/area'));
  const devices = (await connection.read('/device'))?.Devices ?? [];
  const areaOf = (device) => areas.get(idFromHref(device?.AssociatedArea?.href))?.name ?? null;

  const zones = [];
  const unknownTypes = new Set();
  const sensorDevices = new Map(); // occupancy sensor id -> device id
  const batteryCandidates = [];

  for (const device of devices) {
    const deviceId = idFromHref(device?.href);
    if (!deviceId || isBridgeDevice(device)) continue;
    const kind = kindOf(device.DeviceType);
    const name = typeof device.Name === 'string' ? device.Name : `Device ${deviceId}`;
    const zoneId = idFromHref(device.LocalZones?.[0]?.href);
    if (kind && ZONE_KINDS.includes(kind) && zoneId) {
      zones.push({
        id: zoneId,
        kind,
        type: device.DeviceType,
        name: displayName(areaOf(device), name),
        area: areaOf(device),
        deviceId,
        serial: serialToHex(device.SerialNumber),
        model: device.ModelNumber ?? null,
        whiteRange: null,
        battery: false,
      });
      if (MAY_HAVE_BATTERY.test(device.DeviceType)) batteryCandidates.push(deviceId);
    } else if (kind === KINDS.OCCUPANCY_SENSOR) {
      for (const sensor of device.OccupancySensors ?? []) {
        const sensorId = idFromHref(sensor?.href);
        if (sensorId) sensorDevices.set(sensorId, deviceId);
      }
      batteryCandidates.push(deviceId);
    } else if (!kind) {
      unknownTypes.add(String(device.DeviceType));
    }
  }

  const scenes = [];
  for (const button of (await readOptional(connection, '/virtualbutton'))?.VirtualButtons ?? []) {
    const id = idFromHref(button?.href);
    // Unnamed virtual buttons belong to scene Picos, not to the user's scenes.
    if (id && button.IsProgrammed && typeof button.Name === 'string') {
      scenes.push({ id, name: button.Name, source: 'virtualbutton', areaId: null, area: null });
    }
  }

  const occupancyGroups = [];
  for (const group of (await readOptional(connection, '/occupancygroup'))?.OccupancyGroups ?? []) {
    const id = idFromHref(group?.href);
    const sensorIds = (group?.AssociatedSensors ?? [])
      .map((sensor) => idFromHref(sensor?.OccupancySensor?.href))
      .filter(Boolean);
    const area = areas.get(idFromHref(group?.AssociatedAreas?.[0]?.Area?.href))?.name ?? null;
    if (!id || sensorIds.length === 0 || !area) continue;
    occupancyGroups.push({
      id,
      name: displayName(area, 'Occupancy'),
      area,
      sensorDeviceIds: sensorIds.map((sensorId) => sensorDevices.get(sensorId)).filter(Boolean),
      battery: false,
    });
  }

  const away = await readOptional(connection, '/system/away/1/status');
  const smartAwayEnabled = smartAwayOf(away);

  const batteries = await readBatteries(connection, batteryCandidates);
  for (const zone of zones) zone.battery = batteries.has(zone.deviceId);
  for (const group of occupancyGroups) {
    group.battery = group.sensorDeviceIds.some((id) => batteries.has(id));
  }

  return {
    system: 'caseta',
    bridge,
    areas,
    zones,
    buttonDevices: [],
    scenes,
    occupancyGroups,
    smartAway: smartAwayEnabled !== null,
    smartAwayEnabled,
    batteries,
    unknownTypes: [...unknownTypes],
  };
}

/**
 * Battery of battery powered devices (shades, sensors). Picos report none.
 *
 * @param {{ read(url: string): Promise<any> }} connection
 * @param {string[]} deviceIds
 * @returns {Promise<Map<string, boolean>>} device id -> low, only for devices reporting one
 */
export async function readBatteries(connection, deviceIds) {
  const batteries = new Map();
  for (const deviceId of new Set(deviceIds)) {
    const low = batteryLowOf(await readOptional(connection, `/device/${deviceId}/status`));
    if (low !== null) batteries.set(deviceId, low);
  }
  return batteries;
}

/**
 * @param {{ read(url: string): Promise<any> }} connection
 * @param {import('./bridgeInfo.js').BridgeInfo} bridge
 * @returns {Promise<LutronModel>}
 */
export async function loadModel(connection, bridge) {
  return loadCasetaModel(connection, bridge);
}

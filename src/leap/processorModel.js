// -----------------------------------------------------------------------------
// The project of a RadioRA 3 or HomeWorks QSX processor, read per area like
// pylutron-caseta (Apache-2.0, see NOTICE): zones (`associatedzone`, typed by
// their ControlType), control stations with their keypads and Picos
// (`buttongroup/expanded`, engravings as button names, LEDs), area scenes,
// and occupancy per area (sensors from `/device?where=IsThisDevice:false`).
// `/device` answers 204 on QSX: never read here.
// -----------------------------------------------------------------------------

import { serialToHex } from './bridgeInfo.js';
import { BUTTON_KINDS, KINDS, ZONE_KINDS, kindOf } from './deviceTypes.js';
import { idFromHref } from './framing.js';
import { displayName, parseAreas, readBatteries, readOptional } from './model.js';
import { buttonName, isRaiseLower } from './picoModels.js';
import { smartAwayOf } from './status.js';

/** "Device 1", "Position 2": names the programmer left as they were. */
const GENERIC_NAME = /^(?:device|position)\s*(\d*)$/i;

/**
 * Engraving first (what the user reads on the keypad), then the model's
 * table for Picos, then the LEAP name.
 */
function nameOfButton(type, button) {
  const engraving = button?.Engraving?.Text;
  if (typeof engraving === 'string' && engraving.trim()) {
    return engraving.replace(/\s+/g, ' ').trim();
  }
  return buttonName(type, button.ButtonNumber, button.Name);
}

/** The scenes of an `areascene` answer, whatever its collection name. */
function areaScenesOf(body) {
  const items = Object.values(body ?? {}).find(Array.isArray) ?? [];
  return items
    .map((scene) => ({ id: idFromHref(scene?.href), name: scene?.Name }))
    .filter((scene) => scene.id && typeof scene.name === 'string' && scene.name.trim());
}

/**
 * @param {{ read(url: string): Promise<any> }} connection
 * @param {import('./bridgeInfo.js').BridgeInfo} bridge
 * @returns {Promise<import('./model.js').LutronModel>}
 */
export async function loadProcessorModel(connection, bridge) {
  const areas = parseAreas(await connection.read('/area'));
  const zones = [];
  const buttonDevices = [];
  const scenes = [];
  const unknownTypes = new Set();

  for (const area of areas.values()) {
    const zoneBody = await readOptional(connection, `/area/${area.id}/associatedzone`);
    for (const zone of zoneBody?.Zones ?? []) {
      const id = idFromHref(zone?.href);
      const kind = kindOf(zone?.ControlType);
      if (!id) continue;
      if (!kind || !ZONE_KINDS.includes(kind)) {
        unknownTypes.add(String(zone?.ControlType));
        continue;
      }
      const range = zone.ColorTuningProperties?.WhiteTuningLevelRange;
      zones.push({
        id,
        kind,
        type: zone.ControlType,
        name: displayName(area.name, typeof zone.Name === 'string' ? zone.Name : `Zone ${id}`),
        area: area.name,
        deviceId: null,
        serial: null,
        model: null,
        whiteRange:
          Number.isFinite(range?.Min) && Number.isFinite(range?.Max)
            ? { min: range.Min, max: range.Max }
            : null,
        battery: false,
      });
    }

    const stations = await readOptional(connection, `/area/${area.id}/associatedcontrolstation`);
    for (const station of stations?.ControlStations ?? []) {
      for (const ganged of station?.AssociatedGangedDevices ?? []) {
        const deviceId = idFromHref(ganged?.Device?.href);
        const type = ganged?.Device?.DeviceType;
        if (!deviceId || !BUTTON_KINDS.includes(kindOf(type))) continue;
        const groups = await readOptional(connection, `/device/${deviceId}/buttongroup/expanded`);
        const buttons = (groups?.ButtonGroupsExpanded ?? [])
          .flatMap((group) => group?.Buttons ?? [])
          .filter((button) => idFromHref(button?.href) && Number.isInteger(button.ButtonNumber))
          .map((button) => {
            const name = nameOfButton(type, button);
            return {
              id: idFromHref(button.href),
              number: button.ButtonNumber,
              name,
              raiseLower: isRaiseLower(name),
              ledId: idFromHref(button.AssociatedLED?.href),
            };
          })
          .sort((a, b) => a.number - b.number);
        if (buttons.length === 0) continue;
        const device = (await readOptional(connection, `/device/${deviceId}`))?.Device ?? {};
        const deviceName = typeof device.Name === 'string' ? device.Name : '';
        const stationName = typeof station.Name === 'string' ? station.Name : '';
        const kind = kindOf(type);
        const label = kind === KINDS.KEYPAD ? 'Keypad' : 'Pico';
        // "Device 1" says less than "Keypad 1"; the number keeps names apart.
        const generic = GENERIC_NAME.exec(deviceName);
        const own = !deviceName
          ? label
          : generic
            ? `${label}${generic[1] ? ` ${generic[1]}` : ''}`
            : deviceName;
        buttonDevices.push({
          id: deviceId,
          kind,
          type,
          name: displayName(area.name, stationName ? `${stationName} ${own}` : own),
          area: area.name,
          areaId: area.id,
          serial: serialToHex(device.SerialNumber),
          model: device.ModelNumber ?? null,
          buttons,
        });
      }
    }

    for (const scene of areaScenesOf(
      await readOptional(connection, `/area/${area.id}/areascene`),
    )) {
      scenes.push({ ...scene, source: 'areascene', areaId: area.id, area: area.name });
    }
  }

  // Occupancy is reported per area: one group per area with sensors.
  const groups = new Map();
  const devices = (await readOptional(connection, '/device?where=IsThisDevice:false'))?.Devices;
  for (const device of devices ?? []) {
    if (kindOf(device?.DeviceType) !== KINDS.OCCUPANCY_SENSOR) continue;
    const deviceId = idFromHref(device.href);
    const area = areas.get(idFromHref(device.AssociatedArea?.href));
    if (!deviceId || !area) continue;
    if (!groups.has(area.id)) {
      groups.set(area.id, {
        id: area.id,
        name: displayName(area.name, 'Occupancy'),
        area: area.name,
        sensorDeviceIds: [],
        battery: false,
      });
    }
    groups.get(area.id).sensorDeviceIds.push(deviceId);
  }
  const occupancyGroups = [...groups.values()];
  const batteries = await readBatteries(
    connection,
    occupancyGroups.flatMap((group) => group.sensorDeviceIds),
  );
  for (const group of occupancyGroups) {
    group.battery = group.sensorDeviceIds.some((id) => batteries.has(id));
  }
  const smartAwayEnabled = smartAwayOf(await readOptional(connection, '/system/away/1/status'));

  return {
    system: bridge.system,
    bridge,
    areas,
    zones,
    buttonDevices,
    scenes,
    occupancyGroups,
    smartAway: smartAwayEnabled !== null,
    smartAwayEnabled,
    batteries,
    unknownTypes: [...unknownTypes],
  };
}

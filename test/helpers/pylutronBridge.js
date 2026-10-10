// Routes of the fake bridge serving the pylutron-caseta test responses
// (test/fixtures/pylutron/, Apache-2.0): a Caséta bridge with a dimmer, a
// fan, shades, tilt blinds, occupancy sensors, a Pico and a shade remote.

import { readFileSync } from 'node:fs';
import { ok } from './fakeBridge.js';

const fixture = (path) =>
  JSON.parse(readFileSync(new URL(`../fixtures/pylutron/${path}`, import.meta.url), 'utf8'));

/** A fresh copy (routes may be called many times, bodies get mutated by paging). */
export const load = (path) => structuredClone(fixture(path));

/**
 * @param {object} [options]
 * @param {Record<string, object>} [options.zones] zone id -> ZoneStatus fields
 * @param {Record<string, string>} [options.batteries] device id -> LevelState
 */
export function casetaRoutes({
  zones = {
    1: { Level: 40 },
    2: { FanSpeed: 'Medium' },
    3: { Tilt: 25 },
    4: { Tilt: 40 },
    6: { Level: 100 },
  },
  batteries = { 4: 'Good', 5: 'Low', 6: 'Good', 7: 'Good', 10: 'Good' },
} = {}) {
  const routes = {
    '/project': () => load('project.json'),
    '/area': () => load('areas.json'),
    '/device': () => load('devices.json'),
    '/device?where=IsThisDevice:true': () =>
      ok({ Devices: [load('devices.json').Body.Devices[0]] }),
    '/button': () => load('buttons.json'),
    '/virtualbutton': () => load('scenes.json'),
    '/occupancygroup': () => load('occupancygroups.json'),
    'SubscribeRequest /occupancygroup/status': () => load('occupancygroupsubscribe.json'),
    'ReadRequest /occupancygroup/status': () => load('occupancygroupsubscribe.json'),
    'SubscribeRequest /system/away/1/status': () => load('smartaway.json'),
    'ReadRequest /system/away/1/status': () => ({
      ...load('smartaway.json'),
      CommuniqueType: 'ReadResponse',
    }),
  };
  for (const [id, fields] of Object.entries(zones)) {
    routes[`/zone/${id}/status`] = () =>
      ok(
        { ZoneStatus: { href: `/zone/${id}/status`, ...fields, Zone: { href: `/zone/${id}` } } },
        {
          MessageBodyType: 'OneZoneStatus',
        },
      );
  }
  for (const id of Object.keys(zones)) {
    // Like a bridge: the answer carries the new status (levels only here).
    routes[`CreateRequest /zone/${id}/commandprocessor`] = (request) => {
      const command = request.Body?.Command ?? {};
      const level =
        command.Parameter?.find((p) => p.Type === 'Level')?.Value ??
        command.DimmedLevelParameters?.Level;
      return {
        CommuniqueType: 'CreateResponse',
        Header: { StatusCode: '201 Created', MessageBodyType: 'OneZoneStatus' },
        Body: {
          ZoneStatus: {
            href: `/zone/${id}/status`,
            ...(level === undefined ? {} : { Level: level }),
            Zone: { href: `/zone/${id}` },
          },
        },
      };
    };
  }
  for (const [id, state] of Object.entries(batteries)) {
    routes[`/device/${id}/status`] = () =>
      ok({ DeviceStatus: { href: `/device/${id}/status`, BatteryStatus: { LevelState: state } } });
  }
  return routes;
}

/**
 * A RadioRA 3 (`ra3`) or HomeWorks QSX (`hwqsx`) processor.
 *
 * @param {'ra3' | 'hwqsx'} system
 * @param {object} [options]
 * @param {Record<string, object[]>} [options.areaScenes] area id -> AreaScenes
 * @param {Record<string, string>} [options.leds] LED id -> On / Off (others: Off)
 */
export function processorRoutes(system, { areaScenes = {}, leds = {} } = {}) {
  const dir = `${system}/`;
  const body = (path) => {
    const message = load(`${dir}${path}`);
    // hwqsx/zonestatus.json is a bare body.
    return message.Header ? message : ok(message, { MessageBodyType: 'MultipleZoneStatus' });
  };
  const routes = {
    '/project': () => body('project.json'),
    '/area': () => body('areas.json'),
    '/device': () => body('devices.json'),
    '/device?where=IsThisDevice:true': () => body('processor.json'),
    '/device?where=IsThisDevice:false': () => body('device-list.json'),
    'SubscribeRequest /zone/status': () => body('zonestatus.json'),
    'ReadRequest /zone/status': () => body('zonestatus.json'),
    'SubscribeRequest /area/status': () => body('area/status-subscribe.json'),
    'ReadRequest /area/status': () => body('area/status-subscribe.json'),
  };
  for (const area of load(`${dir}areas.json`).Body.Areas) {
    const id = area.href.split('/')[2];
    routes[`/area/${id}/associatedzone`] = () => body(`area/${id}/associatedzone.json`);
    routes[`/area/${id}/associatedcontrolstation`] = () => body(`area/${id}/controlstation.json`);
    if (areaScenes[id]) routes[`/area/${id}/areascene`] = () => ok({ AreaScenes: areaScenes[id] });
  }
  const devices = [];
  for (const area of load(`${dir}areas.json`).Body.Areas) {
    const id = area.href.split('/')[2];
    const stations = load(`${dir}area/${id}/controlstation.json`).Body?.ControlStations ?? [];
    for (const station of stations) {
      for (const ganged of station.AssociatedGangedDevices) devices.push(ganged.Device.href);
    }
  }
  for (const href of devices) {
    const id = href.split('/')[2];
    try {
      const group = load(`${dir}device/${id}/buttongroup.json`);
      const device = load(`${dir}device/${id}/device.json`);
      routes[`/device/${id}/buttongroup/expanded`] = () => group;
      routes[`/device/${id}`] = () => device;
      for (const button of group.Body.ButtonGroupsExpanded.flatMap((g) => g.Buttons ?? [])) {
        const led = button.AssociatedLED?.href;
        if (!led) continue;
        const ledId = led.split('/')[2];
        const status = () =>
          ok(
            {
              LEDStatus: { href: `${led}/status`, LED: { href: led }, State: leds[ledId] ?? 'Off' },
            },
            { MessageBodyType: 'OneLEDStatus' },
          );
        routes[`SubscribeRequest ${led}/status`] = status;
        routes[`ReadRequest ${led}/status`] = status;
        routes[`UpdateRequest ${led}/status`] = (request) => {
          leds[ledId] = request.Body.LEDStatus.State;
          return status();
        };
      }
    } catch {
      // Not a button device of the fixtures (dimmers, switches).
    }
  }
  return routes;
}

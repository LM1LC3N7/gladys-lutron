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

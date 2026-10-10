// The Caséta model, read from the pylutron-caseta responses through the fake
// bridge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeapConnection } from '../src/leap/connection.js';
import { KINDS } from '../src/leap/deviceTypes.js';
import { LeapClosedError, LeapStatusError, LeapTimeoutError } from '../src/leap/errors.js';
import { displayName, parseAreas, readListing, readOptional } from '../src/leap/model.js';
import { loadModel } from '../src/leap/system.js';
import { ok, startFakeBridge, status } from './helpers/fakeBridge.js';
import { casetaRoutes } from './helpers/pylutronBridge.js';
import { CREDENTIALS } from './helpers/tls.js';

const BRIDGE_INFO = {
  system: 'caseta',
  name: 'Smart Bridge',
  model: 'L-BDG2-WH',
  serial: '000004D2',
};

async function connect(t, routes) {
  const bridge = await startFakeBridge({ routes });
  t.after(() => bridge.close());
  const connection = new LeapConnection({
    host: bridge.host,
    port: bridge.port,
    credentials: CREDENTIALS,
    requestTimeoutMs: 300,
  });
  await connection.open();
  t.after(() => connection.close());
  return { bridge, connection };
}

test('displayName: the area first, never twice', () => {
  assert.equal(displayName('Salon', 'Plafonnier'), 'Salon Plafonnier');
  assert.equal(displayName('Salon', 'salon lampe'), 'salon lampe');
  assert.equal(displayName(null, 'Lampe'), 'Lampe');
});

test('parseAreas: ids, names, parents; malformed entries skipped', () => {
  const areas = parseAreas({
    Areas: [
      { href: '/area/1', Name: 'Home' },
      { href: '/area/2', Name: 'Salon', Parent: { href: '/area/1' } },
      { href: '/area/3' },
      { Name: 'no href' },
    ],
  });
  assert.equal(areas.size, 3);
  assert.deepEqual(areas.get('2'), { id: '2', name: 'Salon', parentId: '1' });
  assert.equal(areas.get('3').name, 'Area 3');
  assert.equal(parseAreas(null).size, 0);
});

test('readOptional: a missing or silent endpoint is null, a closed connection fails', async () => {
  const fail = (error) => ({
    read: async () => {
      throw error;
    },
  });
  assert.equal(
    await readOptional(fail(new LeapStatusError('/x', 404, '404 NotFound')), '/x'),
    null,
  );
  await assert.rejects(readOptional(fail(new LeapClosedError()), '/x'), LeapClosedError);
});

test('loadModel (Caséta): zones, occupancy groups, scenes, Smart Away, batteries', async (t) => {
  const { connection } = await connect(t, casetaRoutes());
  const model = await loadModel(connection, BRIDGE_INFO);

  assert.equal(model.system, 'caseta');
  assert.deepEqual(model.unknownTypes, []);
  const zones = Object.fromEntries(model.zones.map((zone) => [zone.id, zone]));
  assert.deepEqual(Object.keys(zones).sort(), ['1', '2', '3', '4', '6']);
  assert.equal(zones[1].kind, KINDS.DIMMER);
  assert.equal(zones[1].name, 'Hallway Lights');
  assert.equal(zones[1].serial, '00000929');
  assert.equal(zones[1].model, 'PD-6WCL-XX');
  assert.equal(zones[1].battery, false);
  assert.equal(zones[2].kind, KINDS.FAN);
  assert.equal(zones[3].kind, KINDS.TILT_BLIND);
  assert.equal(zones[4].kind, KINDS.TILT_BLIND);
  assert.equal(zones[6].kind, KINDS.SHADE);
  assert.equal(zones[6].battery, true, 'the QS wireless shade reports its battery');
  assert.equal(zones[3].battery, true);

  // Group 1 has no sensor: skipped. Group 2's sensor is not a known device
  // (no battery to read); group 3 with its two sensors.
  assert.deepEqual(
    model.occupancyGroups.map((g) => [g.id, g.name, g.sensorDeviceIds, g.battery]),
    [
      ['2', 'Living Room Occupancy', [], false],
      ['3', 'Master Bathroom Occupancy', ['4', '5'], true],
    ],
  );
  assert.equal(model.batteries.get('5'), true, 'sensor 5 is low');

  assert.deepEqual(
    model.buttonDevices.map((d) => [
      d.id,
      d.kind,
      d.name,
      d.buttons.map((b) => [b.id, b.name, b.raiseLower]),
    ]),
    [
      ['8', KINDS.REMOTE, 'Master Bathroom Pico', [['101', 'On', false]]],
      [
        '9',
        KINDS.REMOTE,
        'Living Room Blinds Remote',
        [
          ['102', 'All open', false],
          ['103', 'Group 1 open', false],
        ],
      ],
    ],
  );
  assert.ok(model.scenes.length > 0);
  assert.ok(model.scenes.every((scene) => scene.source === 'virtualbutton' && scene.name));
  assert.equal(model.smartAway, true);
  assert.equal(model.smartAwayEnabled, true);
});

test('loadModel (Caséta): a bare bridge (no scene, occupancy, Smart Away) and unknown types', async (t) => {
  const { connection } = await connect(t, {
    '/area': () => ok({ Areas: [{ href: '/area/2', Name: 'Salon' }] }),
    '/device': () =>
      ok({
        Devices: [
          { href: '/device/1', DeviceType: 'SmartBridge', SerialNumber: 1 },
          {
            href: '/device/3',
            Name: 'Plafonnier',
            DeviceType: 'DivaSmartDimmer',
            SerialNumber: 1234,
            LocalZones: [{ href: '/zone/1' }],
            AssociatedArea: { href: '/area/2' },
          },
          { href: '/device/4', Name: 'Grille-pain', DeviceType: 'Toaster' },
          { href: '/device/5', Name: 'Sans zone', DeviceType: 'WallDimmer' },
        ],
      }),
    '/virtualbutton': () => status('404 NotFound'),
    '/system/away/1/status': () => status('404 NotFound'),
  });
  const model = await loadModel(connection, BRIDGE_INFO);
  assert.deepEqual(
    model.zones.map((z) => [z.id, z.kind, z.name]),
    [['1', KINDS.DIMMER, 'Salon Plafonnier']],
  );
  assert.deepEqual(model.unknownTypes, ['Toaster']);
  assert.deepEqual(model.scenes, []);
  assert.deepEqual(model.occupancyGroups, []);
  assert.equal(model.smartAway, false);
  assert.equal(model.batteries.size, 0);
});

test('loadModel: /area and /device are required', async (t) => {
  const { connection } = await connect(t, { '/area': () => ok({ Areas: [] }) });
  await assert.rejects(loadModel(connection, BRIDGE_INFO), LeapStatusError);
});

test('readListing: absent on a status, a timeout retried once longer, then the load fails', async () => {
  const calls = [];
  const connection = (answers) => ({
    read: async (url, options) => {
      calls.push(options?.timeoutMs ?? null);
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  const timeout = () => new LeapTimeoutError('/button', 4000);
  assert.deepEqual(await readListing(connection([timeout(), { Buttons: [] }]), '/button'), {
    Buttons: [],
  });
  assert.deepEqual(calls, [null, 10_000]);
  await assert.rejects(
    readListing(connection([timeout(), timeout()]), '/button'),
    LeapTimeoutError,
  );
  assert.equal(
    await readListing(connection([new LeapStatusError('/x', 404, '404 NotFound')]), '/x'),
    null,
  );
  assert.equal(
    await readListing(connection([timeout(), new LeapStatusError('/x', 404, '404')]), '/x'),
    null,
  );
  await assert.rejects(readListing(connection([new LeapClosedError()]), '/x'), LeapClosedError);
});

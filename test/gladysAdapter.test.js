// The Gladys adapter, without a bridge: catalog, state publisher, commands,
// availability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS } from '../src/leap/deviceTypes.js';
import { createAvailability } from '../src/gladys/availability.js';
import { createCommandHandler } from '../src/gladys/commands.js';
import { buildCatalog, zoneValues } from '../src/gladys/devices.js';
import { createStatePublisher } from '../src/gladys/states.js';
import { createMemoryGladys, silentLogger } from './helpers/memoryGladys.js';

const zone = (id, kind, extra = {}) => ({
  id,
  kind,
  type: 'T',
  name: `Zone ${id}`,
  area: 'Salon',
  deviceId: `d${id}`,
  serial: null,
  model: null,
  whiteRange: null,
  battery: false,
  ...extra,
});

const MODEL = {
  system: 'caseta',
  bridge: { name: 'Smart Bridge', model: 'L-BDG2-WH', serial: 'ABCD0001', firmware: '08.25' },
  zones: [
    zone('1', KINDS.DIMMER, { serial: '00000929', model: 'DVRF-6L' }),
    zone('2', KINDS.SWITCH),
    zone('3', KINDS.FAN),
    zone('4', KINDS.SHADE, { battery: true }),
    zone('5', KINDS.TILT_BLIND),
    zone('6', KINDS.OPEN_CLOSE),
    zone('7', KINDS.DRAPE),
    zone('8', KINDS.CCO),
  ],
  buttonDevices: [],
  scenes: [{ id: '1', name: 'Soirée', source: 'virtualbutton', areaId: null, area: null }],
  occupancyGroups: [
    {
      id: '3',
      name: 'Salon Occupancy',
      area: 'Salon',
      sensorDeviceIds: ['s1', 's2'],
      battery: true,
    },
  ],
  smartAway: true,
  smartAwayEnabled: false,
  batteries: new Map(),
  unknownTypes: [],
};

const catalogOf = (gladys = createMemoryGladys()) =>
  buildCatalog(MODEL, {
    externalIds: (type, id) => gladys.externalIds(type, id),
    bridgeSerial: 'ABCD0001',
  });

test('catalog: one device per zone, occupancy group, scene, and the bridge', () => {
  const catalog = catalogOf();
  const ids = catalog.devices.map((d) => d.external_id);
  assert.deepEqual(ids, [
    'ext:ext-test-lutron:zone:00000929',
    'ext:ext-test-lutron:zone:ABCD0001-zone-2',
    'ext:ext-test-lutron:zone:ABCD0001-zone-3',
    'ext:ext-test-lutron:zone:ABCD0001-zone-4',
    'ext:ext-test-lutron:zone:ABCD0001-zone-5',
    'ext:ext-test-lutron:zone:ABCD0001-zone-6',
    'ext:ext-test-lutron:zone:ABCD0001-zone-7',
    'ext:ext-test-lutron:zone:ABCD0001-zone-8',
    'ext:ext-test-lutron:occupancy:ABCD0001-3',
    'ext:ext-test-lutron:scene:ABCD0001-scene-1',
    'ext:ext-test-lutron:bridge:ABCD0001',
  ]);
  const features = (index) => catalog.devices[index].features.map((f) => `${f.category}/${f.type}`);
  assert.deepEqual(features(0), ['light/binary', 'light/brightness']);
  assert.deepEqual(features(1), ['switch/binary']);
  assert.deepEqual(features(2), ['fan/percent']);
  assert.deepEqual(features(3), ['shutter/state', 'shutter/position', 'battery-low/binary']);
  assert.deepEqual(features(4), ['shutter/state', 'shutter/position']);
  assert.deepEqual(features(5), ['shutter/state']);
  assert.deepEqual(features(6), ['curtain/state', 'curtain/position']);
  assert.deepEqual(features(7), ['switch/binary']);
  assert.deepEqual(features(8), ['presence-sensor/binary', 'battery-low/binary']);
  assert.deepEqual(features(9), ['button/push']);
  assert.deepEqual(features(10), ['switch/binary']);

  const dimmer = catalog.devices[0];
  assert.equal(dimmer.name, 'Zone 1');
  assert.deepEqual(dimmer.params, [
    { name: 'LUTRON_AREA', value: 'Salon' },
    { name: 'LUTRON_TYPE', value: 'T' },
    { name: 'LUTRON_MODEL', value: 'DVRF-6L' },
    { name: 'GLADYS_TRANSPORT', value: 'local' },
  ]);
  assert.equal(catalog.devices[2].features[0].step, 25);
  assert.equal(catalog.devices[9].name, 'Scene Soirée');

  assert.deepEqual(catalog.targets.get('ext:ext-test-lutron:zone:00000929:on'), {
    action: 'on',
    zoneId: '1',
    kind: KINDS.DIMMER,
  });
  assert.equal(catalog.targets.get('ext:ext-test-lutron:zone:ABCD0001-zone-2:on').action, 'switch');
  assert.equal(catalog.targets.get('ext:ext-test-lutron:scene:ABCD0001-scene-1:push').sceneId, '1');
  assert.equal(catalog.smartAwayFeature, 'ext:ext-test-lutron:bridge:ABCD0001:smart-away');
  assert.deepEqual(catalog.batteryFeatures.get('s2'), [
    'ext:ext-test-lutron:occupancy:ABCD0001-3:battery-low',
  ]);
  assert.deepEqual(
    catalog.batterySources.get('ext:ext-test-lutron:occupancy:ABCD0001-3:battery-low'),
    ['s1', 's2'],
  );
});

test('zoneValues: what each kind publishes', () => {
  const keys = { on: 'on', brightness: 'b', position: 'p', speed: 's' };
  const state = (fields) => ({
    level: null,
    on: null,
    fanSpeed: null,
    tilt: null,
    ...fields,
  });
  assert.deepEqual(zoneValues(zone('1', KINDS.DIMMER), state({ level: 30 }), keys), [
    ['b', 30],
    ['on', 1],
  ]);
  assert.deepEqual(zoneValues(zone('1', KINDS.DIMMER), state({ level: 0 }), keys), [
    ['b', 0],
    ['on', 0],
  ]);
  assert.deepEqual(zoneValues(zone('1', KINDS.DIMMER), state({}), keys), []);
  assert.deepEqual(zoneValues(zone('2', KINDS.SWITCH), state({ level: 100 }), keys), [['on', 1]]);
  assert.deepEqual(zoneValues(zone('2', KINDS.CCO), state({ level: 100, on: false }), keys), [
    ['on', 0],
  ]);
  assert.deepEqual(zoneValues(zone('3', KINDS.FAN), state({ fanSpeed: 'MediumHigh' }), keys), [
    ['s', 75],
  ]);
  assert.deepEqual(zoneValues(zone('3', KINDS.FAN), state({ fanSpeed: '?' }), keys), []);
  assert.deepEqual(zoneValues(zone('4', KINDS.SHADE), state({ level: 60 }), keys), [['p', 60]]);
  assert.deepEqual(zoneValues(zone('5', KINDS.TILT_BLIND), state({ level: 1, tilt: 50 }), keys), [
    ['p', 50],
  ]);
  assert.deepEqual(zoneValues(zone('6', KINDS.OPEN_CLOSE), state({ level: 1 }), keys), []);
});

test('publisher: only created features, deduplicated, batched by 100', async () => {
  const devices = [{ features: Array.from({ length: 150 }, (_, i) => ({ external_id: `f${i}` })) }];
  const gladys = createMemoryGladys({ devices });
  const publisher = createStatePublisher({ gladys, logger: silentLogger });
  publisher.set('not-created', 1);
  for (let i = 0; i < 150; i += 1) publisher.set(`f${i}`, i);
  publisher.set('f0', 7); // the latest value wins
  await publisher.drain();
  const batches = gladys.callsOf('publishStates').map(([states]) => states.length);
  assert.deepEqual(batches, [100, 50]);
  assert.ok(!gladys.states().some(([id]) => id === 'not-created'));
  assert.deepEqual(gladys.states()[0], ['f0', 7]);

  publisher.set('f1', 1); // unchanged
  await publisher.drain();
  assert.equal(gladys.callsOf('publishStates').length, 2);
  publisher.set('f1', 2);
  await publisher.drain();
  assert.equal(gladys.callsOf('publishStates').length, 3);
  assert.equal(publisher.latest('not-created'), 1);
  publisher.close();
});

test('publisher: a budget per minute, the rest waits', async () => {
  let clock = 0;
  const devices = [{ features: Array.from({ length: 30 }, (_, i) => ({ external_id: `f${i}` })) }];
  const gladys = createMemoryGladys({ devices });
  const publisher = createStatePublisher({
    gladys,
    logger: silentLogger,
    limits: { perMinute: 10, flushDelayMs: 1 },
    now: () => clock,
  });
  for (let i = 0; i < 25; i += 1) publisher.set(`f${i}`, 1);
  await publisher.drain();
  assert.equal(gladys.states().length, 10);
  assert.equal(publisher.pending, 15);
  clock += 61_000;
  await publisher.drain();
  assert.equal(gladys.states().length, 20);
  publisher.close();
});

test('publisher: a failed batch is published again with the next change', async () => {
  const gladys = createMemoryGladys({ devices: [{ features: [{ external_id: 'f' }] }] });
  let fail = true;
  gladys.publishStates = async () => {
    if (fail) throw new Error('down');
    gladys.calls.push({
      name: 'publishStates',
      args: [[{ device_feature_external_id: 'f', state: 1 }]],
    });
    return { success: true };
  };
  const warnings = [];
  const publisher = createStatePublisher({ gladys, logger: { warn: (m) => warnings.push(m) } });
  publisher.set('f', 1);
  await publisher.drain();
  assert.match(warnings[0], /Could not publish 1 Lutron states: down/);
  fail = false;
  publisher.set('f', 1);
  await publisher.drain();
  assert.equal(gladys.states().length, 1);
  publisher.close();
});

test('publisher: replay after a device creation; events never deduplicated', async () => {
  const gladys = createMemoryGladys();
  const publisher = createStatePublisher({ gladys, logger: silentLogger });
  publisher.set('a', 3);
  await publisher.drain();
  assert.equal(gladys.states().length, 0, 'not created yet');
  gladys.devices = [{ features: [{ external_id: 'a' }, { external_id: 'btn' }] }];
  publisher.replay(['a', 'unknown']);
  await publisher.drain();
  assert.deepEqual(gladys.states(), [['a', 3]]);
  assert.equal(await publisher.publishEvent('btn', 1), true);
  assert.equal(await publisher.publishEvent('btn', 1), true);
  assert.equal(await publisher.publishEvent('nope', 1), false);
  publisher.replay(['btn']);
  await publisher.drain();
  assert.equal(gladys.states().length, 3, 'a press is never replayed');
  assert.deepEqual(gladys.states().slice(1), [
    ['btn', 1],
    ['btn', 1],
  ]);
  publisher.reset();
  publisher.set('a', 3);
  await publisher.drain();
  assert.equal(gladys.states().length, 4, 'published again after reset');
  gladys.publishState = async () => {
    throw new Error('down');
  };
  assert.equal(await publisher.publishEvent('btn', 2), false);
  publisher.close();
});

function fakeSystem() {
  const calls = [];
  const system = { ready: true, calls };
  for (const name of [
    'turnOn',
    'setLevel',
    'setFan',
    'setTilt',
    'move',
    'setSmartAwayEnabled',
    'activateScene',
  ]) {
    system[name] = async (...args) => {
      calls.push([name, ...args]);
    };
  }
  return system;
}

test('commands: each feature to its LEAP command', async () => {
  const gladys = createMemoryGladys();
  const catalog = catalogOf(gladys);
  const system = fakeSystem();
  const published = [];
  const setValue = createCommandHandler({
    system,
    catalog: () => catalog,
    fadeSeconds: () => 2,
    publisher: { set: (id, value) => published.push([id, value]) },
  });
  const f = (device, key) => ({ external_id: `ext:ext-test-lutron:${device}:${key}` });

  await setValue({}, f('zone:00000929', 'on'), 1);
  await setValue({}, f('zone:00000929', 'on'), 0);
  await setValue({}, f('zone:00000929', 'brightness'), '55');
  await setValue({}, f('zone:ABCD0001-zone-2', 'on'), 1);
  await setValue({}, f('zone:ABCD0001-zone-3', 'speed'), 50);
  await setValue({}, f('zone:ABCD0001-zone-4', 'position'), 30);
  await setValue({}, f('zone:ABCD0001-zone-5', 'position'), 30);
  await setValue({}, f('zone:ABCD0001-zone-4', 'state'), 1);
  await setValue({}, f('zone:ABCD0001-zone-4', 'state'), 0);
  await setValue({}, f('zone:ABCD0001-zone-6', 'state'), -1);
  await setValue({}, f('zone:ABCD0001-zone-5', 'state'), 1);
  await setValue({}, f('zone:ABCD0001-zone-5', 'state'), -1);
  await setValue({}, f('zone:ABCD0001-zone-5', 'state'), 0);
  await setValue({}, f('bridge:ABCD0001', 'smart-away'), 1);
  await setValue({}, f('scene:ABCD0001-scene-1', 'push'), 1);

  assert.deepEqual(system.calls, [
    ['turnOn', '1', 2],
    ['setLevel', '1', 0, 2],
    ['setLevel', '1', 55, 2],
    ['setLevel', '2', 100],
    ['setFan', '3', 50],
    ['setLevel', '4', 30],
    ['setTilt', '5', 30],
    ['move', '4', 'Raise'],
    ['move', '4', 'Stop'],
    ['move', '6', 'Lower'],
    ['setTilt', '5', 50],
    ['setTilt', '5', 0],
    ['move', '5', 'Stop'],
    ['setSmartAwayEnabled', true],
    ['activateScene', '1'],
  ]);
  assert.deepEqual(published.slice(0, 2), [
    ['ext:ext-test-lutron:zone:ABCD0001-zone-4:position', 100],
    ['ext:ext-test-lutron:zone:ABCD0001-zone-4:state', 1],
  ]);

  await assert.rejects(setValue({}, f('zone:x', 'on'), 1), /Refresh the devices/);
  await assert.rejects(setValue({}, f('zone:00000929', 'on'), 'abc'), /Invalid value/);
  system.ready = false;
  await assert.rejects(setValue({}, f('zone:00000929', 'on'), 1), /not connected/);
});

test('availability: offline after the delay, once; online once; reset forgets', async () => {
  const transports = [];
  const events = [];
  let clock = 1000;
  const availability = createAvailability({
    offlineAfterMs: 20,
    now: () => clock,
    reason: () => 'unreachable',
    bridgeName: () => 'Smart Bridge',
    onTransports: (offline) => transports.push(offline),
    onEvent: (key, data) => events.push([key, data]),
  });
  availability.online(); // start-up: nothing
  availability.lost();
  availability.online(); // back within the delay: nothing
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(events, []);

  availability.lost();
  availability.lost();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(availability.reportedOffline, true);
  availability.lost();
  clock += 125_000;
  availability.online();
  assert.deepEqual(transports, [true, false]);
  assert.deepEqual(events, [
    ['offline', { bridge_name: 'Smart Bridge', reason: 'unreachable' }],
    ['online', { bridge_name: 'Smart Bridge', offline_seconds: 125 }],
  ]);

  availability.lost();
  availability.reset();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(events.length, 2);
});

test('catalog: a serial shared by two devices or with the bridge identifies neither', () => {
  const gladys = createMemoryGladys();
  const catalog = buildCatalog(
    {
      ...MODEL,
      zones: [
        zone('1', KINDS.DIMMER, { serial: 'AAAA0001' }),
        zone('2', KINDS.DIMMER, { serial: 'AAAA0001' }),
        zone('3', KINDS.SHADE, { serial: 'ABCD0001' }),
        zone('4', KINDS.SHADE, { serial: 'AAAA0004' }),
      ],
      occupancyGroups: [],
      scenes: [],
      smartAway: false,
    },
    { externalIds: (type, id) => gladys.externalIds(type, id), bridgeSerial: 'ABCD0001' },
  );
  assert.deepEqual(
    catalog.devices.map((d) => d.external_id.split(':').at(-1)),
    ['ABCD0001-zone-1', 'ABCD0001-zone-2', 'ABCD0001-zone-3', 'AAAA0004'],
  );
});

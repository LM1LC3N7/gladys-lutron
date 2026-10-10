// The live Lutron system against the fake bridge serving the pylutron-caseta
// responses: load, states, unsolicited updates, commands, resync, close.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeapConnection } from '../src/leap/connection.js';
import { BridgeOfflineError } from '../src/leap/errors.js';
import { LutronSystem } from '../src/leap/system.js';
import { ok, startFakeBridge } from './helpers/fakeBridge.js';
import { casetaRoutes } from './helpers/pylutronBridge.js';
import { CREDENTIALS } from './helpers/tls.js';
import { waitFor } from './helpers/waitFor.js';

const BRIDGE_INFO = { system: 'caseta', name: 'Smart Bridge', serial: '000004D2' };

async function setup(t, { routes = casetaRoutes(), timings, logger } = {}) {
  const bridge = await startFakeBridge({ routes });
  t.after(() => bridge.close());
  const open = async () => {
    const connection = new LeapConnection({
      host: bridge.host,
      port: bridge.port,
      credentials: CREDENTIALS,
      requestTimeoutMs: 500,
    });
    await connection.open();
    t.after(() => connection.close());
    return connection;
  };
  const system = new LutronSystem({ timings, logger });
  t.after(() => system.detach());
  const events = [];
  for (const name of ['model', 'zone', 'occupancy', 'smartAway', 'battery', 'offline']) {
    system.on(name, (...args) => events.push([name, ...args]));
  }
  return { bridge, open, system, events };
}

test('attach: the model first, then every state read', async (t) => {
  const { open, system, events } = await setup(t);
  const connection = await open();
  await system.attach(connection, BRIDGE_INFO);

  assert.equal(system.ready, true);
  assert.equal(events[0][0], 'model');
  const zone = (id) => events.find(([name, z]) => name === 'zone' && z.id === id)?.[2];
  assert.equal(zone('1').level, 40);
  assert.equal(zone('2').fanSpeed, 'Medium');
  assert.equal(zone('3').tilt, 25);
  assert.equal(zone('6').level, 100);
  const occupancy = Object.fromEntries(
    events
      .filter(([name]) => name === 'occupancy')
      .map(([, group, occupied]) => [group.id, occupied]),
  );
  assert.deepEqual(occupancy, { 2: true, 3: false });
  assert.deepEqual(
    events.filter(([name]) => name === 'smartAway').map(([, enabled]) => enabled),
    [true],
  );
  assert.ok(events.some(([name, deviceId, low]) => name === 'battery' && deviceId === '5' && low));
});

test('unsolicited zone statuses after the load are emitted; merged with the known state', async (t) => {
  const { bridge, open, system, events } = await setup(t);
  const connection = await open();
  await system.attach(connection, BRIDGE_INFO);
  events.length = 0;

  bridge.broadcast({
    CommuniqueType: 'ReadResponse',
    Header: { MessageBodyType: 'OneZoneStatus', StatusCode: '200 OK', Url: '/zone/1/status' },
    Body: { ZoneStatus: { Level: 0, Zone: { href: '/zone/1' } } },
  });
  bridge.broadcast({
    CommuniqueType: 'ReadResponse',
    Header: { StatusCode: '200 OK' },
    Body: { ZoneStatus: { Level: 10, Zone: { href: '/zone/99' } } },
  });
  await waitFor(() => events.length >= 1);
  const [name, zone, state] = events[0];
  assert.equal(name, 'zone');
  assert.equal(zone.id, '1');
  assert.equal(state.level, 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(events.length, 1, 'an unknown zone is ignored');
});

test('a status received while the model loads is only applied, emitted after the model', async (t) => {
  const routes = casetaRoutes();
  const device = routes['/device'];
  let bridgeRef;
  routes['/device'] = (request, client) => {
    client.send({
      CommuniqueType: 'ReadResponse',
      Header: { StatusCode: '200 OK' },
      Body: { AwayStatus: { EnabledState: 'Disabled' } },
    });
    return device(request);
  };
  const { bridge, open, system, events } = await setup(t, { routes });
  bridgeRef = bridge;
  const connection = await open();
  await system.attach(connection, BRIDGE_INFO);
  assert.ok(bridgeRef);
  assert.equal(events[0][0], 'model');
  // The subscription answer (Enabled) came after the early Disabled.
  assert.deepEqual(
    events.filter(([name]) => name === 'smartAway').map(([, enabled]) => enabled),
    [true],
  );
});

test('commands: the LEAP bodies, "on" at the last level, the answer applied', async (t) => {
  const routes = {
    ...casetaRoutes(),
    'CreateRequest /virtualbutton/1/commandprocessor': () => ({
      CommuniqueType: 'CreateResponse',
      Header: { StatusCode: '201 Created' },
    }),
    'UpdateRequest /system/away/1/status': (request) =>
      ok({ AwayStatus: { EnabledState: request.Body.AwayStatus.EnabledState } }),
  };
  const { bridge, open, system, events } = await setup(t, { routes });
  const connection = await open();
  await system.attach(connection, BRIDGE_INFO);
  const last = (url) => bridge.requestsTo(url).at(-1).Body.Command;

  await system.setLevel('1', 0, 3);
  assert.deepEqual(last('/zone/1/commandprocessor'), {
    CommandType: 'GoToDimmedLevel',
    DimmedLevelParameters: { Level: 0, FadeTime: '00:00:03' },
  });
  assert.equal(system.zones.get('1').level, 0, 'the answer carried the new level');
  await system.turnOn('1');
  assert.deepEqual(last('/zone/1/commandprocessor').Parameter, [{ Type: 'Level', Value: 40 }]);
  await system.setFan('2', 75);
  assert.equal(last('/zone/2/commandprocessor').FanSpeedParameters.FanSpeed, 'MediumHigh');
  await system.move('6', 'Lower');
  assert.deepEqual(last('/zone/6/commandprocessor'), { CommandType: 'Lower' });
  await system.setTilt('3', 50);
  assert.deepEqual(last('/zone/3/commandprocessor'), {
    CommandType: 'GoToTilt',
    TiltParameters: { Tilt: 50 },
  });
  await system.activateScene('1');
  assert.deepEqual(last('/virtualbutton/1/commandprocessor'), { CommandType: 'PressAndRelease' });
  await system.setSmartAwayEnabled(false);
  assert.deepEqual(bridge.requestsTo('/system/away/1/status').at(-1).Body, {
    AwayStatus: { EnabledState: 'Disabled' },
  });
  assert.equal(events.at(-1)[0], 'smartAway');
  assert.equal(events.at(-1)[1], false);

  await assert.rejects(system.setLevel('999', 10), /Unknown Lutron zone 999/);
  await assert.rejects(system.activateScene('999'), /Unknown Lutron scene 999/);
  await assert.rejects(system.setFan('999', 10), /Unknown Lutron zone/);
});

test('a closed connection: offline once, commands refused', async (t) => {
  const { bridge, open, system, events } = await setup(t);
  assert.throws(() => system.requireConnection(), BridgeOfflineError);
  const connection = await open();
  await system.attach(connection, BRIDGE_INFO);
  bridge.dropClients();
  await waitFor(() => events.some(([name]) => name === 'offline'));
  assert.equal(system.ready, false);
  await assert.rejects(system.setLevel('1', 10), BridgeOfflineError);
  assert.equal(events.filter(([name]) => name === 'offline').length, 1);
});

test('resync: every zone status read again, only changes emitted downstream', async (t) => {
  const { bridge, open, system, events } = await setup(t, { timings: { resyncIntervalMs: 30 } });
  const connection = await open();
  await system.attach(connection, BRIDGE_INFO);
  const reads = () => bridge.requestsTo('/zone/1/status').length;
  const before = reads();
  await waitFor(() => reads() >= before + 2, { what: 'two resyncs' });
  assert.ok(bridge.requestsTo('/device/7/status').length >= 2, 'batteries read again');
  assert.ok(events.filter(([name]) => name === 'zone').length > 5);
});

test('unknown device types are logged once, not at every reconnection', async (t) => {
  const infos = [];
  const logger = { debug() {}, info: (m) => infos.push(m), warn() {} };
  const routes = {
    '/area': () => ok({ Areas: [] }),
    '/device': () => ok({ Devices: [{ href: '/device/4', DeviceType: 'Toaster' }] }),
  };
  const { open, system } = await setup(t, { routes, logger });
  await system.attach(await open(), BRIDGE_INFO);
  await system.attach(await open(), BRIDGE_INFO);
  assert.equal(infos.filter((m) => m.includes('Toaster')).length, 1);
});

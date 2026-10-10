// The whole adapter in-process: configuration -> connection -> Discover tab,
// states of the created devices, transports, offline / online scene events.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeapSession } from '../src/leap/session.js';
import { createLutronIntegration } from '../src/gladys/integration.js';
import { ok, startFakeBridge } from './helpers/fakeBridge.js';
import { createMemoryGladys, silentLogger } from './helpers/memoryGladys.js';
import { casetaRoutes } from './helpers/pylutronBridge.js';
import { CREDENTIALS } from './helpers/tls.js';
import { waitFor } from './helpers/waitFor.js';

const PAIRED = {
  bridge_host: '127.0.0.1',
  leap_key: CREDENTIALS.key,
  leap_cert: CREDENTIALS.cert,
  leap_ca: CREDENTIALS.ca,
};

export async function startIntegration(t, { routes = casetaRoutes(), devices, options = {} } = {}) {
  const bridge = await startFakeBridge({
    routes: {
      ...routes,
      '/device?where=IsThisDevice:true': () =>
        ok({ Devices: [{ Name: 'Smart Bridge', ModelNumber: 'L-BDG2-WH', SerialNumber: 1234 }] }),
    },
  });
  t.after(() => bridge.close());
  const gladys = createMemoryGladys({ config: { ...PAIRED }, devices });
  const lutron = createLutronIntegration({
    gladys,
    logger: silentLogger,
    version: 'test',
    ports: { leap: bridge.port },
    controllerOptions: {
      createSession: (o) =>
        new LeapSession({
          ...o,
          connectionOptions: { ...o.connectionOptions, requestTimeoutMs: 150 },
          timings: { reconnectMinMs: 20, reconnectMaxMs: 40 },
        }),
    },
    publisherLimits: { flushDelayMs: 1 },
    offlineAfterMs: 60,
    ...options,
  });
  t.after(() => lutron.close());
  await lutron.applyConfig(gladys.config);
  await waitFor(() => lutron.system.ready, { what: 'the model' });
  return { bridge, gladys, lutron };
}

test('connected: the project in the Discover tab, states once the devices are created', async (t) => {
  const { gladys, lutron } = await startIntegration(t);
  const [devices] = gladys.callsOf('publishDiscoveredDevices').at(-1);
  assert.equal(devices.length, 5 + 2 + 2 + lutron.system.model.scenes.length + 1);
  assert.equal(gladys.states().length, 0, 'nothing created yet');

  for (const device of gladys.createAll()) await lutron.onDeviceCreated(device);
  await lutron.publisher.drain();
  const states = new Map(gladys.states());
  const id = (suffix) => `ext:ext-test-lutron:${suffix}`;
  assert.equal(states.get(id('zone:00000929:brightness')), 40);
  assert.equal(states.get(id('zone:00000929:on')), 1);
  assert.equal(states.get(id('zone:00000D80:speed')), 50, 'fan at Medium');
  assert.equal(states.get(id('occupancy:000004D2-2:occupancy')), 1);
  assert.equal(states.get(id('occupancy:000004D2-3:occupancy')), 0);
  assert.equal(states.get(id('occupancy:000004D2-3:battery-low')), 1, 'sensor 5 is low');
  assert.equal(states.get(id('bridge:000004D2:smart-away')), 1);
  const transports = gladys.callsOf('publishTransports').flatMap(([entries]) => entries);
  assert.ok(transports.length >= devices.length);
  assert.ok(transports.every((entry) => entry.transport === 'local'));

  // A scan publishes the same list again.
  await lutron.onScanRequest();
  assert.equal(gladys.callsOf('publishDiscoveredDevices').length, 2);
});

test('bridge lost: offline after the delay, then back online, with the badges', async (t) => {
  const { bridge, gladys, lutron } = await startIntegration(t);
  for (const device of gladys.createAll()) await lutron.onDeviceCreated(device);
  bridge.silence();
  bridge.dropClients();
  await waitFor(() => gladys.callsOf('publishSceneEvent').length === 1, { what: 'offline' });
  const [key, data] = gladys.callsOf('publishSceneEvent')[0];
  assert.equal(key, 'bridge_offline');
  assert.equal(data.bridge_name, 'Smart Bridge (L-BDG2-WH)');
  assert.ok(data.reason.length > 0);
  assert.ok(
    gladys
      .callsOf('publishTransports')
      .at(-1)[0]
      .every((entry) => entry.transport === 'unreachable'),
  );
  await assert.rejects(
    lutron.onSetValue({}, { external_id: 'ext:ext-test-lutron:zone:00000929:on' }, 1),
    /not connected/,
  );

  bridge.silence(false);
  await waitFor(() => gladys.callsOf('publishSceneEvent').length === 2, { what: 'online' });
  const [onlineKey, onlineData] = gladys.callsOf('publishSceneEvent')[1];
  assert.equal(onlineKey, 'bridge_online');
  assert.equal(typeof onlineData.offline_seconds, 'number');
  assert.ok(
    gladys
      .callsOf('publishTransports')
      .at(-1)[0]
      .every((entry) => entry.transport === 'local'),
  );
});

test('forgetting the bridge is not an outage', async (t) => {
  const { gladys, lutron } = await startIntegration(t);
  await lutron.bridge.forget();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(gladys.callsOf('publishSceneEvent').length, 0);
});

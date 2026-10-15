// The whole adapter in-process: configuration -> connection -> Discover tab,
// states of the created devices, transports, offline / online scene events.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES } from '../src/gladys/messages.js';
import { PAIRED, startIntegration } from './helpers/integration.js';
import { waitFor } from './helpers/waitFor.js';

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

test('hidden device types: left out of the Discover tab, created ones keep working', async (t) => {
  const { bridge, gladys, lutron } = await startIntegration(t);
  const all = gladys.callsOf('publishDiscoveredDevices').at(-1)[0];
  for (const device of gladys.createAll()) await lutron.onDeviceCreated(device);
  await lutron.applyConfig({ ...gladys.config, hidden_device_types: ['remotes', 'scenes'] });
  const shown = gladys.callsOf('publishDiscoveredDevices').at(-1)[0];
  assert.equal(shown.length, all.length - 2 - lutron.system.model.scenes.length);
  assert.ok(!shown.some((device) => /:remote:|:scene:/.test(device.external_id)));
  await lutron.onScanRequest();
  assert.equal(gladys.callsOf('publishDiscoveredDevices').at(-1)[0].length, shown.length);
  const calls = gladys.callsOf('publishDiscoveredDevices').length;
  await lutron.applyConfig({ ...gladys.config, hidden_device_types: ['scenes', 'remotes'].sort() });
  assert.equal(gladys.callsOf('publishDiscoveredDevices').length, calls, 'unchanged: no republish');
  await lutron.onSetValue({}, { external_id: 'ext:ext-test-lutron:zone:00000929:on' }, 0);
  assert.equal(bridge.requestsTo('/zone/1/commandprocessor').length, 1);
});

test('"Refresh the devices" on a silent bridge: the system goes offline (review finding)', async (t) => {
  const { bridge, lutron } = await startIntegration(t);
  bridge.silence();
  await lutron.bridge.refresh();
  assert.equal(lutron.system.ready, false, 'never "ready" on a closed connection');
  await assert.rejects(
    lutron.onSetValue({}, { external_id: 'ext:ext-test-lutron:zone:00000929:on' }, 1),
    /not connected/,
  );
});

test('forgetting the bridge during an outage cancels the offline report', async (t) => {
  const { bridge, gladys, lutron } = await startIntegration(t);
  bridge.silence();
  bridge.dropClients();
  await waitFor(() => !lutron.system.ready);
  await lutron.bridge.forget();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(gladys.callsOf('publishSceneEvent').length, 0);
});

test('paired from the configuration screen: the widget knows it without a restart (hardware finding)', async (t) => {
  // setConfig does not echo a config-updated: Gladys sends the new values
  // back only when the container reconnects.
  const { gladys, lutron } = await startIntegration(t, {
    config: { bridge_host: '127.0.0.1' },
    options: {
      controllerOptions: {
        pair: async () => ({
          key: PAIRED.leap_key,
          cert: PAIRED.leap_cert,
          ca: PAIRED.leap_ca,
          leapVersion: '1.124',
          processor: false,
        }),
      },
    },
  });
  const notPaired = () => lutron.getOverview().components[0].text === MESSAGES.notPaired;
  assert.ok(notPaired());
  await lutron.bridge.pairAction();
  await waitFor(() => lutron.system.ready, { what: 'the model' });
  assert.equal(lutron.config.credentials, null, 'not echoed by Gladys');
  assert.ok(!notPaired(), 'the widget shows the bridge');
  assert.ok(gladys.callsOf('publishDiscoveredDevices').at(-1)[0].length > 0);

  await lutron.bridge.forget();
  assert.ok(notPaired(), 'forgotten: back to "not paired", still no echo');
});

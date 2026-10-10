// Milestone 8: a long run against the fake bridge. Many reconnections with a
// full model reload each time must not leak timers, listeners, connections
// or pending requests, and must keep the states flowing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startIntegration } from './helpers/integration.js';
import { waitFor } from './helpers/waitFor.js';

const CYCLES = 25;

const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

test(`${CYCLES} reconnections: no leak, states still published`, async (t) => {
  const { bridge, gladys, lutron } = await startIntegration(t, {
    options: { systemOptions: { timings: { resyncIntervalMs: 15 } } },
  });
  for (const device of gladys.createAll()) await lutron.onDeviceCreated(device);
  const reloads = () => gladys.callsOf('publishDiscoveredDevices').length;

  const cycle = async () => {
    const before = reloads();
    bridge.dropClients();
    await waitFor(() => reloads() > before && lutron.system.ready, {
      what: 'the reload',
      timeoutMs: 5000,
    });
  };
  for (let i = 0; i < 5; i += 1) await cycle();
  const baseline = {
    timers: timers(),
    systemListeners: lutron.system.eventNames().map((e) => lutron.system.listenerCount(e)),
  };
  for (let i = 5; i < CYCLES; i += 1) await cycle();

  assert.ok(timers() <= baseline.timers + 2, `timers ${timers()} vs ${baseline.timers}`);
  assert.deepEqual(
    lutron.system.eventNames().map((e) => lutron.system.listenerCount(e)),
    baseline.systemListeners,
  );
  assert.equal(bridge.state.clients.size, 1, 'one live connection');
  const connection = lutron.bridge.session.connection;
  assert.equal(connection.pending.size, 0);
  assert.equal(connection.listenerCount('unsolicited'), 2, 'session + system');
  assert.equal(connection.listenerCount('close'), 2, 'session + system');

  // Still alive: a status from the bridge reaches Gladys.
  bridge.broadcast({
    CommuniqueType: 'ReadResponse',
    Header: { StatusCode: '200 OK' },
    Body: { ZoneStatus: { Level: 12, Zone: { href: '/zone/1' } } },
  });
  await waitFor(() =>
    gladys
      .states()
      .some(([id, value]) => id === 'ext:ext-test-lutron:zone:00000929:brightness' && value === 12),
  );
  assert.ok(bridge.requestsTo('/zone/1/status').length > CYCLES, 'resync and reloads read again');
});

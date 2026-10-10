// End to end: the real index.js, in a child process, against a fake Gladys
// and a fake Lutron bridge. Catches the wiring mistakes the unit tests cannot
// see (a handler not registered, a scan nobody answers).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ok, startFakeBridge } from './helpers/fakeBridge.js';
import { startFakeGladys } from './helpers/fakeGladys.js';
import { casetaRoutes } from './helpers/pylutronBridge.js';
import { CREDENTIALS } from './helpers/tls.js';
import { waitFor } from './helpers/waitFor.js';

const WAIT = { timeoutMs: 8000 };
const SELECTOR = 'ext-lm1lc3n7-gladys-lutron';
// The Hallway dimmer of the pylutron fixtures (serial 2345 = 0x929, zone 1).
const DIMMER = `ext:${SELECTOR}:zone:00000929`;

test('index.js: connection status, scan, actions, clean shutdown', async (t) => {
  const bridge = await startFakeBridge({
    routes: {
      ...casetaRoutes(),
      '/device?where=IsThisDevice:true': () =>
        ok({
          Devices: [{ Name: 'Smart Bridge', ModelNumber: 'L-BDG2-WH', SerialNumber: 19114957 }],
        }),
    },
  });
  t.after(() => bridge.close());
  const gladys = await startFakeGladys({
    config: {
      bridge_host: '127.0.0.1',
      leap_key: CREDENTIALS.key,
      leap_cert: CREDENTIALS.cert,
      leap_ca: CREDENTIALS.ca,
    },
    devices: [
      {
        external_id: DIMMER,
        features: [{ external_id: `${DIMMER}:on` }, { external_id: `${DIMMER}:brightness` }],
      },
    ],
  });
  t.after(() => gladys.close());

  const child = spawn(process.execPath, ['index.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      GLADYS_HOST_API_URL: gladys.url,
      GLADYS_INTEGRATION_TOKEN: 'test-token',
      GLADYS_INTEGRATION_SELECTOR: SELECTOR,
      LUTRON_LEAP_PORT: String(bridge.port),
      LUTRON_PAIRING_PORT: '1',
      LOG_LEVEL: 'debug',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  t.after(() => child.kill('SIGKILL'));
  const step = async (what, condition) => {
    try {
      await waitFor(condition, { ...WAIT, what });
    } catch (err) {
      throw new Error(`${err.message}\n--- integration output ---\n${output}`, { cause: err });
    }
  };
  const lastStatus = () => gladys.posts('/connection_status').at(-1)?.body;

  // 1. Paired configuration: connected, the bridge named in the status.
  await step('the connected status', () => lastStatus()?.connected === true);
  assert.match(
    lastStatus().message.en,
    /Connected to Smart Bridge \(L-BDG2-WH\) at 127\.0\.0\.1, LEAP 1\.123/,
  );
  assert.equal(gladys.config.bridge_serial, '0123ABCD', 'the serial read from the bridge is saved');

  // 2. The project is published to the Discover tab, the states of the
  // created dimmer follow, and a scan publishes the list again.
  await step('the discovered devices', () => gladys.posts('/discovered_device').length === 1);
  const discovered = gladys.posts('/discovered_device')[0].body.devices;
  assert.ok(
    discovered.some((device) => device.external_id === DIMMER && device.name === 'Hallway Lights'),
  );
  await step('the dimmer states', () =>
    gladys
      .posts('/state')
      .some((post) =>
        post.body.states.some(
          (s) => s.device_feature_external_id === `${DIMMER}:brightness` && s.state === 40,
        ),
      ),
  );
  gladys.send('scan-request');
  await step('the discovery answer', () => gladys.posts('/discovered_device').length === 2);

  // 3. A command from Gladys becomes a LEAP command.
  const command = await gladys.command('device.set-value', {
    device: { external_id: DIMMER },
    device_feature: { external_id: `${DIMMER}:brightness` },
    value: 75,
  });
  assert.equal(command.success, true, command.error);
  const sent = bridge.requestsTo('/zone/1/commandprocessor').at(-1);
  assert.deepEqual(sent.Body.Command, {
    CommandType: 'GoToLevel',
    Parameter: [{ Type: 'Level', Value: 75 }],
  });

  // 4. Configuration actions.
  const test1 = await gladys.command('action.run', { key: 'test_connection', fields: {} });
  assert.equal(test1.success, true, test1.error);
  assert.match(test1.data.message.en, /Connected to Smart Bridge/);
  const forget = await gladys.command('action.run', { key: 'forget_bridge', fields: {} });
  assert.match(forget.data.message.fr, /association a été supprimée/);
  assert.equal(gladys.config.leap_key, '');
  const pair = await gladys.command('action.run', { key: 'pair_bridge', fields: {} }, 20_000);
  assert.equal(pair.success, true, pair.error);
  assert.match(pair.data.message.en, /does not answer at 127\.0\.0\.1/);

  // 5. Diagnostics: an anonymized dump between markers in the logs.
  const diagnostics = await gladys.command(
    'action.run',
    { key: 'diagnostics', fields: {} },
    20_000,
  );
  assert.equal(diagnostics.success, true, diagnostics.error);
  assert.match(diagnostics.data.message.fr, /journaux/i);
  await step('the diagnostics end marker', () => output.includes('LUTRON DIAGNOSTICS END'));
  const dump = output.slice(
    output.indexOf('LUTRON DIAGNOSTICS BEGIN'),
    output.indexOf('LUTRON DIAGNOSTICS END'),
  );
  assert.match(dump, /"paired":false/, 'the bridge was forgotten above');

  // 6. A clean shutdown, and no secret in the logs.
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
  assert.ok(!output.includes('PRIVATE KEY'), 'no private key in the logs');
  assert.ok(!output.includes('BEGIN CERTIFICATE'), 'no certificate in the logs');
});

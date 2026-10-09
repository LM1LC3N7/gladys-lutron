// End to end: the real index.js, in a child process, against a fake Gladys
// and a fake Lutron bridge. Catches the wiring mistakes the unit tests cannot
// see (a handler not registered, a scan nobody answers).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ok, startFakeBridge } from './helpers/fakeBridge.js';
import { startFakeGladys } from './helpers/fakeGladys.js';
import { CREDENTIALS } from './helpers/tls.js';
import { waitFor } from './helpers/waitFor.js';

const WAIT = { timeoutMs: 8000 };

test('index.js: connection status, scan, actions, clean shutdown', async (t) => {
  const bridge = await startFakeBridge({
    routes: {
      '/project': () => ok({ Project: { ProductType: 'Lutron Smart Bridge Project' } }),
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
  });
  t.after(() => gladys.close());

  const child = spawn(process.execPath, ['index.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      GLADYS_HOST_API_URL: gladys.url,
      GLADYS_INTEGRATION_TOKEN: 'test-token',
      GLADYS_INTEGRATION_SELECTOR: 'ext-lm1lc3n7-gladys-lutron',
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

  // 2. A scan is always answered.
  gladys.send('scan-request');
  await step('the discovery answer', () => gladys.posts('/discovered_device').length === 1);

  // 3. Configuration actions.
  const test1 = await gladys.command('action.run', { key: 'test_connection', fields: {} });
  assert.equal(test1.success, true, test1.error);
  assert.match(test1.data.message.en, /Connected to Smart Bridge/);
  const forget = await gladys.command('action.run', { key: 'forget_bridge', fields: {} });
  assert.match(forget.data.message.fr, /association a été supprimée/);
  assert.equal(gladys.config.leap_key, '');
  const pair = await gladys.command('action.run', { key: 'pair_bridge', fields: {} }, 20_000);
  assert.equal(pair.success, true, pair.error);
  assert.match(pair.data.message.en, /does not answer at 127\.0\.0\.1/);

  // 4. A clean shutdown, and no secret in the logs.
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
  assert.ok(!output.includes('PRIVATE KEY'), 'no private key in the logs');
  assert.ok(!output.includes('BEGIN CERTIFICATE'), 'no certificate in the logs');
});

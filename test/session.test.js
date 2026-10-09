import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeapSession, SESSION_STATES } from '../src/leap/session.js';
import { BridgeClosedEarlyError, CertificateRefusedError } from '../src/leap/errors.js';
import { ok, startFakeBridge } from './helpers/fakeBridge.js';
import { CREDENTIALS, TLS } from './helpers/tls.js';
import { waitFor } from './helpers/waitFor.js';

const FAST = {
  pingIntervalMs: 60,
  pingTimeoutMs: 80,
  reconnectMinMs: 20,
  reconnectMaxMs: 80,
  readyTimeoutMs: 300,
};

const createSession = (bridge, options = {}) =>
  new LeapSession({
    host: bridge.host,
    credentials: CREDENTIALS,
    timings: FAST,
    connectionOptions: { port: bridge.port, requestTimeoutMs: 200, connectTimeoutMs: 500 },
    ...options,
  });

test('connects, reads the LEAP version, then runs onReady with the connection', async (t) => {
  const bridge = await startFakeBridge({
    routes: { '/project': () => ok({ Project: { ProductType: 'Lutron Smart Bridge Project' } }) },
  });
  t.after(() => bridge.close());
  let project;
  const session = createSession(bridge, {
    onReady: async (connection) => {
      project = await connection.read('/project');
    },
  });
  t.after(() => session.stop());
  const states = [];
  session.on('status', (s) => states.push(s.state));
  session.start();
  await waitFor(() => session.connected);
  assert.equal(session.leapVersion, '1.123');
  assert.equal(project.Project.ProductType, 'Lutron Smart Bridge Project');
  assert.deepEqual(states, [SESSION_STATES.CONNECTING, SESSION_STATES.CONNECTED]);
});

test('reconnects after a bridge reboot and runs onReady again (subscriptions restored)', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  let readies = 0;
  const session = createSession(bridge, { onReady: async () => void (readies += 1) });
  t.after(() => session.stop());
  const disconnections = [];
  session.on('disconnected', (error) => disconnections.push(error));
  session.start();
  await waitFor(() => session.connected);
  bridge.dropClients();
  await waitFor(() => disconnections.length === 1, { what: 'the disconnection' });
  await waitFor(() => session.connected && readies === 2, { what: 'the reconnection' });
});

test('an unanswered keep-alive ping closes the half-open connection and reconnects', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  let readies = 0;
  const session = createSession(bridge, { onReady: async () => void (readies += 1) });
  t.after(() => session.stop());
  session.start();
  await waitFor(() => session.connected);
  bridge.silence();
  await waitFor(() => !session.connected, { what: 'the ping failure' });
  bridge.silence(false);
  await waitFor(() => session.connected && readies === 2, { what: 'the reconnection' });
});

test('a failing onReady closes the connection and retries (no connection without subscriptions)', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  let calls = 0;
  const session = createSession(bridge, {
    onReady: async () => {
      calls += 1;
      if (calls === 1) throw new Error('slow /device after a reboot');
    },
  });
  t.after(() => session.stop());
  session.start();
  await waitFor(() => session.connected);
  assert.equal(calls, 2);
  assert.equal(bridge.state.clients.size, 1, 'the first connection was closed');
});

test('a too slow onReady times out and retries', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  let calls = 0;
  const session = createSession(bridge, {
    onReady: () => {
      calls += 1;
      return calls === 1 ? new Promise(() => {}) : Promise.resolve();
    },
  });
  t.after(() => session.stop());
  session.start();
  await waitFor(() => session.connected, { timeoutMs: 2000 });
  assert.equal(calls, 2);
});

test('a refused certificate stops the retries until reconnectNow()', async (t) => {
  const bridge = await startFakeBridge({ cert: TLS.strangerCert, key: TLS.strangerKey });
  t.after(() => bridge.close());
  const session = createSession(bridge);
  t.after(() => session.stop());
  let attempts = 0;
  session.on('status', (s) => s.state === SESSION_STATES.CONNECTING && (attempts += 1));
  session.start();
  await waitFor(() => session.state === SESSION_STATES.REFUSED);
  assert.ok(session.lastError instanceof CertificateRefusedError);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(attempts, 1, 'no automatic retry');
  await session.reconnectNow();
  assert.equal(attempts, 2);
  assert.equal(session.state, SESSION_STATES.REFUSED);
});

test('a bridge closing the connection right after accepting it is reported as such', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  bridge.route({
    'ReadRequest /server/1/status/ping': (request, client) => void client.socket.destroy(),
  });
  const session = createSession(bridge);
  t.after(() => session.stop());
  session.start();
  await waitFor(() => session.state === SESSION_STATES.WAITING);
  assert.ok(session.lastError instanceof BridgeClosedEarlyError);
});

test('an unreachable bridge is retried with a growing backoff', async (t) => {
  const bridge = await startFakeBridge();
  const { port } = bridge;
  await bridge.close();
  const session = new LeapSession({
    host: '127.0.0.1',
    credentials: CREDENTIALS,
    timings: FAST,
    connectionOptions: { port },
  });
  t.after(() => session.stop());
  session.start();
  await waitFor(() => session.failures >= 3, { what: 'three failures' });
  assert.equal(
    session.state === SESSION_STATES.WAITING || session.state === SESSION_STATES.CONNECTING,
    true,
  );
});

test('stop() ends everything: no reconnection after a drop', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  let readies = 0;
  const session = createSession(bridge, { onReady: async () => void (readies += 1) });
  session.start();
  await waitFor(() => session.connected);
  await session.stop();
  assert.equal(session.state, SESSION_STATES.STOPPED);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(readies, 1);
  assert.equal(session.retryTimer, null);
  assert.equal(session.pingTimer, null);
});

test('restart() drops the connection and connects again at once', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  let readies = 0;
  const session = createSession(bridge, { onReady: async () => void (readies += 1) });
  t.after(() => session.stop());
  session.start();
  await waitFor(() => session.connected);
  await session.restart();
  assert.equal(session.connected, true);
  assert.equal(readies, 2);
});

test('unsolicited messages of the live connection are forwarded', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const session = createSession(bridge);
  t.after(() => session.stop());
  const received = [];
  session.on('unsolicited', (response) => received.push(response.body));
  session.start();
  await waitFor(() => session.connected);
  bridge.broadcast({
    Header: { StatusCode: '200 OK', Url: '/zone/1/status' },
    Body: { ZoneStatus: { Level: 7 } },
  });
  await waitFor(() => received.length === 1);
  assert.deepEqual(received, [{ ZoneStatus: { Level: 7 } }]);
});

test('stop() during the model loading does not wait for it', async (t) => {
  const bridge = await startFakeBridge({ routes: { '/device': () => undefined } });
  t.after(() => bridge.close());
  const session = createSession(bridge, {
    timings: { ...FAST, readyTimeoutMs: 10_000 },
    connectionOptions: { port: bridge.port, requestTimeoutMs: 10_000 },
    onReady: (connection) => connection.read('/device'),
  });
  session.start();
  await waitFor(() => bridge.requestsTo('/device').length === 1);
  const started = Date.now();
  await session.stop();
  assert.ok(Date.now() - started < 1000);
  assert.equal(session.state, SESSION_STATES.STOPPED);
});

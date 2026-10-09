import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { createBridgeController } from '../src/gladys/bridgeController.js';
import { LeapSession } from '../src/leap/session.js';
import { PairingTimeoutError } from '../src/leap/pairing.js';
import { ok, startFakeBridge } from './helpers/fakeBridge.js';
import { CREDENTIALS } from './helpers/tls.js';
import { waitFor } from './helpers/waitFor.js';

const FAST = {
  pingIntervalMs: 1000,
  pingTimeoutMs: 500,
  reconnectMinMs: 10,
  reconnectMaxMs: 30,
  readyTimeoutMs: 1000,
};
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const BRIDGE_ROUTES = {
  '/project': () => ok({ Project: { ProductType: 'Lutron Smart Bridge Project' } }),
  '/device?where=IsThisDevice:true': () =>
    ok({
      Devices: [
        {
          href: '/device/1',
          Name: 'Smart Bridge',
          ModelNumber: 'L-BDG2-WH',
          SerialNumber: 19114957,
        },
      ],
    }),
};
const PAIRED = {
  bridge_host: '127.0.0.1',
  leap_key: CREDENTIALS.key,
  leap_cert: CREDENTIALS.cert,
  leap_ca: CREDENTIALS.ca,
};

function fakeGladys(config = {}) {
  const gladys = {
    config,
    statuses: [],
    writes: [],
    scanResults: [],
    scanError: null,
    scans: 0,
    async setConnectionStatus(connected, message) {
      gladys.statuses.push({ connected, message });
    },
    async setConfig(partial) {
      gladys.writes.push(partial);
      Object.assign(gladys.config, partial);
    },
    async scanNetwork(type, options) {
      assert.equal(type, 'mdns');
      assert.ok(options.timeoutSeconds >= 1 && options.timeoutSeconds <= 30);
      gladys.scans += 1;
      if (gladys.scanError) throw gladys.scanError;
      return gladys.scanResults;
    },
  };
  return gladys;
}

const lastStatus = (gladys) => gladys.statuses.at(-1);
const mdns = (host, serial = '0123ABCD') => ({
  name: 'Lutron Status',
  host: `Lutron-${serial.toLowerCase()}.local`,
  addresses: [host],
  txt: ['SYSTYPE=SmartBridge2'],
});

function setup(t, { gladys = fakeGladys(), bridge, pair, onReady, rediscoverIntervalMs } = {}) {
  const controller = createBridgeController({
    gladys,
    logger: silent,
    pair,
    onReady,
    rediscoverIntervalMs,
    createSession: (options) =>
      new LeapSession({
        ...options,
        timings: FAST,
        connectionOptions: { port: bridge?.port ?? 1, connectTimeoutMs: 500 },
      }),
  });
  t.after(() => controller.close());
  return { gladys, controller };
}

test('without pairing, the status asks to pair', async (t) => {
  const { gladys, controller } = setup(t);
  await controller.apply(normalizeConfig({}));
  assert.equal(lastStatus(gladys).connected, false);
  assert.match(lastStatus(gladys).message.en, /Pair the bridge/);
  assert.match(lastStatus(gladys).message.fr, /Associer le bridge/);
});

test('an invalid IP address is explained, and pairing refuses to start', async (t) => {
  const gladys = fakeGladys({ bridge_host: 'bridge.local' });
  const { controller } = setup(t, { gladys });
  await controller.apply(normalizeConfig(gladys.config));
  assert.match(lastStatus(gladys).message.en, /"bridge.local" is not a valid IPv4/);
  assert.match((await controller.pairAction()).fr, /n'est pas une adresse IPv4/);
});

test('pairing without an IP searches the network: none, several, or no scan available', async (t) => {
  const { gladys, controller } = setup(t);
  await controller.apply(normalizeConfig({}));
  assert.match((await controller.pairAction()).en, /No Lutron bridge answered/);
  gladys.scanResults = [mdns('192.168.1.20'), mdns('192.168.1.9', '0456EF01')];
  assert.match(
    (await controller.pairAction()).en,
    /192\.168\.1\.9 \(Caséta\), 192\.168\.1\.20 \(Caséta\)/,
  );
  gladys.scanError = new Error('403');
  assert.match((await controller.pairAction()).en, /type the IP address/);
});

test('pairs the bridge found on the network, stores the credentials and connects', async (t) => {
  const bridge = await startFakeBridge({ routes: BRIDGE_ROUTES });
  t.after(() => bridge.close());
  const readies = [];
  const pairCalls = [];
  const { gladys, controller } = setup(t, {
    bridge,
    onReady: async (connection, info) => void readies.push(info),
    pair: async ({ host, onWaitingForButton }) => {
      pairCalls.push(host);
      onWaitingForButton();
      return {
        key: CREDENTIALS.key,
        cert: CREDENTIALS.cert,
        ca: CREDENTIALS.ca,
        leapVersion: '1.123',
        processor: false,
      };
    },
  });
  gladys.scanResults = [mdns('127.0.0.1')];
  await controller.apply(normalizeConfig({}));
  const message = await controller.pairAction();
  assert.deepEqual(pairCalls, ['127.0.0.1']);
  assert.ok(gladys.statuses.some((s) => /Press the small black button/.test(s.message.en)));
  assert.match(message.en, /Paired with Smart Bridge \(L-BDG2-WH\) at 127\.0\.0\.1/);
  assert.match(message.fr, /Découverte/);
  const stored = gladys.writes[0];
  assert.equal(stored.bridge_host, '127.0.0.1');
  assert.equal(stored.leap_key, CREDENTIALS.key);
  assert.equal(stored.bridge_serial, '0123ABCD');
  assert.equal(stored.bridge_type, 'SmartBridge2');
  await waitFor(() => lastStatus(gladys).connected);
  assert.match(
    lastStatus(gladys).message.en,
    /Connected to Smart Bridge \(L-BDG2-WH\) at 127\.0\.0\.1, LEAP 1\.123/,
  );
  assert.equal(readies[0].serial, '0123ABCD');
});

test('a pairing that fails explains why and restores the status', async (t) => {
  const { gladys, controller } = setup(t, {
    pair: async () => {
      throw new PairingTimeoutError(60_000);
    },
  });
  await controller.apply(normalizeConfig({ bridge_host: '192.168.1.20' }));
  const message = await controller.pairAction();
  assert.match(message.en, /not pressed in time/);
  assert.equal(gladys.writes.length, 0);
  await waitFor(() => /Pair the bridge/.test(lastStatus(gladys).message.en));
});

test('a paired configuration connects; the serial read from the bridge is saved', async (t) => {
  const bridge = await startFakeBridge({ routes: BRIDGE_ROUTES });
  t.after(() => bridge.close());
  const gladys = fakeGladys({ ...PAIRED });
  const { controller } = setup(t, { gladys, bridge });
  await controller.apply(normalizeConfig(gladys.config));
  await waitFor(() => lastStatus(gladys)?.connected);
  assert.deepEqual(gladys.writes, [{ bridge_serial: '0123ABCD' }]);
  // Saving the form again with the same bridge does not reconnect.
  const session = controller.session;
  await controller.apply(normalizeConfig({ ...gladys.config, button_detection: 'instant' }));
  assert.equal(controller.session, session);
  assert.match((await controller.testConnection()).en, /Connected to/);
});

test('"Test the connection" reconnects at once and says what is wrong', async (t) => {
  const bridge = await startFakeBridge({ routes: BRIDGE_ROUTES });
  const { port } = bridge;
  await bridge.close();
  const gladys = fakeGladys({ ...PAIRED });
  const { controller } = setup(t, { gladys, bridge: { port } });
  await controller.apply(normalizeConfig(gladys.config));
  const message = await controller.testConnection();
  assert.match(message.en, /does not answer at 127\.0\.0\.1/);
  assert.match(message.fr, /ne répond pas/);
});

test('"Forget the bridge" deletes the credentials and stops the session', async (t) => {
  const bridge = await startFakeBridge({ routes: BRIDGE_ROUTES });
  t.after(() => bridge.close());
  const gladys = fakeGladys({ ...PAIRED });
  const { controller } = setup(t, { gladys, bridge });
  await controller.apply(normalizeConfig(gladys.config));
  await waitFor(() => lastStatus(gladys)?.connected);
  const message = await controller.forget();
  assert.match(message.en, /pairing was deleted/);
  assert.equal(controller.session, null);
  assert.equal(gladys.config.leap_key, '');
  assert.equal(normalizeConfig(gladys.config).credentials, null);
  assert.match(lastStatus(gladys).message.en, /Pair the bridge/);
});

test('a bridge that changed IP is found again by its serial number', async (t) => {
  const bridge = await startFakeBridge({ routes: BRIDGE_ROUTES });
  t.after(() => bridge.close());
  // Paired at another address, where nothing answers on the bridge port.
  const gladys = fakeGladys({ ...PAIRED, bridge_host: '127.0.0.2', bridge_serial: '0123ABCD' });
  gladys.scanResults = [mdns('127.0.0.1')];
  const { controller } = setup(t, { gladys, bridge, rediscoverIntervalMs: 0 });
  await controller.apply(normalizeConfig(gladys.config));
  await waitFor(() => lastStatus(gladys)?.connected, { what: 'the connection at the new address' });
  assert.ok(gladys.writes.some((w) => w.bridge_host === '127.0.0.1'));
  assert.ok(
    gladys.statuses.some((s) => /moved from 127\.0\.0\.2 to 127\.0\.0\.1/.test(s.message.en)),
  );
});

test('a paired configuration without IP address says so', async (t) => {
  const gladys = fakeGladys({ ...PAIRED, bridge_host: '' });
  const { controller } = setup(t, { gladys });
  await controller.apply(normalizeConfig(gladys.config));
  assert.match(lastStatus(gladys).message.en, /IP address of the bridge is empty/);
  assert.equal(controller.session, null);
});

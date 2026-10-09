import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeapConnection, classifyConnectError, toResponse } from '../src/leap/connection.js';
import {
  BridgeUnreachableError,
  CertificateRefusedError,
  InvalidCredentialsError,
  LeapClosedError,
  LeapStatusError,
  LeapTimeoutError,
} from '../src/leap/errors.js';
import { ok, startFakeBridge, status } from './helpers/fakeBridge.js';
import { CREDENTIALS, TLS } from './helpers/tls.js';
import { waitFor } from './helpers/waitFor.js';

const connect = async (bridge, options = {}) => {
  const connection = new LeapConnection({
    host: bridge.host,
    port: bridge.port,
    credentials: CREDENTIALS,
    requestTimeoutMs: 300,
    ...options,
  });
  await connection.open();
  return connection;
};

test('pings the bridge and reads its LEAP version', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const connection = await connect(bridge);
  t.after(() => connection.close());
  assert.equal(await connection.ping(), '1.123');
  const [request] = bridge.requestsTo('/server/1/status/ping');
  assert.equal(request.CommuniqueType, 'ReadRequest');
  assert.match(request.Header.ClientTag, /^[0-9a-f-]{36}$/);
});

test('answers split byte by byte with accented names are decoded', async (t) => {
  const bridge = await startFakeBridge({
    chunkSize: 1,
    routes: { '/area': () => ok({ Areas: [{ href: '/area/3', Name: 'Salle à manger' }] }) },
  });
  t.after(() => bridge.close());
  const connection = await connect(bridge);
  t.after(() => connection.close());
  assert.deepEqual(await connection.read('/area'), {
    Areas: [{ href: '/area/3', Name: 'Salle à manger' }],
  });
});

test('concurrent requests are matched by tag, whatever the answer order', async (t) => {
  const held = [];
  const bridge = await startFakeBridge({
    routes: {
      '/zone/1/status': (request, client) => {
        held.push(() =>
          client.send({
            ...ok({ ZoneStatus: { Level: 1 } }),
            Header: { ...ok().Header, ClientTag: request.Header.ClientTag },
          }),
        );
      },
      '/zone/2/status': () => ok({ ZoneStatus: { Level: 2 } }),
    },
  });
  t.after(() => bridge.close());
  const connection = await connect(bridge);
  t.after(() => connection.close());
  const first = connection.read('/zone/1/status');
  assert.deepEqual(await connection.read('/zone/2/status'), { ZoneStatus: { Level: 2 } });
  held.shift()();
  assert.deepEqual(await first, { ZoneStatus: { Level: 1 } });
});

test('a non-2xx answer is a LeapStatusError; 204 gives a null body', async (t) => {
  const bridge = await startFakeBridge({ routes: { '/device': () => status('204 NoContent') } });
  t.after(() => bridge.close());
  const connection = await connect(bridge);
  t.after(() => connection.close());
  assert.equal(await connection.read('/device'), null);
  await assert.rejects(connection.read('/nothing'), (error) => {
    assert.ok(error instanceof LeapStatusError);
    assert.equal(error.statusCode, 404);
    return true;
  });
});

test('a request without answer times out and is forgotten; its late answer is ignored', async (t) => {
  let late;
  const bridge = await startFakeBridge({
    routes: {
      '/slow': (request, client) => {
        late = () =>
          client.send({
            ...ok({}),
            Header: { StatusCode: '200 OK', ClientTag: request.Header.ClientTag },
          });
      },
    },
  });
  t.after(() => bridge.close());
  const connection = await connect(bridge);
  t.after(() => connection.close());
  await assert.rejects(connection.read('/slow'), LeapTimeoutError);
  assert.equal(connection.pending.size, 0);
  late();
  assert.equal(await connection.ping(), '1.123', 'the connection is still usable');
});

test('paged answers are followed and merged', async (t) => {
  const bridge = await startFakeBridge({
    routes: {
      '/device': (request) =>
        request.Header.Paging
          ? ok({ Devices: [{ href: '/device/2' }] })
          : ok({ Devices: [{ href: '/device/1' }] }, { Paging: { Limit: 1, Offset: 1 } }),
    },
  });
  t.after(() => bridge.close());
  const connection = await connect(bridge);
  t.after(() => connection.close());
  assert.deepEqual(await connection.read('/device'), {
    Devices: [{ href: '/device/1' }, { href: '/device/2' }],
  });
  assert.deepEqual(bridge.requestsTo('/device')[1].Header.Paging, { Limit: 1, Offset: 1 });
});

test('subscriptions receive their later messages; untagged ones are unsolicited', async (t) => {
  let subscriber;
  const bridge = await startFakeBridge({
    routes: {
      'SubscribeRequest /button/101/status/event': (request, client) => {
        subscriber = { client, tag: request.Header.ClientTag };
        return status('204 NoContent');
      },
    },
  });
  t.after(() => bridge.close());
  const connection = await connect(bridge);
  t.after(() => connection.close());
  const events = [];
  const unsolicited = [];
  connection.on('unsolicited', (response) => unsolicited.push(response.body));
  await connection.subscribe('/button/101/status/event', (response) => events.push(response.body));
  const event = {
    ButtonStatus: { Button: { href: '/button/101' }, ButtonEvent: { EventType: 'Press' } },
  };
  subscriber.client.send({
    CommuniqueType: 'ReadResponse',
    Header: { StatusCode: '200 OK', ClientTag: subscriber.tag },
    Body: event,
  });
  bridge.broadcast({
    CommuniqueType: 'ReadResponse',
    Header: { StatusCode: '200 OK', Url: '/zone/1/status' },
    Body: { ZoneStatus: { Level: 40 } },
  });
  await waitFor(() => events.length === 1 && unsolicited.length === 1);
  assert.deepEqual(events, [event]);
  assert.deepEqual(unsolicited, [{ ZoneStatus: { Level: 40 } }]);
});

test('a throwing handler does not break the connection', async (t) => {
  const bridge = await startFakeBridge();
  t.after(() => bridge.close());
  const warnings = [];
  const connection = await connect(bridge, {
    logger: { debug() {}, warn: (m) => warnings.push(m) },
  });
  t.after(() => connection.close());
  connection.on('unsolicited', () => {
    throw new Error('boom');
  });
  await connection.ping(); // the bridge has registered the client
  bridge.broadcast({ Header: { StatusCode: '200 OK' }, Body: {} });
  await waitFor(() => warnings.length === 1);
  assert.equal(await connection.ping(), '1.123');
});

test('closing rejects the pending requests and emits close once', async (t) => {
  const bridge = await startFakeBridge({ routes: { '/slow': () => undefined } });
  t.after(() => bridge.close());
  const connection = await connect(bridge, { requestTimeoutMs: 5000 });
  const closes = [];
  connection.on('close', (error) => closes.push(error));
  await connection.ping(); // the bridge has registered the client
  const pending = connection.read('/slow');
  await waitFor(() => bridge.requestsTo('/slow').length === 1);
  bridge.dropClients();
  await assert.rejects(pending, LeapClosedError);
  await waitFor(() => closes.length === 1);
  connection.close();
  assert.equal(closes.length, 1);
  await assert.rejects(connection.ping(), LeapClosedError);
});

test('an unreachable bridge is a BridgeUnreachableError', async () => {
  const bridge = await startFakeBridge();
  const { port } = bridge;
  await bridge.close();
  const connection = new LeapConnection({ host: '127.0.0.1', port, credentials: CREDENTIALS });
  await assert.rejects(connection.open(), BridgeUnreachableError);
  assert.equal(connection.closed, true);
});

test('a bridge certificate from another authority is refused before any request', async (t) => {
  const bridge = await startFakeBridge({ cert: TLS.strangerCert, key: TLS.strangerKey });
  t.after(() => bridge.close());
  const connection = new LeapConnection({
    host: bridge.host,
    port: bridge.port,
    credentials: CREDENTIALS,
  });
  await assert.rejects(connection.open(), (error) => {
    assert.ok(error instanceof CertificateRefusedError);
    assert.equal(error.refusedBy, 'integration');
    return true;
  });
  assert.equal(bridge.state.requests.length, 0);
});

test('a bridge refusing our certificate never lets a request through', async (t) => {
  // A real bridge (OpenSSL) sends a TLS alert, classified as a certificate
  // problem (see the classification test); Node's TLS server just closes the
  // socket, which the session reports as an early close.
  const bridge = await startFakeBridge({ clientCa: TLS.otherCa });
  t.after(() => bridge.close());
  const connection = new LeapConnection({
    host: bridge.host,
    port: bridge.port,
    credentials: CREDENTIALS,
  });
  const error = await connection
    .open()
    .then(() => connection.ping())
    .then(
      () => null,
      (e) => e,
    );
  assert.ok(
    error instanceof BridgeUnreachableError || error instanceof LeapClosedError,
    String(error),
  );
  assert.equal(bridge.state.requests.length, 0);
});

test('unparsable stored credentials are an InvalidCredentialsError', async () => {
  const connection = new LeapConnection({
    host: '127.0.0.1',
    port: 1,
    credentials: { key: 'garbage', cert: 'garbage', ca: 'garbage' },
  });
  await assert.rejects(connection.open(), InvalidCredentialsError);
});

test('connect errors are classified', () => {
  assert.ok(classifyConnectError({ code: 'ECONNREFUSED' }, 'h') instanceof BridgeUnreachableError);
  assert.equal(
    classifyConnectError({ code: 'SELF_SIGNED_CERT_IN_CHAIN' }, 'h').refusedBy,
    'integration',
  );
  assert.equal(
    classifyConnectError({ code: 'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA' }, 'h').refusedBy,
    'bridge',
  );
  assert.equal(
    classifyConnectError({ code: 'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE' }, 'h').refusedBy,
    'bridge',
  );
});

test('a message without header still becomes a response', () => {
  assert.deepEqual(toResponse({}), {
    communiqueType: null,
    statusCode: null,
    status: '',
    url: null,
    messageBodyType: null,
    paging: null,
    body: null,
  });
});

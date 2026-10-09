import { test } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { once } from 'node:events';
import { PairingRefusedError, PairingTimeoutError, pairBridge } from '../src/leap/pairing.js';
import { BridgeUnreachableError } from '../src/leap/errors.js';
import { startFakeBridge } from './helpers/fakeBridge.js';
import { TLS } from './helpers/tls.js';

// In the tests the bridge CA plays the LAP authority, client.pem the LAP
// client certificate AND the certificate "signed" for Gladys.
const TRUST = {
  lapCa: TLS.bridgeCa,
  lutronRootCa: TLS.otherCa,
  cert: TLS.clientCert,
  key: TLS.clientKey,
};
const REQUEST = async () => ({
  keyPem: TLS.clientKey,
  csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nTEST\n',
});

async function startPairingServer({ cert = TLS.bridgeCert, key = TLS.bridgeKey, answer } = {}) {
  const received = [];
  const clients = new Set();
  const server = tls.createServer(
    { cert, key, ca: TLS.bridgeCa, requestCert: true, rejectUnauthorized: true },
    (socket) => {
      clients.add(socket);
      socket.on('error', () => {});
      socket.setEncoding('utf8');
      let buffer = '';
      socket.on('data', (text) => {
        buffer += text;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const request = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          received.push(request);
          const response = (answer ?? defaultAnswer)(request);
          if (response) socket.write(`${JSON.stringify(response)}\r\n`);
        }
      });
    },
  );
  server.on('tlsClientError', () => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: server.address().port,
    received,
    pressButton() {
      for (const socket of clients) {
        // An unrelated message first: only the PhysicalAccess status counts.
        socket.write(
          `${JSON.stringify({ Header: { ContentType: 'status;plurality=single', StatusCode: '200 OK' }, Body: { Status: { Permissions: ['Public'] } } })}\r\n`,
        );
        socket.write(
          `${JSON.stringify({ Header: { ContentType: 'status;plurality=single', StatusCode: '200 OK' }, Body: { Status: { Permissions: ['Public', 'PhysicalAccess'] } } })}\r\n`,
        );
      }
    },
    async close() {
      for (const socket of clients) socket.destroy();
      server.close();
      await once(server, 'close');
    },
  };
}

const defaultAnswer = (request) =>
  request.Header?.Url === '/pair'
    ? {
        Header: {
          StatusCode: '200 OK',
          ClientTag: 'get-cert',
          ContentType: 'signing-result;plurality=single',
        },
        Body: { SigningResult: { Certificate: TLS.clientCert, RootCertificate: TLS.bridgeCa } },
      }
    : null;

test('pairs a Caséta bridge once its button is pressed, then checks the LEAP port', async (t) => {
  const pairing = await startPairingServer();
  const leap = await startFakeBridge();
  t.after(() => Promise.all([pairing.close(), leap.close()]));
  let waiting = 0;
  const result = await pairBridge({
    host: '127.0.0.1',
    port: pairing.port,
    leapPort: leap.port,
    trust: TRUST,
    createRequest: REQUEST,
    onWaitingForButton: () => {
      waiting += 1;
      setTimeout(() => pairing.pressButton(), 20);
    },
  });
  assert.equal(waiting, 1);
  assert.deepEqual(result, {
    key: TLS.clientKey,
    cert: TLS.clientCert,
    ca: TLS.bridgeCa,
    leapVersion: '1.123',
    processor: false,
  });
  const [request] = pairing.received;
  assert.deepEqual(request.Header, { RequestType: 'Execute', Url: '/pair', ClientTag: 'get-cert' });
  assert.equal(request.Body.CommandType, 'CSR');
  assert.equal(request.Body.Parameters.Role, 'Admin');
  assert.equal(request.Body.Parameters.DisplayName, 'gladys-lutron');
  assert.match(request.Body.Parameters.CSR, /BEGIN CERTIFICATE REQUEST/);
});

test('a processor (RA3/QSX) is recognised by its lutron-root certificate and keeps that CA', async (t) => {
  const pairing = await startPairingServer({ cert: TLS.strangerCert, key: TLS.strangerKey });
  const leap = await startFakeBridge({ cert: TLS.strangerCert, key: TLS.strangerKey });
  t.after(() => Promise.all([pairing.close(), leap.close()]));
  const result = await pairBridge({
    host: '127.0.0.1',
    port: pairing.port,
    leapPort: leap.port,
    trust: TRUST,
    createRequest: REQUEST,
    onWaitingForButton: () => setTimeout(() => pairing.pressButton(), 20),
  });
  assert.equal(result.processor, true);
  assert.equal(result.ca, TLS.otherCa, 'the RootCertificate answer is replaced by lutron-root');
});

test('no button press in time is a PairingTimeoutError', async (t) => {
  const pairing = await startPairingServer();
  t.after(() => pairing.close());
  await assert.rejects(
    pairBridge({
      host: '127.0.0.1',
      port: pairing.port,
      trust: TRUST,
      createRequest: REQUEST,
      buttonTimeoutMs: 100,
    }),
    PairingTimeoutError,
  );
  assert.equal(pairing.received.length, 0, 'no certificate request without the button');
});

test('a refused certificate request is a PairingRefusedError', async (t) => {
  const pairing = await startPairingServer({
    answer: (request) =>
      request.Header?.Url === '/pair' && {
        Header: { StatusCode: '401 Unauthorized', ClientTag: 'get-cert' },
      },
  });
  t.after(() => pairing.close());
  await assert.rejects(
    pairBridge({
      host: '127.0.0.1',
      port: pairing.port,
      trust: TRUST,
      createRequest: REQUEST,
      onWaitingForButton: () => setTimeout(() => pairing.pressButton(), 20),
    }),
    (error) => error instanceof PairingRefusedError && error.status === '401 Unauthorized',
  );
});

test('an unreachable bridge is a BridgeUnreachableError', async () => {
  const pairing = await startPairingServer();
  const { port } = pairing;
  await pairing.close();
  await assert.rejects(
    pairBridge({ host: '127.0.0.1', port, trust: TRUST, createRequest: REQUEST }),
    BridgeUnreachableError,
  );
});

// -----------------------------------------------------------------------------
// Pairing with a Lutron bridge (port 8083), fully local.
//
//  1. Create a key and a certificate request (the key never leaves Gladys).
//  2. Open TLS with the public LAP "Caseta Application" certificate. The
//     pairing server is checked against the LAP authority (Caséta, RA2
//     Select) or, when that fails, against "lutron-root" (RadioRA 3,
//     HomeWorks QSX), like pylutron-caseta.
//  3. Wait for the user to press the button on the bridge: the bridge then
//     sends a status message granting the "PhysicalAccess" permission.
//  4. Send the request to /pair; the bridge answers with the signed
//     certificate and its authority.
//  5. Check the result: a ping on the LEAP port (8081) with the new
//     credentials, which also gives the LEAP version.
// -----------------------------------------------------------------------------

import tls from 'node:tls';
import { LAP_CA, LAP_CERT, LAP_KEY, LUTRON_ROOT_CA } from './assets.js';
import { LEAP_PORT, LeapConnection, classifyConnectError } from './connection.js';
import { createCertificateRequest } from './csr.js';
import { CertificateRefusedError, LeapError } from './errors.js';
import { createLineDecoder, encodeMessage, parseStatus } from './framing.js';

export const PAIRING_PORT = 8083;
export const PAIRING_TAG = 'get-cert';

/** The button on the bridge was not pressed in time. */
export class PairingTimeoutError extends LeapError {
  constructor(timeoutMs) {
    super(`The bridge button was not pressed within ${Math.round(timeoutMs / 1000)} s`);
  }
}

/** The bridge answered the pairing request with an error. */
export class PairingRefusedError extends LeapError {
  constructor(status) {
    super(`The bridge refused the pairing request (${status || 'no status'})`);
    this.status = status;
  }
}

const hasPhysicalAccess = (message) =>
  String(message?.Header?.ContentType ?? '').startsWith('status;') &&
  Array.isArray(message?.Body?.Status?.Permissions) &&
  message.Body.Status.Permissions.includes('PhysicalAccess');

/**
 * A JSON-lines TLS client for the pairing port.
 *
 * @returns {Promise<{ next(timeoutMs: number, onTimeout: () => Error): Promise<any>, send(message: object): void, close(): void }>}
 */
function openPairingChannel({ host, port, ca, cert, key, timeoutMs, tlsConnect }) {
  return new Promise((resolve, reject) => {
    const queue = [];
    const waiters = [];
    let failure = null;
    let opened = false;

    const fail = (error) => {
      if (failure) return;
      failure = error;
      for (const waiter of waiters.splice(0)) waiter.reject(error);
    };
    const deliver = (message) => {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(message);
      else queue.push(message);
    };
    const decoder = createLineDecoder({ onMessage: deliver, onError: () => {} });

    const socket = tlsConnect({
      host,
      port,
      ca,
      cert,
      key,
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(classifyConnectError({ code: 'ETIMEDOUT' }, host));
    }, timeoutMs);

    socket.on('data', (chunk) => decoder.push(chunk));
    socket.on('error', (error) => {
      const classified = classifyConnectError(error, host);
      if (!opened) {
        clearTimeout(timer);
        reject(classified);
      }
      fail(classified);
    });
    socket.on('close', () => fail(new LeapError('The bridge closed the pairing connection')));
    socket.once('secureConnect', () => {
      opened = true;
      clearTimeout(timer);
      resolve({
        next(waitMs, onTimeout) {
          if (queue.length > 0) return Promise.resolve(queue.shift());
          if (failure) return Promise.reject(failure);
          return new Promise((resolveNext, rejectNext) => {
            const waiter = {
              resolve: (message) => {
                clearTimeout(waitTimer);
                resolveNext(message);
              },
              reject: (error) => {
                clearTimeout(waitTimer);
                rejectNext(error);
              },
            };
            const waitTimer = setTimeout(() => {
              const index = waiters.indexOf(waiter);
              if (index !== -1) waiters.splice(index, 1);
              rejectNext(onTimeout());
            }, waitMs);
            waiters.push(waiter);
          });
        },
        send(message) {
          socket.write(encodeMessage(message));
        },
        close() {
          socket.destroy();
        },
      });
    });
  });
}

/**
 * @typedef {object} PairingResult
 * @property {string} key   PEM private key
 * @property {string} cert  PEM certificate signed by the bridge
 * @property {string} ca    PEM authority to check the bridge with
 * @property {string | null} leapVersion
 * @property {boolean} processor true for a RadioRA 3 / HomeWorks QSX processor
 */

/**
 * @param {object} options
 * @param {string} options.host IPv4 of the bridge
 * @param {() => void} [options.onWaitingForButton] the user must press the button now
 * @param {number} [options.buttonTimeoutMs]
 * @param {number} [options.socketTimeoutMs]
 * @param {string} [options.displayName]
 * @param {number} [options.port]
 * @param {number} [options.leapPort]
 * @param {{ lapCa: string, lutronRootCa: string, cert: string, key: string }} [options.trust]
 *   pairing material (the LAP assets; replaced in tests)
 * @param {() => Promise<{ keyPem: string, csrPem: string }>} [options.createRequest]
 * @param {typeof tls.connect} [options.tlsConnect]
 * @returns {Promise<PairingResult>}
 */
export async function pairBridge({
  host,
  onWaitingForButton,
  buttonTimeoutMs = 60_000,
  socketTimeoutMs = 10_000,
  displayName = 'gladys-lutron',
  port = PAIRING_PORT,
  leapPort = LEAP_PORT,
  trust = { lapCa: LAP_CA, lutronRootCa: LUTRON_ROOT_CA, cert: LAP_CERT, key: LAP_KEY },
  createRequest = () => createCertificateRequest(displayName),
  tlsConnect = tls.connect,
}) {
  const { keyPem, csrPem } = await createRequest();
  const open = (ca) =>
    openPairingChannel({
      host,
      port,
      ca,
      cert: trust.cert,
      key: trust.key,
      timeoutMs: socketTimeoutMs,
      tlsConnect,
    });

  let processor = false;
  let channel;
  try {
    channel = await open(trust.lapCa);
  } catch (error) {
    if (!(error instanceof CertificateRefusedError) || error.refusedBy !== 'integration')
      throw error;
    // Not signed by the LAP authority: a RadioRA 3 / HomeWorks QSX processor.
    channel = await open(trust.lutronRootCa);
    processor = true;
  }

  let signing;
  try {
    onWaitingForButton?.();
    const deadline = Date.now() + buttonTimeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new PairingTimeoutError(buttonTimeoutMs);
      const message = await channel.next(remaining, () => new PairingTimeoutError(buttonTimeoutMs));
      if (hasPhysicalAccess(message)) break;
    }

    channel.send({
      Header: { RequestType: 'Execute', Url: '/pair', ClientTag: PAIRING_TAG },
      Body: {
        CommandType: 'CSR',
        Parameters: {
          CSR: csrPem,
          DisplayName: displayName,
          DeviceUID: '000000000000',
          Role: 'Admin',
        },
      },
    });
    for (;;) {
      const message = await channel.next(
        socketTimeoutMs,
        () => new PairingRefusedError('no answer to the certificate request'),
      );
      if (message?.Header?.ClientTag !== PAIRING_TAG) continue;
      const status = message.Header.StatusCode ?? '';
      const result = message.Body?.SigningResult;
      if (parseStatus(status).code !== 200 || !result?.Certificate || !result?.RootCertificate) {
        throw new PairingRefusedError(status);
      }
      signing = result;
      break;
    }
  } finally {
    channel.close();
  }

  const credentials = {
    key: keyPem,
    cert: signing.Certificate,
    // pylutron-caseta: a processor's RootCertificate is replaced by lutron-root.
    ca: processor ? trust.lutronRootCa : signing.RootCertificate,
  };
  const connection = new LeapConnection({
    host,
    port: leapPort,
    credentials,
    connectTimeoutMs: socketTimeoutMs,
  });
  try {
    await connection.open();
    const leapVersion = await connection.ping();
    return { ...credentials, leapVersion, processor };
  } finally {
    connection.close();
  }
}

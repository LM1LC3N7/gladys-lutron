// -----------------------------------------------------------------------------
// One LEAP connection to a Lutron bridge: TLS on port 8081 with the
// certificate signed by the bridge at pairing, then JSON lines.
//
// - Every request carries a fresh ClientTag; the answer with that tag
//   resolves it. A request that times out is forgotten at once (lutron-leap
//   kept them forever).
// - A subscription keeps its tag: the later messages carrying it go to the
//   subscription callback. Subscriptions live and die with the connection
//   (the session subscribes again after every reconnection).
// - Untagged messages are status updates the bridge sends on its own (zone
//   levels on Caséta): emitted as 'unsolicited'.
// - The bridge certificate is checked against the authority received at
//   pairing. The bridge certificate carries no usable host name, so only the
//   host-name check is skipped, never the chain (lutron-leap disabled both).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import tls from 'node:tls';
import {
  BridgeUnreachableError,
  CertificateRefusedError,
  InvalidCredentialsError,
  LeapClosedError,
  LeapStatusError,
  LeapTimeoutError,
} from './errors.js';
import { createLineDecoder, encodeMessage, parseStatus } from './framing.js';

export const LEAP_PORT = 8081;
export const PING_URL = '/server/1/status/ping';

// OpenSSL verification codes: we refused the certificate of the bridge.
const SERVER_CERTIFICATE_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_SIGNATURE_FAILURE',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
]);

/**
 * Classify a socket error raised while connecting.
 *
 * @param {Error & { code?: string }} error
 * @param {string} host
 * @returns {Error}
 */
export function classifyConnectError(error, host) {
  const code = error?.code;
  if (code && SERVER_CERTIFICATE_CODES.has(code)) {
    return new CertificateRefusedError('integration', { cause: error, code });
  }
  // A TLS alert sent by the bridge during the handshake: our certificate.
  if (code && /^ERR_SSL_.*ALERT_(BAD_CERTIFICATE|UNKNOWN_CA|CERTIFICATE_)/.test(code)) {
    return new CertificateRefusedError('bridge', { cause: error, code });
  }
  return new BridgeUnreachableError(host, { cause: error, code });
}

/**
 * @typedef {object} LeapResponse
 * @property {string | null} communiqueType
 * @property {number | null} statusCode    200, 204, 404… (null when absent)
 * @property {string} status               raw status, e.g. "200 OK"
 * @property {string | null} url
 * @property {string | null} messageBodyType
 * @property {object | null} paging        Header.Paging, when the answer is paged
 * @property {any} body                    Body, null for "204 NoContent"
 */

/**
 * @param {any} message raw JSON message
 * @returns {LeapResponse}
 */
export function toResponse(message) {
  const header = message.Header && typeof message.Header === 'object' ? message.Header : {};
  const status = typeof header.StatusCode === 'string' ? header.StatusCode : '';
  return {
    communiqueType: message.CommuniqueType ?? null,
    statusCode: parseStatus(status).code,
    status,
    url: header.Url ?? null,
    messageBodyType: header.MessageBodyType ?? null,
    paging: header.Paging && typeof header.Paging === 'object' ? header.Paging : null,
    body: message.Body ?? null,
  };
}

const isSuccess = (response) =>
  response.statusCode !== null && response.statusCode >= 200 && response.statusCode < 300;

export class LeapConnection extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.host IPv4 of the bridge
   * @param {number} [options.port]
   * @param {{ key: string, cert: string, ca: string | string[] }} options.credentials
   * @param {number} [options.connectTimeoutMs]
   * @param {number} [options.requestTimeoutMs] below the 5 s Gladys acknowledgement
   * @param {{ debug: Function, warn: Function }} [options.logger]
   * @param {typeof tls.connect} [options.tlsConnect] injectable for tests
   */
  constructor({
    host,
    port = LEAP_PORT,
    credentials,
    connectTimeoutMs = 9000,
    requestTimeoutMs = 4000,
    logger,
    tlsConnect = tls.connect,
  }) {
    super();
    this.host = host;
    this.port = port;
    this.credentials = credentials;
    this.connectTimeoutMs = connectTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.logger = logger;
    this.tlsConnect = tlsConnect;
    /** @type {tls.TLSSocket | null} */
    this.socket = null;
    this.closed = false;
    this.closeError = null;
    /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
    this.pending = new Map();
    /** @type {Map<string, (response: LeapResponse) => void>} */
    this.subscriptions = new Map();
  }

  /** Open the TLS connection; rejects with a typed error. */
  open() {
    if (this.socket) return Promise.reject(new Error('LeapConnection.open() called twice'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        this.markClosed(error);
        reject(error);
      };
      let socket;
      try {
        socket = this.tlsConnect({
          host: this.host,
          port: this.port,
          key: this.credentials.key,
          cert: this.credentials.cert,
          ca: this.credentials.ca,
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true,
          // The chain is verified against the pairing authority; the bridge
          // certificate has no host name matching its IP.
          checkServerIdentity: () => undefined,
        });
      } catch (error) {
        // Unparsable PEM: the stored pairing is corrupted.
        settled = true;
        const invalid = new InvalidCredentialsError({ cause: error });
        this.markClosed(invalid);
        reject(invalid);
        return;
      }
      this.socket = socket;
      const timer = setTimeout(
        () => fail(new BridgeUnreachableError(this.host, { code: 'ETIMEDOUT' })),
        this.connectTimeoutMs,
      );

      const decoder = createLineDecoder({
        onMessage: (message) => this.dispatch(message),
        onError: (error, line) => {
          if (line === undefined) {
            this.close(error);
          } else {
            this.logger?.warn(`Ignored a malformed LEAP message (${line.length} characters)`);
          }
        },
      });

      socket.on('data', (chunk) => decoder.push(chunk));
      socket.once('secureConnect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.setKeepAlive(true, 30_000);
        socket.setNoDelay(true);
        resolve();
      });
      socket.on('error', (error) => {
        if (!settled) {
          fail(classifyConnectError(error, this.host));
        } else {
          // After the handshake: a bridge refusing our certificate (TLS 1.3
          // reports it late) is still a certificate problem, anything else a
          // lost connection.
          const classified = classifyConnectError(error, this.host);
          this.markClosed(classified);
        }
      });
      socket.on('close', () => {
        decoder.end();
        if (!settled) {
          fail(new BridgeUnreachableError(this.host, { code: 'ECONNRESET' }));
          return;
        }
        this.markClosed(this.closeError ?? new LeapClosedError());
      });
    });
  }

  /** @param {any} message */
  dispatch(message) {
    const tag = message?.Header?.ClientTag;
    const response = toResponse(message);
    if (typeof tag === 'string') {
      const pending = this.pending.get(tag);
      if (pending) {
        this.pending.delete(tag);
        clearTimeout(pending.timer);
        pending.resolve(response);
        return;
      }
      const subscription = this.subscriptions.get(tag);
      if (subscription) {
        this.safely(() => subscription(response));
        return;
      }
      // Usually the late answer of a request that timed out.
      this.logger?.debug(`Ignored a LEAP message for an unknown tag (${response.url})`);
      return;
    }
    this.safely(() => this.emit('unsolicited', response));
  }

  safely(fn) {
    try {
      fn();
    } catch (error) {
      this.logger?.warn(`A LEAP message handler failed: ${error?.message ?? error}`);
    }
  }

  /**
   * Send one request and resolve its answer, whatever its status.
   *
   * @param {string} communiqueType ReadRequest, SubscribeRequest, CreateRequest, UpdateRequest
   * @param {string} url
   * @param {{ body?: object, paging?: object, tag?: string, timeoutMs?: number }} [options]
   * @returns {Promise<LeapResponse>}
   */
  request(communiqueType, url, { body, paging, tag = randomUUID(), timeoutMs } = {}) {
    if (this.closed || !this.socket) {
      return Promise.reject(this.closeError ?? new LeapClosedError());
    }
    const message = { CommuniqueType: communiqueType, Header: { ClientTag: tag, Url: url } };
    if (paging) message.Header.Paging = paging;
    if (body !== undefined) message.Body = body;
    const limit = timeoutMs ?? this.requestTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(tag);
        reject(new LeapTimeoutError(url, limit));
      }, limit);
      this.pending.set(tag, { resolve, reject, timer });
      this.socket.write(encodeMessage(message));
    });
  }

  /**
   * Request expecting a 2xx answer; follows Header.Paging like pylutron-caseta
   * and merges the pages of the first body collection.
   *
   * @returns {Promise<LeapResponse>}
   */
  async call(communiqueType, url, body) {
    const pages = [];
    let paging;
    do {
      const response = await this.request(communiqueType, url, { body, paging });
      if (!isSuccess(response))
        throw new LeapStatusError(url, response.statusCode, response.status);
      pages.push(response);
      paging = response.paging ?? undefined;
    } while (paging && pages.length < 100);
    const [first, ...rest] = pages;
    const collection = first.body && Object.keys(first.body)[0];
    if (collection && Array.isArray(first.body[collection])) {
      for (const page of rest) {
        const items = page.body?.[collection];
        if (Array.isArray(items)) first.body[collection].push(...items);
      }
    }
    return first;
  }

  /** @returns {Promise<any>} the body, null for "204 NoContent" */
  async read(url) {
    return (await this.call('ReadRequest', url)).body;
  }

  /** @returns {Promise<any>} */
  async create(url, body) {
    return (await this.call('CreateRequest', url, body)).body;
  }

  /** @returns {Promise<any>} */
  async update(url, body) {
    return (await this.call('UpdateRequest', url, body)).body;
  }

  /**
   * Subscribe: the answer is returned, and every later message with the same
   * tag goes to `onEvent` until the connection closes.
   *
   * @param {string} url
   * @param {(response: LeapResponse) => void} onEvent
   * @returns {Promise<LeapResponse>}
   */
  async subscribe(url, onEvent) {
    const tag = randomUUID();
    const response = await this.request('SubscribeRequest', url, { tag });
    if (!isSuccess(response)) throw new LeapStatusError(url, response.statusCode, response.status);
    this.subscriptions.set(tag, onEvent);
    return response;
  }

  /** @returns {Promise<string | null>} the LEAP version of the bridge */
  async ping() {
    const body = await this.read(PING_URL);
    return body?.PingResponse?.LEAPVersion != null ? String(body.PingResponse.LEAPVersion) : null;
  }

  /** @param {Error} [error] why, reported to the 'close' listeners */
  close(error) {
    if (error && !this.closeError) this.closeError = error;
    this.socket?.destroy();
    this.markClosed(this.closeError ?? new LeapClosedError());
  }

  markClosed(error) {
    if (this.closed) return;
    this.closed = true;
    this.closeError = this.closeError ?? error;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new LeapClosedError());
    }
    this.pending.clear();
    this.subscriptions.clear();
    this.emit('close', this.closeError);
  }
}

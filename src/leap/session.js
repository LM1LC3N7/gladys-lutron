// -----------------------------------------------------------------------------
// A long-lived LEAP session: keeps one connection to the bridge alive.
//
// - Connects, reads the LEAP version (ping), then runs `onReady(connection)`:
//   the caller loads the model and subscribes. Subscriptions belong to one
//   connection, so `onReady` runs again after EVERY reconnection. A failed or
//   too slow `onReady` closes the connection and retries: a connection
//   without its subscriptions would look alive while no state ever arrives
//   (pylutron-caseta #206, Home Assistant #128541).
// - Pings the bridge every minute; no answer within 10 s closes the
//   connection, which reconnects (half-open sockets after a bridge reboot or
//   a Wi-Fi mesh change are only noticed this way).
// - Reconnects with a backoff from 2 s to 60 s. A certificate refused by
//   either side stops the loop: retrying cannot fix it, the user must pair
//   again (or press "Test the connection").
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { LeapConnection } from './connection.js';
import {
  BridgeClosedEarlyError,
  CertificateRefusedError,
  InvalidCredentialsError,
  LeapClosedError,
  LeapTimeoutError,
} from './errors.js';

export const SESSION_STATES = Object.freeze({
  STOPPED: 'stopped',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  WAITING: 'waiting', // backoff before the next attempt
  REFUSED: 'refused', // certificate problem: no automatic retry
});

export const DEFAULT_TIMINGS = Object.freeze({
  pingIntervalMs: 60_000,
  pingTimeoutMs: 10_000,
  reconnectMinMs: 2_000,
  reconnectMaxMs: 60_000,
  // Big RA3/QSX projects need ~800 requests (~42 s, Home Assistant #110067).
  readyTimeoutMs: 90_000,
});

const isFatal = (error) =>
  error instanceof CertificateRefusedError || error instanceof InvalidCredentialsError;

/**
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} what
 * @returns {Promise<T>}
 * @template T
 */
function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new LeapTimeoutError(what, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class LeapSession extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {{ key: string, cert: string, ca: string | string[] }} options.credentials
   * @param {(connection: LeapConnection) => Promise<void>} [options.onReady]
   * @param {{ debug: Function, info: Function, warn: Function }} [options.logger]
   * @param {Partial<typeof DEFAULT_TIMINGS>} [options.timings]
   * @param {(options: object) => LeapConnection} [options.createConnection]
   * @param {object} [options.connectionOptions] passed to every connection (port, timeouts)
   */
  constructor({
    host,
    credentials,
    onReady = async () => {},
    logger,
    timings = {},
    createConnection = (options) => new LeapConnection(options),
    connectionOptions = {},
  }) {
    super();
    this.host = host;
    this.credentials = credentials;
    this.onReady = onReady;
    this.logger = logger;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.createConnection = createConnection;
    this.connectionOptions = connectionOptions;
    this.state = SESSION_STATES.STOPPED;
    this.since = Date.now();
    /** @type {Error | null} */
    this.lastError = null;
    /** @type {string | null} */
    this.leapVersion = null;
    /** @type {LeapConnection | null} */
    this.connection = null;
    this.failures = 0;
    this.retryTimer = null;
    this.pingTimer = null;
    /** @type {Promise<void> | null} */
    this.attemptPromise = null;
    /** @type {LeapConnection | null} the connection of the attempt in progress */
    this.opening = null;
  }

  get connected() {
    return this.state === SESSION_STATES.CONNECTED;
  }

  /** @returns {{ state: string, since: number, error: Error | null, leapVersion: string | null, host: string }} */
  status() {
    return {
      state: this.state,
      since: this.since,
      error: this.lastError,
      leapVersion: this.leapVersion,
      host: this.host,
    };
  }

  setState(state, error = this.lastError) {
    const changed = state !== this.state;
    this.state = state;
    this.lastError = error;
    if (changed) this.since = Date.now();
    this.emit('status', this.status());
  }

  /** Start the connection loop (idempotent). */
  start() {
    if (this.state !== SESSION_STATES.STOPPED) return;
    this.failures = 0;
    this.attempt();
  }

  /**
   * Connect now, skipping a pending backoff or a refused certificate
   * ("Test the connection"). Resolves once this attempt is over.
   */
  async reconnectNow() {
    if (this.state === SESSION_STATES.CONNECTED) return;
    if (this.attemptPromise) return this.attemptPromise;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.failures = 0;
    return this.attempt();
  }

  /** Drop the current connection and connect again (after a refresh, a new IP…). */
  async restart() {
    const connection = this.connection;
    this.connection = null;
    this.stopPing();
    connection?.removeAllListeners('close');
    connection?.close();
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.failures = 0;
    if (this.attemptPromise) await this.attemptPromise.catch(() => {});
    return this.attempt();
  }

  attempt() {
    if (this.attemptPromise) return this.attemptPromise;
    this.attemptPromise = this.runAttempt().finally(() => {
      this.attemptPromise = null;
    });
    return this.attemptPromise;
  }

  async runAttempt() {
    this.setState(SESSION_STATES.CONNECTING);
    const connection = this.createConnection({
      host: this.host,
      credentials: this.credentials,
      logger: this.logger,
      ...this.connectionOptions,
    });
    this.opening = connection;
    try {
      await connection.open();
      if (this.state === SESSION_STATES.STOPPED) {
        connection.close();
        return;
      }
      connection.on('unsolicited', (response) => {
        if (this.connection === connection) this.emit('unsolicited', response);
      });
      try {
        this.leapVersion = await connection.ping();
      } catch (error) {
        throw error instanceof LeapClosedError && !(error instanceof BridgeClosedEarlyError)
          ? new BridgeClosedEarlyError()
          : error;
      }
      await withTimeout(this.onReady(connection), this.timings.readyTimeoutMs, 'model loading');
      if (this.state === SESSION_STATES.STOPPED || connection.closed) {
        connection.close();
        if (this.state !== SESSION_STATES.STOPPED) this.scheduleRetry(connection.closeError);
        return;
      }
    } catch (error) {
      connection.close();
      if (this.state !== SESSION_STATES.STOPPED) this.handleFailure(error);
      return;
    } finally {
      this.opening = null;
    }
    this.connection = connection;
    this.failures = 0;
    connection.once('close', (error) => this.handleClose(connection, error));
    this.setState(SESSION_STATES.CONNECTED, null);
    this.logger?.info(`Connected to the Lutron bridge at ${this.host} (LEAP ${this.leapVersion})`);
    this.emit('connected', connection);
    this.schedulePing();
  }

  handleClose(connection, error) {
    if (this.connection !== connection) return;
    this.connection = null;
    this.stopPing();
    this.emit('disconnected', error);
    if (this.state === SESSION_STATES.STOPPED) return;
    this.logger?.warn(`Lost the Lutron bridge connection: ${error?.message ?? 'closed'}`);
    this.handleFailure(error);
  }

  handleFailure(error) {
    if (isFatal(error)) {
      this.logger?.warn(`Lutron bridge: ${error.message}; not retrying until paired again`);
      this.setState(SESSION_STATES.REFUSED, error);
      return;
    }
    this.scheduleRetry(error);
  }

  scheduleRetry(error) {
    const { reconnectMinMs, reconnectMaxMs } = this.timings;
    const delay = Math.min(reconnectMaxMs, reconnectMinMs * 2 ** this.failures);
    this.failures += 1;
    this.setState(SESSION_STATES.WAITING, error ?? null);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.attempt();
    }, delay);
  }

  schedulePing() {
    this.stopPing();
    this.pingTimer = setTimeout(() => this.runPing(), this.timings.pingIntervalMs);
  }

  stopPing() {
    clearTimeout(this.pingTimer);
    this.pingTimer = null;
  }

  async runPing() {
    const connection = this.connection;
    if (!connection) return;
    try {
      await withTimeout(connection.ping(), this.timings.pingTimeoutMs, 'ping');
      if (this.connection === connection) this.schedulePing();
    } catch (error) {
      if (this.connection !== connection) return;
      this.logger?.warn('The Lutron bridge did not answer the keep-alive ping: reconnecting');
      connection.close(error);
    }
  }

  /** Stop for good: no more reconnection, every timer cleared. */
  async stop() {
    this.setState(SESSION_STATES.STOPPED, null);
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopPing();
    const connection = this.connection;
    this.connection = null;
    connection?.close();
    // A connection still loading the model: its requests fail at once.
    this.opening?.close();
    if (this.attemptPromise) await this.attemptPromise.catch(() => {});
  }
}

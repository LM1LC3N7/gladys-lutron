// -----------------------------------------------------------------------------
// The paired bridge, seen from Gladys: configuration, pairing, LEAP session,
// connection status and the configuration actions (pair, test, forget).
//
// Everything is local: the bridge is searched through the Gladys core mDNS
// scan (the container cannot see mDNS), paired by its button, then reached in
// unicast. The pairing credentials are stored as hidden config keys: kept by
// the Gladys backups, never shown in the interface, untouched when the user
// saves the form.
// -----------------------------------------------------------------------------

import { anonymize } from '../leap/anonymize.js';
import { readBridgeInfo } from '../leap/bridgeInfo.js';
import { collectDiagnostics, toLogLines } from '../leap/diagnostics.js';
import { parseMdnsResults } from '../leap/discovery.js';
import { BridgeUnreachableError } from '../leap/errors.js';
import { pairBridge } from '../leap/pairing.js';
import { LeapSession, SESSION_STATES } from '../leap/session.js';
import { CONFIG_KEYS, STORAGE_KEYS } from './keys.js';
import { MESSAGES, describeError, describeSession } from './messages.js';

export const SCAN_TIMEOUT_SECONDS = 5;
// Looking for a bridge that changed IP: after a few failed reconnections, at
// most every 5 minutes (the core allows one scan per 10 s).
const REDISCOVER_AFTER_FAILURES = 3;
const REDISCOVER_INTERVAL_MS = 5 * 60_000;

/**
 * @param {object} options
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
 * @param {{ debug: Function, info: Function, warn: Function, error: Function }} options.logger
 * @param {(connection: import('../leap/connection.js').LeapConnection, info: object) => Promise<void>} [options.onReady]
 *   loads the model and subscribes, after every (re)connection
 * @param {(status: object) => void} [options.onStatus] every session status change
 * @param {() => void} [options.onStopped] a session was stopped on purpose (forget, new
 *   address, new pairing, shutdown): not an outage
 * @param {(options: object) => LeapSession} [options.createSession]
 * @param {typeof pairBridge} [options.pair]
 * @param {number} [options.rediscoverIntervalMs]
 * @param {{ leap?: number, pairing?: number }} [options.ports] non-standard ports (development)
 * @param {string} [options.version] integration version, written in the diagnostics
 */
export function createBridgeController({
  gladys,
  logger,
  onReady = async () => {},
  onStatus = () => {},
  onStopped = () => {},
  createSession = (options) => new LeapSession(options),
  pair = pairBridge,
  rediscoverIntervalMs = REDISCOVER_INTERVAL_MS,
  ports = {},
  version = 'unknown',
}) {
  /** @type {import('../config.js').LutronConfig | null} */
  let config = null;
  /** @type {LeapSession | null} */
  let session = null;
  let info = null;
  let pairing = false;
  let diagnosing = false;
  let lastStatusKey = null;
  let lastRediscover = 0;

  const publishStatus = async ({ connected, message }) => {
    const key = JSON.stringify([connected, message]);
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (error) {
      lastStatusKey = null;
      logger.warn(`Could not publish the connection status: ${error.message}`);
    }
  };

  const idleStatus = () => {
    if (config?.bridgeHostInvalid) {
      return {
        connected: false,
        message: MESSAGES.invalidHost(gladys.config?.[CONFIG_KEYS.BRIDGE_HOST]),
      };
    }
    if (config?.credentials) return { connected: false, message: MESSAGES.missingHost };
    return { connected: false, message: MESSAGES.notPaired };
  };

  const currentStatus = () => (session ? describeSession(session.status(), info) : idleStatus());

  const stopSession = async () => {
    const current = session;
    session = null;
    info = null;
    if (current) {
      await current.stop();
      onStopped();
    }
  };

  const startSession = () => {
    const current = createSession({
      host: config.bridgeHost,
      credentials: config.credentials,
      logger,
      ...(ports.leap ? { connectionOptions: { port: ports.leap } } : {}),
      onReady: async (connection) => {
        const bridge = await readBridgeInfo(connection);
        if (session !== current) return;
        info = bridge;
        if (bridge.serial && bridge.serial !== config.bridgeSerial) {
          config = { ...config, bridgeSerial: bridge.serial };
          await gladys.setConfig({ [STORAGE_KEYS.BRIDGE_SERIAL]: bridge.serial }).catch((error) => {
            logger.warn(`Could not save the bridge serial number: ${error.message}`);
          });
        }
        await onReady(connection, bridge);
      },
    });
    session = current;
    current.on('status', (status) => {
      if (session !== current) return;
      onStatus(status);
      if (!pairing) publishStatus(describeSession(status, info));
      if (
        status.state === SESSION_STATES.WAITING &&
        status.error instanceof BridgeUnreachableError &&
        current.failures >= REDISCOVER_AFTER_FAILURES
      ) {
        rediscover().catch((error) => logger.warn(`Bridge search failed: ${error.message}`));
      }
    });
    current.start();
    return current;
  };

  /** @returns {Promise<import('../leap/discovery.js').DiscoveredBridge[]>} */
  const scan = async () =>
    parseMdnsResults(await gladys.scanNetwork('mdns', { timeoutSeconds: SCAN_TIMEOUT_SECONDS }));

  // The bridge got a new IP from the router (no DHCP reservation): find it
  // again by its serial number and follow it.
  const rediscover = async () => {
    if (!config?.bridgeSerial || Date.now() - lastRediscover < rediscoverIntervalMs) return;
    lastRediscover = Date.now();
    const found = (await scan()).find((bridge) => bridge.serial === config.bridgeSerial);
    if (!found || found.host === config.bridgeHost || !session) return;
    const previous = config.bridgeHost;
    logger.info(`The Lutron bridge moved from ${previous} to ${found.host}`);
    await gladys.setConfig({ [CONFIG_KEYS.BRIDGE_HOST]: found.host });
    config = { ...config, bridgeHost: found.host };
    await stopSession();
    startSession();
    publishStatus({ connected: false, message: MESSAGES.bridgeMoved(previous, found.host) });
  };

  const sameConnection = (a, b) =>
    a?.bridgeHost === b?.bridgeHost &&
    a?.credentials?.key === b?.credentials?.key &&
    a?.credentials?.cert === b?.credentials?.cert &&
    a?.credentials?.ca === b?.credentials?.ca;

  return {
    get session() {
      return session;
    },
    get info() {
      return info;
    },
    get config() {
      return config;
    },

    /**
     * Apply a (new) configuration: (re)connects only when the bridge address
     * or the pairing changed.
     *
     * @param {import('../config.js').LutronConfig} next
     */
    async apply(next) {
      const previous = config;
      config = next;
      if (session && sameConnection(previous, next)) return;
      await stopSession();
      if (next.credentials && next.bridgeHost) {
        startSession();
      } else {
        await publishStatus(idleStatus());
      }
    },

    /** Configuration action "Pair the bridge". */
    async pairAction() {
      if (pairing) return MESSAGES.pairingInProgress;
      if (config?.bridgeHostInvalid) return idleStatus().message;
      pairing = true;
      let host = config?.bridgeHost ?? null;
      let found = null;
      try {
        if (!host) {
          let bridges;
          try {
            bridges = await scan();
          } catch (error) {
            logger.warn(`The mDNS scan failed: ${error.message}`);
            return MESSAGES.scanUnavailable;
          }
          if (bridges.length === 0) return MESSAGES.noBridgeFound;
          if (bridges.length > 1) return MESSAGES.severalBridges(bridges);
          [found] = bridges;
          host = found.host;
        }
        logger.info(`Pairing with the Lutron bridge at ${host}: waiting for its button`);
        const result = await pair({
          host,
          ...(ports.leap ? { leapPort: ports.leap } : {}),
          ...(ports.pairing ? { port: ports.pairing } : {}),
          onWaitingForButton: () => {
            publishStatus({ connected: false, message: MESSAGES.pressButton(host) });
          },
        });
        const stored = {
          [CONFIG_KEYS.BRIDGE_HOST]: host,
          [STORAGE_KEYS.LEAP_KEY]: result.key,
          [STORAGE_KEYS.LEAP_CERT]: result.cert,
          [STORAGE_KEYS.LEAP_CA]: result.ca,
          [STORAGE_KEYS.BRIDGE_SERIAL]: found?.serial ?? '',
          [STORAGE_KEYS.BRIDGE_TYPE]: found?.systype ?? (result.processor ? 'processor' : ''),
        };
        await gladys.setConfig(stored);
        logger.info(`Paired with the Lutron bridge at ${host} (LEAP ${result.leapVersion})`);
        pairing = false;
        await stopSession();
        config = {
          ...config,
          bridgeHost: host,
          bridgeHostInvalid: false,
          credentials: { key: result.key, cert: result.cert, ca: result.ca },
          bridgeSerial: found?.serial ?? null,
          bridgeType: stored[STORAGE_KEYS.BRIDGE_TYPE] || null,
        };
        const current = startSession();
        // Give the first connection a moment, to name the bridge in the answer.
        let timer;
        await Promise.race([
          new Promise((resolve) => current.once('connected', resolve)),
          new Promise((resolve) => (timer = setTimeout(resolve, 10_000))),
        ]);
        clearTimeout(timer);
        return MESSAGES.paired(host, info);
      } catch (error) {
        logger.warn(`Pairing failed: ${error.message}`);
        return describeError(error, host ?? '?');
      } finally {
        if (pairing) {
          pairing = false;
          lastStatusKey = null;
          publishStatus(currentStatus());
        }
      }
    },

    /** Configuration action "Test the connection". */
    async testConnection() {
      if (!session) return idleStatus().message;
      if (session.connected) {
        try {
          await session.connection.ping();
        } catch (error) {
          session.connection?.close(error);
          return describeError(error, config.bridgeHost);
        }
      } else {
        await session.reconnectNow();
      }
      lastStatusKey = null;
      const status = currentStatus();
      publishStatus(status);
      return status.message;
    },

    /** Configuration action "Forget the bridge". */
    async forget() {
      await stopSession();
      await gladys.setConfig({
        [STORAGE_KEYS.LEAP_KEY]: '',
        [STORAGE_KEYS.LEAP_CERT]: '',
        [STORAGE_KEYS.LEAP_CA]: '',
        [STORAGE_KEYS.BRIDGE_SERIAL]: '',
        [STORAGE_KEYS.BRIDGE_TYPE]: '',
      });
      config = { ...config, credentials: null, bridgeSerial: null, bridgeType: null };
      await publishStatus(idleStatus());
      logger.info('The Lutron bridge pairing was deleted');
      return MESSAGES.forgotten;
    },

    /** Reload everything from the bridge ("Refresh the devices"). */
    async refresh() {
      if (!session) return idleStatus().message;
      await session.restart();
      return currentStatus().message;
    },

    /** Configuration action "Diagnostics": an anonymized dump in the logs. */
    async diagnostics() {
      if (diagnosing) return MESSAGES.diagnosticsRunning;
      diagnosing = true;
      try {
        const status = session?.status();
        const header = {
          integration: 'gladys-lutron',
          version,
          node: process.version,
          paired: Boolean(config?.credentials),
          bridgeType: config?.bridgeType ?? null,
          buttonDetection: config?.buttonDetection ?? null,
          defaultFadeSeconds: config?.defaultFadeSeconds ?? null,
          session: status
            ? {
                state: status.state,
                leapVersion: status.leapVersion,
                error: status.error ? `${status.error.name}: ${status.error.message}` : null,
              }
            : null,
          bridge: info ? anonymize(info) : null,
        };
        const connected = Boolean(session?.connected && session.connection);
        const report = connected
          ? await collectDiagnostics(session.connection, { system: info?.system })
          : { entries: [], truncated: false, durationMs: 0 };
        for (const line of toLogLines(report, anonymize(header))) logger.info(line);
        return connected
          ? MESSAGES.diagnosticsDone(report.entries.length, report.truncated)
          : MESSAGES.diagnosticsOffline;
      } finally {
        diagnosing = false;
      }
    },

    async close() {
      await stopSession();
    },
  };
}

// -----------------------------------------------------------------------------
// Is the bridge offline, for the user: the transport badges of the devices
// and the scene triggers `bridge_offline` / `bridge_online`.
//
// A short loss (bridge reboot, Wi-Fi blip) is not worth a scene: the bridge
// is reported offline after 2 minutes without a working connection, once,
// and back online once. Nothing is reported before the first connection
// (start-up), nor while it was never reported offline.
// -----------------------------------------------------------------------------

export const OFFLINE_AFTER_MS = 2 * 60_000;

/**
 * @param {object} options
 * @param {(offline: boolean) => void} options.onTransports devices unreachable / local
 * @param {(key: 'offline' | 'online', data: object) => void} options.onEvent
 * @param {() => string} options.reason why the bridge is offline (English)
 * @param {() => string} options.bridgeName
 * @param {number} [options.offlineAfterMs]
 * @param {() => number} [options.now]
 */
export function createAvailability({
  onTransports,
  onEvent,
  reason,
  bridgeName,
  offlineAfterMs = OFFLINE_AFTER_MS,
  now = Date.now,
}) {
  let timer = null;
  let lostAt = null;
  let reported = false;

  return {
    get reportedOffline() {
      return reported;
    },

    /** The model is loaded: the bridge works. */
    online() {
      clearTimeout(timer);
      timer = null;
      if (reported) {
        reported = false;
        onTransports(false);
        onEvent('online', {
          bridge_name: bridgeName(),
          offline_seconds: Math.round((now() - lostAt) / 1000),
        });
      }
      lostAt = null;
    },

    /** The working connection was lost. */
    lost() {
      if (timer || reported) return;
      lostAt = now();
      timer = setTimeout(() => {
        timer = null;
        reported = true;
        onTransports(true);
        onEvent('offline', { bridge_name: bridgeName(), reason: reason() });
      }, offlineAfterMs);
      timer.unref?.();
    },

    /** Stopped on purpose (forgotten, new address, shutdown): nothing to report. */
    reset() {
      clearTimeout(timer);
      timer = null;
      lostAt = null;
      reported = false;
    },
  };
}

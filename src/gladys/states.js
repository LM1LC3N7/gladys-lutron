// -----------------------------------------------------------------------------
// States to Gladys: deduplicated, batched, kept under the rate limit.
//
// - Only the features of devices the user created are published: the core
//   ignores the others, but they would still count in its 300 states/minute.
// - A value equal to the last one published is skipped (the 15-minute resync
//   re-reads every state); the latest value of a feature wins in the queue.
// - At most 100 states per request, and a budget of 250 per minute: a big
//   resync is spread instead of being refused with a 429.
// - Button presses never go through here: every press is an event, published
//   at once with publishState, never deduplicated (see `publishEvent`).
// -----------------------------------------------------------------------------

export const PUBLISHER_LIMITS = Object.freeze({
  batchSize: 100,
  perMinute: 250,
  flushDelayMs: 50,
});

/**
 * @param {object} options
 * @param {{ publishStates: Function, publishState: Function, devices: any[] }} options.gladys
 * @param {{ warn: Function }} options.logger
 * @param {Partial<typeof PUBLISHER_LIMITS>} [options.limits]
 * @param {() => number} [options.now]
 */
export function createStatePublisher({ gladys, logger, limits = {}, now = Date.now }) {
  const { batchSize, perMinute, flushDelayMs } = { ...PUBLISHER_LIMITS, ...limits };
  /** @type {Map<string, number>} last value published, by feature external id */
  const published = new Map();
  /** @type {Map<string, number>} last value known, published or not */
  const latest = new Map();
  /** @type {Map<string, number>} */
  const queue = new Map();
  /** @type {number[]} times of the states sent in the last minute */
  const sent = [];
  let timer = null;
  let flushing = null;
  let closed = false;

  let createdSource = null;
  let created = new Set();
  const isCreated = (externalId) => {
    if (gladys.devices !== createdSource) {
      createdSource = gladys.devices;
      created = new Set(
        (gladys.devices ?? []).flatMap((device) =>
          (device.features ?? []).map((feature) => feature.external_id),
        ),
      );
    }
    return created.has(externalId);
  };

  const budget = () => {
    const horizon = now() - 60_000;
    while (sent.length > 0 && sent[0] <= horizon) sent.shift();
    return perMinute - sent.length;
  };

  const schedule = (delay = flushDelayMs) => {
    if (timer || closed) return;
    timer = setTimeout(() => {
      timer = null;
      flushing = flush().finally(() => {
        flushing = null;
      });
    }, delay);
    timer.unref?.();
  };

  async function flush() {
    if (queue.size === 0) return;
    const available = budget();
    if (available <= 0) {
      schedule(Math.max(flushDelayMs, sent[0] + 60_000 - now()));
      return;
    }
    const batch = [];
    for (const [externalId, value] of queue) {
      if (batch.length >= Math.min(batchSize, available)) break;
      batch.push([externalId, value]);
      queue.delete(externalId);
    }
    for (const [externalId, value] of batch) {
      published.set(externalId, value);
      sent.push(now());
    }
    try {
      await gladys.publishStates(
        batch.map(([externalId, value]) => ({
          device_feature_external_id: externalId,
          state: value,
        })),
      );
    } catch (error) {
      // Republished with the next change or resync.
      for (const [externalId] of batch) published.delete(externalId);
      logger.warn(`Could not publish ${batch.length} Lutron states: ${error.message}`);
    }
    if (queue.size > 0) schedule();
  }

  return {
    /**
     * @param {string} externalId feature external id
     * @param {number} value
     */
    set(externalId, value) {
      latest.set(externalId, value);
      if (!isCreated(externalId)) return;
      if (published.get(externalId) === value && !queue.has(externalId)) return;
      queue.set(externalId, value);
      schedule();
    },

    /** Publish again the known values of these features (device just created). */
    replay(externalIds) {
      for (const externalId of externalIds) {
        published.delete(externalId);
        if (latest.has(externalId)) this.set(externalId, latest.get(externalId));
      }
    },

    /** @param {string} externalId */
    latest(externalId) {
      return latest.get(externalId);
    },

    /**
     * An event (button press): published at once, never deduplicated. It
     * counts in the budget, so the queued states wait instead of a 429.
     *
     * @param {string} externalId
     * @param {number} value
     */
    async publishEvent(externalId, value) {
      // Not kept in `latest`: replaying a press would fire the scenes again.
      if (!isCreated(externalId)) return false;
      sent.push(now());
      try {
        await gladys.publishState(externalId, value);
        return true;
      } catch (error) {
        logger.warn(`Could not publish a Lutron button press: ${error.message}`);
        return false;
      }
    },

    /** Forget what was published (the next values all go out again). */
    reset() {
      published.clear();
    },

    /** Wait for the queue to drain (tests, shutdown). */
    async drain() {
      while (queue.size > 0 || timer || flushing) {
        clearTimeout(timer);
        timer = null;
        flushing ??= flush().finally(() => {
          flushing = null;
        });
        await flushing;
        if (queue.size > 0 && budget() <= 0) return;
      }
    },

    get pending() {
      return queue.size;
    },

    close() {
      closed = true;
      clearTimeout(timer);
      timer = null;
    },
  };
}

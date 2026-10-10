// An in-memory stand-in of the SDK's GladysIntegration, for the adapter tests
// (the wire format is covered by test/index.e2e.test.js).

const SELECTOR = 'ext-test-lutron';

/**
 * @param {object} [options]
 * @param {object} [options.config]
 * @param {object[]} [options.devices] devices created by the user
 */
export function createMemoryGladys({ config = {}, devices = [] } = {}) {
  const calls = [];
  const record =
    (name, answer = { success: true }) =>
    async (...args) => {
      calls.push({ name, args });
      return typeof answer === 'function' ? answer(...args) : answer;
    };
  const gladys = {
    selector: SELECTOR,
    config,
    devices,
    calls,
    externalId: (suffix) => `ext:${SELECTOR}:${suffix}`,
    externalIds(type, platformId) {
      const device = `ext:${SELECTOR}:${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },
    publishStates: record('publishStates'),
    publishState: record('publishState'),
    publishDiscoveredDevices: record('publishDiscoveredDevices'),
    publishTransports: record('publishTransports'),
    publishSceneEvent: record('publishSceneEvent'),
    setConnectionStatus: record('setConnectionStatus'),
    setConfig: record('setConfig', (partial) => {
      Object.assign(config, partial);
      return { success: true };
    }),
    scanNetwork: record('scanNetwork', []),
    requestWidgetRefresh: (key) => calls.push({ name: 'requestWidgetRefresh', args: [key] }),
    /** Calls of one method. */
    callsOf: (name) => calls.filter((call) => call.name === name).map((call) => call.args),
    /** Every state published, in order: [externalId, value]. */
    states() {
      return calls.flatMap((call) => {
        if (call.name === 'publishStates') {
          return call.args[0].map((s) => [s.device_feature_external_id, s.state]);
        }
        if (call.name === 'publishState') return [[call.args[0], call.args[1]]];
        return [];
      });
    },
    /** Create every discovered device, as the user would. */
    createAll() {
      const published = gladys.callsOf('publishDiscoveredDevices').at(-1)?.[0] ?? [];
      gladys.devices = structuredClone(published);
      return gladys.devices;
    },
  };
  return gladys;
}

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

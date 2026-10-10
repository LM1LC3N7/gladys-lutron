// -----------------------------------------------------------------------------
// The Lutron integration, seen from Gladys: ties the bridge controller (pairing,
// session), the live Lutron system (model, states, commands) and the Gladys
// surfaces (Discover tab, states, commands, transports, scene triggers).
// index.js only registers these handlers on the SDK.
// -----------------------------------------------------------------------------

import { normalizeConfig } from '../config.js';
import { LutronSystem } from '../leap/system.js';
import { createAvailability } from './availability.js';
import { createBridgeController } from './bridgeController.js';
import { createCommandHandler } from './commands.js';
import { buildCatalog, zoneValues } from './devices.js';
import { SCENE_TRIGGERS } from './keys.js';
import { bridgeLabel, describeSession } from './messages.js';
import { createStatePublisher } from './states.js';

const TRANSPORT_BATCH = 100;

/**
 * @param {object} options
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
 * @param {{ debug: Function, info: Function, warn: Function, error: Function }} options.logger
 * @param {string} [options.version]
 * @param {{ leap?: number, pairing?: number }} [options.ports]
 * @param {object} [options.controllerOptions] extra options of the bridge controller (tests)
 * @param {object} [options.systemOptions] extra options of the Lutron system (tests)
 * @param {object} [options.publisherLimits]
 * @param {number} [options.offlineAfterMs]
 */
export function createLutronIntegration({
  gladys,
  logger,
  version,
  ports,
  controllerOptions = {},
  systemOptions = {},
  publisherLimits,
  offlineAfterMs,
}) {
  let config = normalizeConfig({});
  /** @type {import('./devices.js').Catalog | null} */
  let catalog = null;

  const system = new LutronSystem({ logger, ...systemOptions });
  const publisher = createStatePublisher({ gladys, logger, limits: publisherLimits });
  const bridge = createBridgeController({
    gladys,
    logger,
    version,
    ports,
    onReady: (connection, info) => system.attach(connection, info),
    ...controllerOptions,
  });

  const ourDevices = () => {
    const ids = new Set(catalog?.devices.map((device) => device.external_id) ?? []);
    return (gladys.devices ?? []).filter((device) => ids.has(device.external_id));
  };

  const publishTransports = async (devices, offline) => {
    const entries = devices.map((device) => ({
      external_id: device.external_id,
      transport: offline ? 'unreachable' : 'local',
    }));
    for (let i = 0; i < entries.length; i += TRANSPORT_BATCH) {
      await gladys.publishTransports(entries.slice(i, i + TRANSPORT_BATCH)).catch((error) => {
        logger.warn(`Could not publish the transport badges: ${error.message}`);
      });
    }
  };

  const availability = createAvailability({
    offlineAfterMs,
    bridgeName: () => bridgeLabel(bridge.info ?? catalog?.bridge ?? null),
    reason: () => {
      const status = bridge.session?.status();
      return status ? describeSession(status, bridge.info).message.en : 'Stopped';
    },
    onTransports: (offline) => publishTransports(ourDevices(), offline),
    onEvent: (key, data) => {
      const trigger =
        key === 'offline' ? SCENE_TRIGGERS.BRIDGE_OFFLINE : SCENE_TRIGGERS.BRIDGE_ONLINE;
      logger.info(`Lutron bridge ${key === 'offline' ? 'offline' : 'back online'}`);
      gladys.publishSceneEvent(trigger, data).catch((error) => {
        logger.warn(`Could not publish the scene event ${trigger}: ${error.message}`);
      });
    },
  });

  const publishDiscovered = async () => {
    try {
      await gladys.publishDiscoveredDevices(catalog?.devices ?? []);
    } catch (error) {
      logger.warn(`Could not publish the discovered Lutron devices: ${error.message}`);
    }
  };

  const publishBattery = (externalId) => {
    const sources = catalog?.batterySources.get(externalId) ?? [];
    const known = sources.filter((deviceId) => system.batteries.has(deviceId));
    if (known.length === 0) return;
    publisher.set(externalId, known.some((deviceId) => system.batteries.get(deviceId)) ? 1 : 0);
  };

  system.on('model', (model) => {
    catalog = buildCatalog(model, {
      externalIds: (type, id) => gladys.externalIds(type, id),
      bridgeSerial: model.bridge.serial ?? config.bridgeSerial ?? 'bridge',
    });
    logger.info(
      `Lutron project loaded: ${model.zones.length} zones, ${model.buttonDevices.length} remotes and keypads, ${model.scenes.length} scenes, ${model.occupancyGroups.length} occupancy groups`,
    );
    publishDiscovered();
    publishTransports(ourDevices(), false);
    availability.online();
    for (const externalId of catalog.batterySources.keys()) publishBattery(externalId);
  });

  system.on('zone', (zone, state) => {
    const keys = catalog?.zoneFeatures.get(zone.id);
    if (!keys) return;
    for (const [externalId, value] of zoneValues(zone, state, keys))
      publisher.set(externalId, value);
  });

  system.on('occupancy', (group, occupied) => {
    const externalId = catalog?.occupancyFeatures.get(group.id)?.occupancy;
    if (externalId && occupied !== null) publisher.set(externalId, occupied ? 1 : 0);
  });

  system.on('smartAway', (enabled) => {
    if (catalog?.smartAwayFeature) publisher.set(catalog.smartAwayFeature, enabled ? 1 : 0);
  });

  system.on('battery', (deviceId) => {
    for (const externalId of catalog?.batteryFeatures.get(deviceId) ?? [])
      publishBattery(externalId);
  });

  system.on('offline', () => {
    // A session still alive will reconnect; none means a deliberate stop.
    if (bridge.session) availability.lost();
  });

  return {
    bridge,
    system,
    publisher,
    get catalog() {
      return catalog;
    },
    get config() {
      return config;
    },

    /** @param {Record<string, unknown>} raw */
    async applyConfig(raw = {}) {
      config = normalizeConfig(raw);
      await bridge.apply(config);
    },

    /** The Discover tab asks for the devices. */
    onScanRequest: () => publishDiscovered(),

    onSetValue: createCommandHandler({
      system,
      catalog: () => catalog,
      fadeSeconds: () => config.defaultFadeSeconds,
      publisher,
    }),

    /** A device was just created: give it its current states and badge. */
    async onDeviceCreated(device) {
      publisher.replay((device?.features ?? []).map((feature) => feature.external_id));
      if (catalog?.devices.some((d) => d.external_id === device?.external_id)) {
        await publishTransports([device], !system.ready && availability.reportedOffline);
      }
    },

    async close() {
      availability.reset();
      publisher.close();
      await bridge.close();
    },
  };
}

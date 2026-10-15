// -----------------------------------------------------------------------------
// The Lutron integration, seen from Gladys: ties the bridge controller (pairing,
// session), the live Lutron system (model, states, commands) and the Gladys
// surfaces (Discover tab, states, commands, transports, scene triggers and
// actions, dashboard widget).
// index.js only registers these handlers on the SDK.
// -----------------------------------------------------------------------------

import { normalizeConfig } from '../config.js';
import { createButtonTracker } from '../leap/buttonTracker.js';
import { LutronSystem } from '../leap/system.js';
import { createAvailability } from './availability.js';
import { createBridgeController } from './bridgeController.js';
import { createCommandHandler } from './commands.js';
import { BUTTON_VALUES, buildCatalog, zoneValues } from './devices.js';
import { SCENE_TRIGGERS, WIDGETS } from './keys.js';
import { MESSAGES, bridgeLabel, describeSession } from './messages.js';
import { createSceneActions } from './sceneActions.js';
import { createStatePublisher } from './states.js';
import { WIDGET_ACTIONS, buildOverview } from './widget.js';

const TRANSPORT_BATCH = 100;
const RECENT_PRESSES = 8;

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
  /** @type {{ device: string, button: string, press: string, at: string }[]} newest first */
  const recentPresses = [];

  const system = new LutronSystem({ logger, ...systemOptions });
  const publisher = createStatePublisher({ gladys, logger, limits: publisherLimits });
  const bridge = createBridgeController({
    gladys,
    logger,
    version,
    ports,
    onReady: (connection, info) => system.attach(connection, info),
    onStopped: () => availability.reset(),
    ...controllerOptions,
  });

  // "The data changed": the core re-pulls the widget (it drops nudges
  // closer than 10 s apart).
  const refreshWidget = () => {
    try {
      gladys.requestWidgetRefresh?.(WIDGETS.OVERVIEW);
    } catch (error) {
      logger.debug(`Widget refresh nudge failed: ${error.message}`);
    }
  };

  // The controller keeps the pairing current (pair, forget, serial read):
  // `config` only gets it back with the next config-updated or reconnection,
  // since setConfig does not echo.
  const pairing = () => bridge.config ?? config;

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

  // Hidden types are only left out of the Discover tab: devices already
  // created keep their states and commands.
  const publishDiscovered = async () => {
    const hidden = new Set(config.hiddenDeviceTypes);
    const devices = (catalog?.devices ?? []).filter(
      (device) => !hidden.has(catalog.groupOfDevice.get(device.external_id)),
    );
    try {
      await gladys.publishDiscoveredDevices(devices);
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
    tracker.reset();
    catalog = buildCatalog(model, {
      externalIds: (type, id) => gladys.externalIds(type, id),
      bridgeSerial: model.bridge.serial ?? pairing().bridgeSerial ?? 'bridge',
    });
    logger.info(
      `Lutron project loaded: ${model.zones.length} zones, ${model.buttonDevices.length} remotes and keypads, ${model.scenes.length} scenes, ${model.occupancyGroups.length} occupancy groups`,
    );
    publishDiscovered();
    publishTransports(ourDevices(), false);
    availability.online();
    for (const externalId of catalog.batterySources.keys()) publishBattery(externalId);
    refreshWidget();
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
    refreshWidget();
  });

  system.on('smartAway', (enabled) => {
    if (catalog?.smartAwayFeature) publisher.set(catalog.smartAwayFeature, enabled ? 1 : 0);
    refreshWidget();
  });

  system.on('led', (ledId, on) => {
    const externalId = catalog?.ledFeatures.get(ledId);
    if (externalId) publisher.set(externalId, on ? 1 : 0);
  });

  system.on('areaScene', (scene, areaId) => {
    const area = system.model?.areas.get(areaId)?.name ?? scene.area ?? '';
    logger.debug(`Lutron area scene: ${area} / ${scene.name}`);
    gladys
      .publishSceneEvent(SCENE_TRIGGERS.AREA_SCENE_ACTIVATED, { area, scene: scene.name })
      .catch((error) => logger.warn(`Could not publish the area scene event: ${error.message}`));
  });

  system.on('battery', (deviceId) => {
    for (const externalId of catalog?.batteryFeatures.get(deviceId) ?? [])
      publishBattery(externalId);
  });

  const tracker = createButtonTracker({
    mode: config.buttonDetection,
    onPress: (buttonId, press) => {
      const externalId = catalog?.buttonFeatures.get(buttonId);
      const entry = system.buttons.get(buttonId);
      if (!externalId || !entry) return;
      logger.debug(`Lutron ${entry.device.name} / ${entry.button.name}: ${press}`);
      recentPresses.unshift({
        device: entry.device.name,
        button: entry.button.name,
        press,
        at: new Date().toISOString(),
      });
      recentPresses.length = Math.min(recentPresses.length, RECENT_PRESSES);
      publisher.publishEvent(externalId, BUTTON_VALUES[press]);
      refreshWidget();
    },
  });

  system.on('button', (_device, button, event) => {
    tracker.handle(button.id, event, { raiseLower: button.raiseLower });
  });

  system.on('offline', () => {
    tracker.reset();
    refreshWidget();
    // A session still alive will reconnect; none means a deliberate stop.
    if (bridge.session) availability.lost();
  });

  const sceneActions = createSceneActions({ system, catalog: () => catalog });

  const overview = () => {
    const model = system.model;
    const status = bridge.session?.status();
    const occupiedAreas = (model?.occupancyGroups ?? [])
      .filter((group) => system.occupancy.get(group.id) === true)
      .map((group) => group.area ?? group.name);
    const batteryDevices = [
      ...(model?.zones ?? []).filter((zone) => zone.battery).map((zone) => zone.deviceId),
      ...(model?.occupancyGroups ?? []).flatMap((group) => group.sensorDeviceIds),
    ].filter((deviceId) => system.batteries.has(deviceId));
    return buildOverview({
      paired: Boolean(pairing().credentials),
      connected: system.ready,
      label: bridgeLabel(bridge.info ?? model?.bridge ?? null),
      leapVersion: status?.leapVersion ?? null,
      statusMessage: status ? describeSession(status, bridge.info).message : MESSAGES.notPaired,
      smartAwaySupported: Boolean(model?.smartAway),
      smartAway: system.smartAway,
      devices: catalog?.devices.length ?? 0,
      occupiedAreas,
      lowBatteries:
        batteryDevices.length > 0
          ? new Set(batteryDevices.filter((deviceId) => system.batteries.get(deviceId))).size
          : null,
      recentPresses,
    });
  };

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
    /** The last button presses, newest first (dashboard widget). */
    get recentPresses() {
      return recentPresses;
    },

    /** @param {Record<string, unknown>} raw */
    async applyConfig(raw = {}) {
      const previous = config;
      config = normalizeConfig(raw);
      tracker.setMode(config.buttonDetection);
      await bridge.apply(config);
      if (catalog && previous.hiddenDeviceTypes.join() !== config.hiddenDeviceTypes.join()) {
        await publishDiscovered();
      }
    },

    /** The Discover tab asks for the devices. */
    onScanRequest: () => publishDiscovered(),

    onSetValue: createCommandHandler({
      system,
      catalog: () => catalog,
      fadeSeconds: () => config.defaultFadeSeconds,
      publisher,
    }),

    /** Scene action "Lutron: set a level with a fade". */
    setLevelWithFade: (fields) => sceneActions.setLevelWithFade(fields),

    /** Scene action "Lutron: press a keypad button". */
    pressKeypadButton: (fields) => sceneActions.pressKeypadButton(fields),

    /** Scene action "Lutron: tilt the slats". */
    setTilt: (fields) => sceneActions.setTilt(fields),

    /** The "Lutron overview" widget content. */
    getOverview: () => overview(),

    /** A button of the widget. */
    async onWidgetAction(actionKey) {
      switch (actionKey) {
        case WIDGET_ACTIONS.SMART_AWAY_ON:
        case WIDGET_ACTIONS.SMART_AWAY_OFF: {
          const enabled = actionKey === WIDGET_ACTIONS.SMART_AWAY_ON;
          await system.setSmartAwayEnabled(enabled);
          refreshWidget();
          return enabled
            ? { en: 'Smart Away is on.', fr: 'Smart Away est activé.' }
            : { en: 'Smart Away is off.', fr: 'Smart Away est désactivé.' };
        }
        case WIDGET_ACTIONS.RECONNECT: {
          const message = await bridge.testConnection();
          refreshWidget();
          return message;
        }
        default:
          throw new Error(`Unknown widget action "${actionKey}"`);
      }
    },

    /** A device was just created: give it its current states and badge. */
    async onDeviceCreated(device) {
      publisher.replay((device?.features ?? []).map((feature) => feature.external_id));
      if (catalog?.devices.some((d) => d.external_id === device?.external_id)) {
        await publishTransports([device], !system.ready && availability.reportedOffline);
      }
    },

    async close() {
      tracker.reset();
      availability.reset();
      publisher.close();
      await bridge.close();
    },
  };
}

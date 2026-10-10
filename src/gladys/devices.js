// -----------------------------------------------------------------------------
// The Lutron model as Gladys devices (the Discover tab), and the index from a
// feature external id to what it drives.
//
// External ids are frozen once released (see CLAUDE.md):
//   zone       <serial of the Lutron device>, or <bridge serial>-zone-<zone id>
//              (no serial, or a serial that is not unique in the project)
//   occupancy  <bridge serial>-<occupancy group id>
//   scene      <bridge serial>-scene-<virtual button id>
//   remote     <serial of the Pico / keypad>, or <bridge serial>-device-<id>
//   bridge     <bridge serial>
// Feature keys: on, brightness, temperature, color, warm-dim, position,
// state, speed, battery-low, occupancy, smart-away, push,
// button-<ButtonNumber>, led-<ButtonNumber>.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { hueSaturationToRgb } from '../leap/color.js';
import { PRESSES } from '../leap/buttonTracker.js';
import { KINDS } from '../leap/deviceTypes.js';

/** @typedef {import('@gladysassistant/integration-sdk').Device} Device */
/** @typedef {import('@gladysassistant/integration-sdk').DeviceFeature} DeviceFeature */

/**
 * What a feature drives, for the commands and the states.
 *
 * @typedef {object} Target
 * @property {string} action  on | brightness | switch | speed | state | position | smart-away | scene
 * @property {string} [zoneId]
 * @property {string} [kind]
 * @property {string} [sceneId]
 */

/**
 * @typedef {object} Catalog
 * @property {Device[]} devices
 * @property {Map<string, Target>} targets feature external id -> target
 * @property {Map<string, Record<string, string>>} zoneFeatures zone id -> { key: feature external id }
 * @property {Map<string, Record<string, string>>} occupancyFeatures group id -> { key: feature external id }
 * @property {Map<string, string[]>} batteryFeatures device id -> battery-low feature external ids
 * @property {Map<string, string[]>} batterySources battery-low feature external id -> device ids
 * @property {import('../leap/bridgeInfo.js').BridgeInfo} bridge
 * @property {Map<string, string>} buttonFeatures button id -> feature external id
 * @property {Map<string, string>} ledFeatures LED id -> feature external id
 * @property {Map<string, string>} remoteOfDevice device external id -> Lutron button device id
 * @property {Map<string, string>} zoneOfDevice device external id -> zone id
 * @property {string | null} smartAwayFeature
 * @property {Map<string, string>} deviceOfFeature feature external id -> device external id
 */

const PERCENT = 'percent';

/** Gladys BUTTON_STATUS values (server/utils/constants.js). */
export const BUTTON_VALUES = Object.freeze({
  [PRESSES.CLICK]: 1,
  [PRESSES.DOUBLE]: 2,
  [PRESSES.LONG_PRESS]: 3,
  [PRESSES.LONG_RELEASE]: 4,
});

const BUTTON_OPTIONS = [
  { value: 1, label: 'Click', sort_order: 0 },
  { value: 2, label: 'Double click', sort_order: 1 },
  { value: 3, label: 'Long press', sort_order: 2 },
  { value: 4, label: 'Long press released', sort_order: 3 },
];

const feature = (externalId, name, category, type, extra = {}) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: false,
  has_feedback: true,
  keep_history: true,
  min: 0,
  max: 1,
  ...extra,
});

const param = (name, value) => (value ? [{ name, value: String(value) }] : []);

// The catalog is published while connected: every device is reachable locally.
const TRANSPORT = [{ name: 'GLADYS_TRANSPORT', value: 'local' }];

/**
 * Features of a zone, by kind.
 *
 * @returns {[string, string, string, string, object][]} [key, name, category, type, extra]
 */
function zoneFeatureSpecs(zone) {
  const onOff = ['on', 'Power', C.LIGHT, T.LIGHT.BINARY, {}];
  const brightness = [
    'brightness',
    'Brightness',
    C.LIGHT,
    T.LIGHT.BRIGHTNESS,
    { min: 0, max: 100, unit: PERCENT },
  ];
  const coverCategory = zone.kind === KINDS.DRAPE ? C.CURTAIN : C.SHUTTER;
  const coverTypes = zone.kind === KINDS.DRAPE ? T.CURTAIN : T.SHUTTER;
  const state = [
    'state',
    'Open / close',
    coverCategory,
    coverTypes.STATE,
    { min: -1, max: 1, has_feedback: false, keep_history: false },
  ];
  const position = [
    'position',
    'Position',
    coverCategory,
    coverTypes.POSITION,
    { min: 0, max: 100, unit: PERCENT },
  ];
  switch (zone.kind) {
    case KINDS.DIMMER:
      return [onOff, brightness];
    case KINDS.WHITE_TUNE:
    case KINDS.SPECTRUM: {
      const range = zone.whiteRange ?? { min: 1400, max: 10000 };
      const temperature = [
        'temperature',
        'Colour temperature',
        C.LIGHT,
        T.LIGHT.TEMPERATURE,
        { min: range.min, max: range.max, unit: U.KELVIN },
      ];
      const color = ['color', 'Colour', C.LIGHT, T.LIGHT.COLOR, { min: 0, max: 0xffffff }];
      const warmDim = ['warm-dim', 'Warm dim', C.SWITCH, T.SWITCH.BINARY, {}];
      return zone.kind === KINDS.SPECTRUM
        ? [onOff, brightness, temperature, color, warmDim]
        : [onOff, brightness, temperature, warmDim];
    }
    case KINDS.SWITCH:
    case KINDS.CCO:
      return [['on', 'Power', C.SWITCH, T.SWITCH.BINARY, {}]];
    case KINDS.FAN:
      return [
        ['speed', 'Speed', C.FAN, T.FAN.PERCENT, { min: 0, max: 100, step: 25, unit: PERCENT }],
      ];
    case KINDS.TILT_BLIND:
      return [
        state,
        [
          'position',
          'Tilt',
          coverCategory,
          coverTypes.POSITION,
          { min: 0, max: 100, unit: PERCENT },
        ],
      ];
    case KINDS.OPEN_CLOSE:
      return [state];
    default:
      return [state, position];
  }
}

const ZONE_ACTIONS = {
  [C.LIGHT]: { on: 'on', brightness: 'brightness' },
  [C.SWITCH]: { on: 'switch', 'warm-dim': 'warm-dim' },
  [C.FAN]: { speed: 'speed' },
};

/**
 * @param {import('../leap/model.js').LutronModel} model
 * @param {object} options
 * @param {(type: string, platformId: string) => { device: string, feature: (key: string) => string }} options.externalIds
 * @param {string} options.bridgeSerial
 * @returns {Catalog}
 */
export function buildCatalog(model, { externalIds, bridgeSerial }) {
  /** @type {Catalog} */
  const catalog = {
    devices: [],
    targets: new Map(),
    zoneFeatures: new Map(),
    occupancyFeatures: new Map(),
    batteryFeatures: new Map(),
    batterySources: new Map(),
    bridge: model.bridge,
    buttonFeatures: new Map(),
    ledFeatures: new Map(),
    remoteOfDevice: new Map(),
    zoneOfDevice: new Map(),
    smartAwayFeature: null,
    deviceOfFeature: new Map(),
  };
  const addDevice = (ids, device) => {
    catalog.devices.push({
      external_id: ids.device,
      ...device,
      params: [...device.params, ...TRANSPORT],
    });
    for (const f of device.features) catalog.deviceOfFeature.set(f.external_id, ids.device);
  };
  const addBattery = (ids, deviceIds, features) => {
    const externalId = ids.feature('battery-low');
    features.push(
      feature(externalId, 'Battery low', C.BATTERY_LOW, T.BATTERY_LOW.BINARY, {
        read_only: true,
        keep_history: false,
      }),
    );
    catalog.batterySources.set(externalId, deviceIds);
    for (const deviceId of deviceIds) {
      catalog.batteryFeatures.set(deviceId, [
        ...(catalog.batteryFeatures.get(deviceId) ?? []),
        externalId,
      ]);
    }
  };

  // A serial shared by two devices (or with the bridge) cannot identify one:
  // those zones take the project-scoped form, stable across reloads.
  const serialCount = new Map([[bridgeSerial, 1]]);
  for (const item of [...model.zones, ...model.buttonDevices]) {
    if (item.serial) serialCount.set(item.serial, (serialCount.get(item.serial) ?? 0) + 1);
  }
  const uniqueSerial = (serial) => Boolean(serial) && serialCount.get(serial) === 1;
  for (const zone of model.zones) {
    const ids = externalIds(
      'zone',
      uniqueSerial(zone.serial) ? zone.serial : `${bridgeSerial}-zone-${zone.id}`,
    );
    const keys = {};
    const features = zoneFeatureSpecs(zone).map(([key, name, category, type, extra]) => {
      const externalId = ids.feature(key);
      keys[key] = externalId;
      const action = ZONE_ACTIONS[category]?.[key] ?? key;
      catalog.targets.set(externalId, { action, zoneId: zone.id, kind: zone.kind });
      return feature(externalId, name, category, type, extra);
    });
    if (zone.battery) addBattery(ids, [zone.deviceId], features);
    catalog.zoneFeatures.set(zone.id, keys);
    catalog.zoneOfDevice.set(ids.device, zone.id);
    addDevice(ids, {
      name: zone.name,
      model: zone.model ?? zone.type,
      features,
      params: [
        ...param('LUTRON_AREA', zone.area),
        ...param('LUTRON_TYPE', zone.type),
        ...param('LUTRON_MODEL', zone.model),
      ],
    });
  }

  for (const remote of model.buttonDevices) {
    const ids = externalIds(
      'remote',
      uniqueSerial(remote.serial) ? remote.serial : `${bridgeSerial}-device-${remote.id}`,
    );
    const used = new Set();
    const suffixes = new Map(); // button id -> "<number>" (or "<number>-<id>" when repeated)
    const features = remote.buttons.map((button) => {
      let suffix = String(button.number);
      if (used.has(suffix)) suffix = `${suffix}-${button.id}`;
      used.add(suffix);
      suffixes.set(button.id, suffix);
      const key = `button-${suffix}`;
      const externalId = ids.feature(key);
      catalog.buttonFeatures.set(button.id, externalId);
      return feature(externalId, button.name, C.BUTTON, T.BUTTON.CLICK, {
        read_only: true,
        has_feedback: false,
        min: 1,
        max: 4,
        supported_options: BUTTON_OPTIONS,
      });
    });
    catalog.remoteOfDevice.set(ids.device, remote.id);
    // Keypad LEDs (RA3 / QSX), after the buttons.
    for (const button of remote.buttons.filter((b) => b.ledId)) {
      const externalId = ids.feature(`led-${suffixes.get(button.id)}`);
      catalog.ledFeatures.set(button.ledId, externalId);
      catalog.targets.set(externalId, { action: 'led', ledId: button.ledId });
      features.push(
        feature(externalId, `${button.name} LED`, C.SWITCH, T.SWITCH.BINARY, {
          keep_history: false,
        }),
      );
    }
    addDevice(ids, {
      name: remote.name,
      model: remote.model ?? remote.type,
      features,
      params: [
        ...param('LUTRON_AREA', remote.area),
        ...param('LUTRON_TYPE', remote.type),
        ...param('LUTRON_MODEL', remote.model),
      ],
    });
  }

  for (const group of model.occupancyGroups) {
    const ids = externalIds('occupancy', `${bridgeSerial}-${group.id}`);
    const occupied = ids.feature('occupancy');
    const features = [
      feature(occupied, 'Occupancy', C.PRESENCE_SENSOR, T.SENSOR.BINARY, { read_only: true }),
    ];
    if (group.battery) addBattery(ids, group.sensorDeviceIds, features);
    catalog.occupancyFeatures.set(group.id, { occupancy: occupied });
    addDevice(ids, {
      name: group.name,
      model: 'Occupancy group',
      features,
      params: param('LUTRON_AREA', group.area),
    });
  }

  for (const scene of model.scenes.filter((s) => s.source === 'virtualbutton')) {
    const ids = externalIds('scene', `${bridgeSerial}-scene-${scene.id}`);
    const push = ids.feature('push');
    catalog.targets.set(push, { action: 'scene', sceneId: scene.id });
    addDevice(ids, {
      name: `Scene ${scene.name}`,
      model: 'Lutron scene',
      features: [
        feature(push, 'Activate', C.BUTTON, T.BUTTON.PUSH, {
          has_feedback: false,
          keep_history: false,
        }),
      ],
      params: [],
    });
  }

  if (model.smartAway) {
    const ids = externalIds('bridge', bridgeSerial);
    const away = ids.feature('smart-away');
    catalog.smartAwayFeature = away;
    catalog.targets.set(away, { action: 'smart-away' });
    addDevice(ids, {
      name: model.bridge.name || 'Lutron bridge',
      model: model.bridge.model ?? 'Lutron bridge',
      features: [feature(away, 'Smart Away', C.SWITCH, T.SWITCH.BINARY)],
      params: param('LUTRON_FIRMWARE', model.bridge.firmware),
    });
  }

  return catalog;
}

/**
 * Feature values of a zone state.
 *
 * @param {import('../leap/model.js').Zone} zone
 * @param {import('../leap/status.js').ZoneState} state
 * @param {Record<string, string>} keys feature external ids of the zone
 * @returns {[string, number][]}
 */
export function zoneValues(zone, state, keys) {
  const values = [];
  const push = (key, value) => {
    if (keys[key] && value !== null && value !== undefined && Number.isFinite(value)) {
      values.push([keys[key], value]);
    }
  };
  switch (zone.kind) {
    case KINDS.DIMMER:
    case KINDS.WHITE_TUNE:
    case KINDS.SPECTRUM:
      push('brightness', state.level);
      push('on', state.level === null ? null : state.level > 0 ? 1 : 0);
      push('temperature', state.kelvin);
      if (state.hue !== null && state.hue !== undefined && state.saturation !== null) {
        push('color', hueSaturationToRgb(state.hue, state.saturation));
      }
      push(
        'warm-dim',
        state.warmDim === null || state.warmDim === undefined ? null : state.warmDim ? 1 : 0,
      );
      break;
    case KINDS.SWITCH:
    case KINDS.CCO:
      push(
        'on',
        state.on !== null
          ? state.on
            ? 1
            : 0
          : state.level === null
            ? null
            : state.level > 0
              ? 1
              : 0,
      );
      break;
    case KINDS.FAN: {
      const speeds = { Off: 0, Low: 25, Medium: 50, MediumHigh: 75, High: 100 };
      push('speed', speeds[state.fanSpeed] ?? null);
      break;
    }
    case KINDS.TILT_BLIND:
      push('position', state.tilt);
      break;
    case KINDS.OPEN_CLOSE:
      break;
    default:
      push('position', state.level);
  }
  return values;
}

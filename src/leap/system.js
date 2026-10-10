// -----------------------------------------------------------------------------
// The live Lutron system: the model of the project, the current states, and
// the commands. Attached to each new connection by the session (`onReady`):
// loads the model, subscribes, reads every state, then emits the changes.
//
// - Subscriptions and unsolicited messages are routed by their body (zone,
//   occupancy, Smart Away, button, LED, area status), whatever their tag.
// - Events received while the model loads only update the states; they are
//   emitted once the load is over (with every state read explicitly).
// - Every state is read again every 15 minutes: a subscription can go silent
//   without the connection dropping (Home Assistant #128541).
// - No Gladys here: the adapter (src/gladys/) listens to the events.
//
// Caséta / RA2 Select: unsolicited zone statuses, every zone read one by
// one. RA3 / QSX: `/zone/status`, `/area/status` (occupancy and the active
// area scene) and every keypad LED are subscribed.
//
// Events: 'model' (model), 'zone' (zone, state), 'occupancy' (group,
// occupied), 'smartAway' (enabled), 'battery' (deviceId, low), 'button'
// (device, button, event: Press | Release | MultiTap | LongHold), 'led'
// (ledId, on), 'areaScene' (scene, areaId), 'offline'.
// Button events are only emitted once the model is loaded: a press during a
// reload is dropped, never replayed late.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { rgbToHueSaturation } from './color.js';
import {
  fanCommand,
  hsvCommand,
  kelvinCommand,
  levelCommand,
  moveCommand,
  pressCommand,
  tiltCommand,
  warmDimCommand,
} from './commands.js';
import { KINDS } from './deviceTypes.js';
import { BridgeOfflineError, LeapStatusError } from './errors.js';
import { loadCasetaModel, readBatteries, readOptional } from './model.js';
import { loadProcessorModel } from './processorModel.js';
import {
  areaStatesOf,
  occupancyStatesOf,
  parseButtonEvent,
  parseLedStatus,
  smartAwayOf,
  zoneStatesOf,
} from './status.js';

/**
 * The model of any Lutron system: Caséta / RA2 Select, or a processor.
 *
 * @param {{ read(url: string): Promise<any> }} connection
 * @param {import('./bridgeInfo.js').BridgeInfo} bridge
 */
export function loadModel(connection, bridge) {
  return bridge.system === 'caseta'
    ? loadCasetaModel(connection, bridge)
    : loadProcessorModel(connection, bridge);
}

/**
 * A scene change right after our own keypad press is not the user's (in
 * any area: a keypad may drive the scene of another room).
 */
const OWN_COMMAND_MS = 5000;

/** Subscriptions in flight at once: a big QSX has hundreds of keys and LEDs. */
const SUBSCRIBE_CONCURRENCY = 10;

/** Run `task` on every item, at most `limit` at a time. */
async function eachLimited(items, limit, task) {
  const queue = [...items];
  const worker = async () => {
    while (queue.length > 0) await task(queue.shift());
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}

export const SYSTEM_TIMINGS = Object.freeze({
  resyncIntervalMs: 15 * 60_000,
});

const ZONE_FIELDS = ['level', 'on', 'fanSpeed', 'tilt', 'kelvin', 'hue', 'saturation', 'warmDim'];

export class LutronSystem extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {{ debug: Function, info: Function, warn: Function }} [options.logger]
   * @param {Partial<typeof SYSTEM_TIMINGS>} [options.timings]
   * @param {typeof loadModel} [options.load]
   */
  constructor({ logger, timings = {}, load = loadModel } = {}) {
    super();
    this.logger = logger;
    this.timings = { ...SYSTEM_TIMINGS, ...timings };
    this.load = load;
    /** @type {import('./model.js').LutronModel | null} */
    this.model = null;
    /** @type {import('./connection.js').LeapConnection | null} */
    this.connection = null;
    this.loading = false;
    this.ready = false;
    this.resyncTimer = null;
    /** @type {Map<string, import('./status.js').ZoneState>} */
    this.zones = new Map();
    /** @type {Map<string, boolean | null>} */
    this.occupancy = new Map();
    /** @type {Map<string, boolean>} device id -> battery low */
    this.batteries = new Map();
    /** @type {boolean | null} */
    this.smartAway = null;
    /** @type {Map<string, number>} zone id -> last level above 0 ("on" restores it) */
    this.lastLevels = new Map();
    this.loggedTypes = new Set();
    /** @type {Map<string, { device: import('./model.js').ButtonDevice, button: import('./model.js').Button }>} */
    this.buttons = new Map();
    /** @type {Map<string, boolean>} LED id -> on */
    this.leds = new Map();
    /** @type {Map<string, string | null>} area id -> active area scene id */
    this.areaScenes = new Map();
    /** Time of our last keypad press (area scene changes ignored for a while). */
    this.lastOwnPress = 0;
  }

  get processor() {
    return Boolean(this.model && this.model.system !== 'caseta');
  }

  /** @param {string} zoneId */
  zone(zoneId) {
    return this.model?.zones.find((zone) => zone.id === zoneId) ?? null;
  }

  /**
   * Load the model on a fresh connection and subscribe (session `onReady`).
   *
   * @param {import('./connection.js').LeapConnection} connection
   * @param {import('./bridgeInfo.js').BridgeInfo} bridge
   */
  async attach(connection, bridge) {
    this.detach();
    this.connection = connection;
    this.loading = true;
    this.zones.clear();
    this.occupancy.clear();
    this.leds.clear();
    this.areaScenes.clear();
    connection.on('unsolicited', (response) => this.receive(connection, response.body));
    connection.once('close', () => {
      if (this.connection !== connection) return;
      const wasReady = this.ready;
      this.detach();
      if (wasReady) this.emit('offline');
    });

    const model = await this.load(connection, bridge);
    if (this.connection !== connection) return;
    this.model = model;
    this.buttons = new Map(
      model.buttonDevices.flatMap((device) =>
        device.buttons.map((button) => [button.id, { device, button }]),
      ),
    );
    for (const type of model.unknownTypes) {
      if (this.loggedTypes.has(type)) continue;
      this.loggedTypes.add(type);
      this.logger?.info(
        `Unknown Lutron device type "${type}": skipped (report it with Diagnostics)`,
      );
    }
    this.batteries = new Map(model.batteries);
    this.smartAway = model.smartAwayEnabled;
    await this.subscribe(connection, model);
    await this.readStates(connection, model);
    if (this.connection !== connection) return;

    this.loading = false;
    this.ready = true;
    this.emit('model', model);
    this.emitAll();
    this.scheduleResync();
  }

  /** @private */
  async subscribe(connection, model) {
    const route = (response) => this.receive(connection, response.body);
    // Refused (an endpoint this bridge does not have): skipped. Anything
    // else (a timeout) fails the load: a subscription lost now would stay
    // lost, and the session retries the whole load.
    const optional = async (url) => {
      try {
        route(await connection.subscribe(url, route));
      } catch (error) {
        if (!(error instanceof LeapStatusError)) throw error;
        this.logger?.debug(`No subscription to ${url}: ${error.message}`);
      }
    };
    if (model.system === 'caseta') {
      if (model.occupancyGroups.length > 0) await optional('/occupancygroup/status');
    } else {
      await optional('/zone/status');
      await optional('/area/status');
    }
    if (model.smartAway) await optional('/system/away/1/status');
    const urls = [
      ...(model.system === 'caseta' ? [] : this.ledIds().map((id) => `/led/${id}/status`)),
      ...[...this.buttons.keys()].map((id) => `/button/${id}/status/event`),
    ];
    await eachLimited(urls, SUBSCRIBE_CONCURRENCY, optional);
  }

  /** @private */
  ledIds() {
    return [...this.buttons.values()].map(({ button }) => button.ledId).filter(Boolean);
  }

  /**
   * @private Read every zone status (Caséta pushes changes, never the
   * initial state); a processor answers them all at once.
   */
  async readStates(connection, model) {
    if (model.system !== 'caseta') {
      const all = await readOptional(connection, '/zone/status');
      if (all) {
        this.receive(connection, all);
        return;
      }
    }
    for (const zone of model.zones) {
      this.receive(connection, await readOptional(connection, `/zone/${zone.id}/status`));
    }
  }

  /** Every state again, against a silent subscription. */
  async resync() {
    const connection = this.connection;
    const model = this.model;
    if (!this.ready || !connection || !model) return;
    try {
      await this.readStates(connection, model);
      if (model.system !== 'caseta') {
        this.receive(connection, await readOptional(connection, '/area/status'));
        for (const ledId of this.ledIds()) {
          this.receive(connection, await readOptional(connection, `/led/${ledId}/status`));
        }
      } else if (model.occupancyGroups.length > 0) {
        this.receive(connection, await readOptional(connection, '/occupancygroup/status'));
      }
      if (model.smartAway) {
        this.receive(connection, await readOptional(connection, '/system/away/1/status'));
      }
      const devices = [
        ...model.zones.filter((zone) => zone.battery).map((zone) => zone.deviceId),
        ...model.occupancyGroups.flatMap((group) => group.sensorDeviceIds),
      ];
      for (const [deviceId, low] of await readBatteries(connection, devices)) {
        if (this.connection !== connection) return;
        this.setBattery(deviceId, low);
      }
    } catch (error) {
      if (!connection.closed) this.logger?.warn(`Lutron resync failed: ${error.message}`);
    }
  }

  /** @private */
  scheduleResync() {
    clearTimeout(this.resyncTimer);
    this.resyncTimer = setTimeout(async () => {
      await this.resync();
      if (this.ready) this.scheduleResync();
    }, this.timings.resyncIntervalMs);
    this.resyncTimer.unref?.();
  }

  /** Forget the connection (closed, or replaced by a new one). */
  detach() {
    clearTimeout(this.resyncTimer);
    this.resyncTimer = null;
    this.connection = null;
    this.loading = false;
    this.ready = false;
  }

  /**
   * Route any LEAP body to the states it carries.
   *
   * @param {import('./connection.js').LeapConnection} connection
   * @param {any} body
   */
  receive(connection, body) {
    if (connection !== this.connection || !body || typeof body !== 'object') return;
    for (const state of zoneStatesOf(body)) this.setZone(state);
    for (const { groupId, occupied } of occupancyStatesOf(body))
      this.setOccupancy(groupId, occupied);
    const away = smartAwayOf(body);
    if (away !== null) this.setSmartAway(away);
    for (const area of areaStatesOf(body)) {
      if (area.occupied !== undefined) this.setOccupancy(area.areaId, area.occupied);
      if (area.sceneId !== undefined) this.setAreaScene(area.areaId, area.sceneId);
    }
    const led = parseLedStatus(body);
    if (led) this.applyLed(led.ledId, led.on);
    const press = parseButtonEvent(body);
    if (press && !this.loading) {
      const entry = this.buttons.get(press.buttonId);
      if (entry) this.emit('button', entry.device, entry.button, press.event);
    }
  }

  /** @private */
  applyLed(ledId, on) {
    this.leds.set(ledId, on);
    if (!this.loading && this.model) this.emit('led', ledId, on);
  }

  /** @private Only a change, after the load, not caused by our own press. */
  setAreaScene(areaId, sceneId) {
    const previous = this.areaScenes.get(areaId);
    this.areaScenes.set(areaId, sceneId);
    if (this.loading || !this.model || previous === undefined || previous === sceneId) return;
    if (!sceneId) return;
    if (Date.now() - this.lastOwnPress < OWN_COMMAND_MS) return;
    const scene = this.model.scenes.find((s) => s.source === 'areascene' && s.id === sceneId);
    this.emit('areaScene', scene ?? { id: sceneId, name: `Scene ${sceneId}`, areaId }, areaId);
  }

  /** @private */
  setZone(state) {
    const zone = this.zone(state.zoneId);
    if (!zone && this.model) return;
    const merged = { ...(this.zones.get(state.zoneId) ?? { zoneId: state.zoneId }) };
    for (const field of ZONE_FIELDS) {
      if (state[field] !== null && state[field] !== undefined) merged[field] = state[field];
      else merged[field] ??= null;
    }
    this.zones.set(state.zoneId, merged);
    if (merged.level > 0) this.lastLevels.set(state.zoneId, merged.level);
    if (!this.loading && zone) this.emit('zone', zone, merged);
  }

  /** @private */
  setOccupancy(groupId, occupied) {
    const group = this.model?.occupancyGroups.find((g) => g.id === groupId);
    if (this.model && !group) return;
    this.occupancy.set(groupId, occupied);
    if (!this.loading && group) this.emit('occupancy', group, occupied);
  }

  /** @private */
  setSmartAway(enabled) {
    this.smartAway = enabled;
    if (!this.loading && this.model) this.emit('smartAway', enabled);
  }

  /** @private */
  setBattery(deviceId, low) {
    this.batteries.set(deviceId, low);
    if (!this.loading && this.model) this.emit('battery', deviceId, low);
  }

  /** @private Every known state, after a (re)load. */
  emitAll() {
    const model = this.model;
    for (const zone of model.zones) {
      const state = this.zones.get(zone.id);
      if (state) this.emit('zone', zone, state);
    }
    for (const group of model.occupancyGroups) {
      if (this.occupancy.has(group.id)) this.emit('occupancy', group, this.occupancy.get(group.id));
    }
    if (model.smartAway && this.smartAway !== null) this.emit('smartAway', this.smartAway);
    for (const [deviceId, low] of this.batteries) this.emit('battery', deviceId, low);
    for (const [ledId, on] of this.leds) this.emit('led', ledId, on);
  }

  // --- commands ---------------------------------------------------------------

  /** @private */
  requireConnection() {
    if (!this.ready || !this.connection) throw new BridgeOfflineError();
    return this.connection;
  }

  /** @private */
  requireZone(zoneId) {
    const zone = this.zone(zoneId);
    if (!zone) throw new Error(`Unknown Lutron zone ${zoneId}: refresh the devices`);
    return zone;
  }

  /** @private The answer carries the new status on most bridges: applied at once. */
  async send(url, command) {
    const connection = this.requireConnection();
    const body = await connection.create(url, { Command: command });
    this.receive(connection, body);
    return body;
  }

  /** @private */
  async zoneCommand(zoneId, command) {
    return this.send(`/zone/${zoneId}/commandprocessor`, command);
  }

  /**
   * @param {string} zoneId
   * @param {number} level 0-100
   * @param {number} [fadeSeconds]
   */
  async setLevel(zoneId, level, fadeSeconds = 0) {
    const zone = this.requireZone(zoneId);
    return this.zoneCommand(zoneId, levelCommand(zone.kind, level, fadeSeconds));
  }

  /** On at the last level used (100 the first time). */
  async turnOn(zoneId, fadeSeconds = 0) {
    return this.setLevel(zoneId, this.lastLevels.get(zoneId) ?? 100, fadeSeconds);
  }

  /** @param {number} percent 0, 25, 50, 75, 100 */
  async setFan(zoneId, percent) {
    this.requireZone(zoneId);
    return this.zoneCommand(zoneId, fanCommand(percent));
  }

  /** @param {'Raise' | 'Lower' | 'Stop'} direction */
  async move(zoneId, direction) {
    this.requireZone(zoneId);
    return this.zoneCommand(zoneId, moveCommand(direction));
  }

  /** @param {number} tilt 0-100 */
  async setTilt(zoneId, tilt) {
    this.requireZone(zoneId);
    return this.zoneCommand(zoneId, tiltCommand(tilt));
  }

  /** @param {string} sceneId */
  async activateScene(sceneId) {
    const scene = this.model?.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error(`Unknown Lutron scene ${sceneId}: refresh the devices`);
    return this.send(`/virtualbutton/${sceneId}/commandprocessor`, pressCommand());
  }

  /** @param {number} kelvin */
  async setKelvin(zoneId, kelvin) {
    const zone = this.requireZone(zoneId);
    if (zone.kind !== KINDS.WHITE_TUNE && zone.kind !== KINDS.SPECTRUM) {
      throw new Error(`${zone.name} has no colour temperature`);
    }
    const range = zone.whiteRange ?? { min: 1400, max: 10000 };
    const value = Math.min(range.max, Math.max(range.min, Number(kelvin)));
    return this.zoneCommand(zoneId, kelvinCommand(zone.kind, value));
  }

  /** @param {number} rgb integer 0xRRGGBB (the level stays) */
  async setColor(zoneId, rgb) {
    const zone = this.requireZone(zoneId);
    if (zone.kind !== KINDS.SPECTRUM) throw new Error(`${zone.name} has no colour`);
    const { hue, saturation } = rgbToHueSaturation(rgb);
    return this.zoneCommand(zoneId, hsvCommand(hue, saturation));
  }

  /** @param {boolean} enabled */
  async setWarmDim(zoneId, enabled) {
    const zone = this.requireZone(zoneId);
    if (zone.kind !== KINDS.WHITE_TUNE && zone.kind !== KINDS.SPECTRUM) {
      throw new Error(`${zone.name} has no warm dimming`);
    }
    return this.zoneCommand(zoneId, warmDimCommand(zone.kind, enabled));
  }

  /**
   * Press a keypad (or RA3 / QSX Pico) button, like a finger would. Caséta
   * bridges cannot: their Picos only talk to the bridge.
   *
   * @param {string} buttonId
   */
  async pressButton(buttonId) {
    const entry = this.buttons.get(buttonId);
    if (!entry) throw new Error(`Unknown Lutron button ${buttonId}: refresh the devices`);
    if (!this.processor) {
      throw new Error(
        'A Caséta bridge cannot press a Pico button: control the light or the scene directly',
      );
    }
    this.lastOwnPress = Date.now();
    return this.send(`/button/${buttonId}/commandprocessor`, pressCommand());
  }

  /**
   * Keypad LED. The keypad programming may switch it back (an LED follows
   * its scene or its zones).
   *
   * @param {string} ledId
   * @param {boolean} on
   */
  async setLed(ledId, on) {
    if (!this.ledIds().includes(ledId)) throw new Error(`Unknown Lutron LED ${ledId}`);
    const connection = this.requireConnection();
    const body = await connection.update(`/led/${ledId}/status`, {
      LEDStatus: { State: on ? 'On' : 'Off' },
    });
    this.receive(connection, body);
  }

  /** @param {boolean} enabled */
  async setSmartAwayEnabled(enabled) {
    const connection = this.requireConnection();
    const body = await connection.update('/system/away/1/status', {
      AwayStatus: { EnabledState: enabled ? 'Enabled' : 'Disabled' },
    });
    this.receive(connection, body);
  }
}

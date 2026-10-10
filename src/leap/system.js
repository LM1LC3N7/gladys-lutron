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
// Events: 'model' (model), 'zone' (zone, state), 'occupancy' (group,
// occupied), 'smartAway' (enabled), 'battery' (deviceId, low), 'offline'.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { fanCommand, levelCommand, moveCommand, tiltCommand, pressCommand } from './commands.js';
import { BridgeOfflineError } from './errors.js';
import { loadModel, readBatteries, readOptional } from './model.js';
import { occupancyStatesOf, smartAwayOf, zoneStatesOf } from './status.js';

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
    const optional = async (url) => {
      try {
        route(await connection.subscribe(url, route));
      } catch (error) {
        if (connection.closed) throw error;
        this.logger?.debug(`No subscription to ${url}: ${error.message}`);
      }
    };
    if (model.occupancyGroups.length > 0) await optional('/occupancygroup/status');
    if (model.smartAway) await optional('/system/away/1/status');
  }

  /** @private Read every zone status (Caséta pushes changes, never the initial state). */
  async readStates(connection, model) {
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
      if (model.occupancyGroups.length > 0) {
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

  /** @param {boolean} enabled */
  async setSmartAwayEnabled(enabled) {
    const connection = this.requireConnection();
    const body = await connection.update('/system/away/1/status', {
      AwayStatus: { EnabledState: enabled ? 'Enabled' : 'Disabled' },
    });
    this.receive(connection, body);
  }
}

// -----------------------------------------------------------------------------
// Gladys commands (onSetValue) -> LEAP commands. Each command is answered
// within the 5 s acknowledgement of Gladys: the LEAP request times out at 4 s.
// A refused command throws a message the user can act on.
// -----------------------------------------------------------------------------

import { KINDS } from '../leap/deviceTypes.js';
import { BridgeOfflineError } from '../leap/errors.js';

const COVER_STATE = Object.freeze({ OPEN: 1, STOP: 0, CLOSE: -1 });
// Tilt-only blinds: 50 = slats open, 0 = closed.
const TILT_OPEN = 50;

/**
 * @param {object} options
 * @param {import('../leap/system.js').LutronSystem} options.system
 * @param {() => import('./devices.js').Catalog | null} options.catalog
 * @param {() => number} options.fadeSeconds the configured default fade
 * @param {{ set(externalId: string, value: number): void }} options.publisher
 */
export function createCommandHandler({ system, catalog, fadeSeconds, publisher }) {
  /**
   * @param {any} _device
   * @param {{ external_id: string }} feature
   * @param {number | string} raw
   */
  return async function setValue(_device, feature, raw) {
    const target = catalog()?.targets.get(feature.external_id);
    if (!target) {
      throw new Error(
        'Unknown Lutron device: press "Refresh the devices" in the integration configuration.',
      );
    }
    if (!system.ready) throw new Error(new BridgeOfflineError().message);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Invalid value "${raw}"`);
    const { zoneId, kind } = target;

    switch (target.action) {
      case 'on':
        return value > 0
          ? system.turnOn(zoneId, fadeSeconds())
          : system.setLevel(zoneId, 0, fadeSeconds());
      case 'brightness':
        return system.setLevel(zoneId, value, fadeSeconds());
      case 'switch':
        return system.setLevel(zoneId, value > 0 ? 100 : 0);
      case 'speed':
        return system.setFan(zoneId, value);
      case 'position':
        return kind === KINDS.TILT_BLIND
          ? system.setTilt(zoneId, value)
          : system.setLevel(zoneId, value);
      case 'state':
        await moveCover(zoneId, kind, value);
        publisher.set(feature.external_id, value);
        return undefined;
      case 'temperature':
        return system.setKelvin(zoneId, value);
      case 'color':
        return system.setColor(zoneId, value);
      case 'warm-dim':
        return system.setWarmDim(zoneId, value > 0);
      case 'led':
        return system.setLed(target.ledId, value > 0);
      case 'smart-away':
        return system.setSmartAwayEnabled(value > 0);
      case 'scene':
        return system.activateScene(target.sceneId);
      default:
        throw new Error(`This Lutron feature cannot be controlled (${target.action})`);
    }
  };

  async function moveCover(zoneId, kind, value) {
    const position = catalog()?.zoneFeatures.get(zoneId)?.position;
    if (kind === KINDS.TILT_BLIND) {
      if (value === COVER_STATE.STOP) return system.move(zoneId, 'Stop');
      return system.setTilt(zoneId, value === COVER_STATE.OPEN ? TILT_OPEN : 0);
    }
    if (value === COVER_STATE.STOP) return system.move(zoneId, 'Stop');
    await system.move(zoneId, value === COVER_STATE.OPEN ? 'Raise' : 'Lower');
    // Raise / Lower send no status until the shade stops: show where it goes.
    if (position) publisher.set(position, value === COVER_STATE.OPEN ? 100 : 0);
    return undefined;
  }
}

// -----------------------------------------------------------------------------
// Scene actions: only what the core "control a device" action cannot say.
//   - set_level_with_fade: a level reached over a chosen time (up to 4 h);
//   - set_tilt: the slats of a blind with lift and tilt (Gladys has no tilt
//     feature type).
// A device that cannot do it is refused with a message saying why.
// -----------------------------------------------------------------------------

import { KINDS, LIGHT_KINDS } from '../leap/deviceTypes.js';
import { MAX_FADE_SECONDS } from '../leap/commands.js';
import { BridgeOfflineError } from '../leap/errors.js';

const TILT_KINDS = [KINDS.LIFT_TILT, KINDS.TILT_BLIND];

const number = (value, name, min, max) => {
  const parsed = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(parsed)) {
    throw new Error(`"${name}" must be a number between ${min} and ${max}`);
  }
  return Math.min(max, Math.max(min, parsed));
};

/**
 * @param {object} options
 * @param {import('../leap/system.js').LutronSystem} options.system
 * @param {() => import('./devices.js').Catalog | null} options.catalog
 */
export function createSceneActions({ system, catalog }) {
  const zoneOf = (deviceExternalId, allowed, what) => {
    if (!system.ready) throw new Error(new BridgeOfflineError().message);
    const zoneId = catalog()?.zoneOfDevice.get(String(deviceExternalId ?? ''));
    const zone = zoneId ? system.zone(zoneId) : null;
    if (!zone) {
      throw new Error(
        'Unknown Lutron device: choose a Lutron device, or press "Refresh the devices" in the integration configuration.',
      );
    }
    if (!allowed.includes(zone.kind)) {
      throw new Error(`"${zone.name}" is not ${what}`);
    }
    return zone;
  };

  return {
    /** @param {{ device?: string, level?: unknown, fade_seconds?: unknown }} fields */
    async setLevelWithFade(fields) {
      const zone = zoneOf(fields.device, LIGHT_KINDS, 'a dimmer');
      const level = number(fields.level, 'level', 0, 100);
      const fade = number(fields.fade_seconds ?? 2, 'fade_seconds', 0, MAX_FADE_SECONDS);
      await system.setLevel(zone.id, level, fade);
    },

    /** @param {{ device?: string, tilt?: unknown }} fields */
    async setTilt(fields) {
      const zone = zoneOf(fields.device, TILT_KINDS, 'a blind with tilting slats');
      await system.setTilt(zone.id, number(fields.tilt, 'tilt', 0, 100));
    },
  };
}

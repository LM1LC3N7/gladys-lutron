// -----------------------------------------------------------------------------
// The "Lutron overview" dashboard widget: what no core device box shows.
//   - the bridge: model, connection, LEAP version;
//   - Smart Away, the number of devices, the occupied rooms, low batteries;
//   - the last remote presses (remote, button, press type, time);
//   - buttons: Smart Away on / off, "Reconnect" while offline.
// No per-room light or shade controls: the core room box already does it.
// Built from memory only, so it answers at once even when the bridge is down.
// -----------------------------------------------------------------------------

import { PRESSES } from '../leap/buttonTracker.js';
import { MESSAGES } from './messages.js';

export const WIDGET_ACTIONS = Object.freeze({
  SMART_AWAY_ON: 'smart_away_on',
  SMART_AWAY_OFF: 'smart_away_off',
  RECONNECT: 'reconnect',
});

const PRESS_LABELS = {
  [PRESSES.CLICK]: { en: 'Click', fr: 'Clic' },
  [PRESSES.DOUBLE]: { en: 'Double click', fr: 'Double clic' },
  [PRESSES.LONG_PRESS]: { en: 'Long press', fr: 'Appui long' },
  [PRESSES.LONG_RELEASE]: { en: 'Long press released', fr: 'Appui long relâché' },
};

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * @typedef {object} OverviewInput
 * @property {boolean} paired
 * @property {boolean} connected
 * @property {string} label           bridge label ("Smart Bridge (L-BDG2-WH)")
 * @property {string | null} leapVersion
 * @property {{ en: string, fr: string }} statusMessage connection status for the user
 * @property {boolean} smartAwaySupported
 * @property {boolean | null} smartAway
 * @property {number} devices
 * @property {string[]} occupiedAreas
 * @property {number | null} lowBatteries null when nothing reports a battery
 * @property {{ device: string, button: string, press: string, at: string }[]} recentPresses
 */

/**
 * @param {OverviewInput} input
 * @returns {import('@gladysassistant/integration-sdk').WidgetContent}
 */
export function buildOverview(input) {
  if (!input.paired) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: MESSAGES.notPaired }],
    };
  }
  const version = input.leapVersion ? ` · LEAP ${input.leapVersion}` : '';
  const components = [
    { type: 'text', variant: 'caption', text: cut(`${input.label}${version}`, 80) },
  ];

  const items = [
    {
      label: { en: 'Bridge', fr: 'Bridge' },
      value: input.connected
        ? { en: 'Connected', fr: 'Connecté' }
        : { en: 'Offline', fr: 'Hors ligne' },
      color: input.connected ? 'success' : 'danger',
      icon: input.connected ? 'wifi' : 'wifi-off',
    },
  ];
  if (input.smartAwaySupported && input.smartAway !== null) {
    items.push({
      label: 'Smart Away',
      value: input.smartAway ? { en: 'On', fr: 'Activé' } : { en: 'Off', fr: 'Désactivé' },
      color: input.smartAway ? 'info' : 'neutral',
      icon: 'home',
    });
  }
  items.push({
    label: { en: 'Devices', fr: 'Appareils' },
    value: input.devices,
    color: 'neutral',
    icon: 'sun',
  });
  if (input.occupiedAreas.length > 0 || input.connected) {
    items.push({
      label: { en: 'Occupied rooms', fr: 'Pièces occupées' },
      value:
        input.occupiedAreas.length > 0
          ? cut(input.occupiedAreas.join(', '), 40)
          : { en: 'None', fr: 'Aucune' },
      color: input.occupiedAreas.length > 0 ? 'primary' : 'neutral',
      icon: 'user',
    });
  }
  if (input.lowBatteries !== null) {
    items.push({
      label: { en: 'Low batteries', fr: 'Piles faibles' },
      value: input.lowBatteries,
      color: input.lowBatteries > 0 ? 'warning' : 'success',
      icon: 'battery',
    });
  }
  components.push({ type: 'status', items });

  if (input.recentPresses.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: input.recentPresses.slice(0, 8).map((press) => ({
        title: cut(`${press.device} · ${press.button}`, 60),
        subtitle: PRESS_LABELS[press.press] ?? press.press,
        date: press.at,
      })),
    });
  } else {
    components.push({
      type: 'text',
      variant: 'body',
      text: input.connected
        ? { en: 'No remote press yet.', fr: "Aucun appui sur une télécommande pour l'instant." }
        : input.statusMessage,
    });
  }

  if (input.connected && input.smartAwaySupported && input.smartAway !== null) {
    components.push(
      input.smartAway
        ? {
            type: 'button',
            label: { en: 'Smart Away off', fr: 'Arrêter Smart Away' },
            icon: 'home',
            style: 'secondary',
            action: { key: WIDGET_ACTIONS.SMART_AWAY_OFF },
          }
        : {
            type: 'button',
            label: { en: 'Smart Away on', fr: 'Activer Smart Away' },
            icon: 'home',
            style: 'secondary',
            action: { key: WIDGET_ACTIONS.SMART_AWAY_ON, confirm: true },
          },
    );
  }
  if (!input.connected) {
    components.push({
      type: 'button',
      label: { en: 'Reconnect', fr: 'Reconnecter' },
      icon: 'refresh-cw',
      style: 'primary',
      action: { key: WIDGET_ACTIONS.RECONNECT },
    });
  }

  return { ttl_seconds: 60, components };
}

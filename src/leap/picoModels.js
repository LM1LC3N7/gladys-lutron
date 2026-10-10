// -----------------------------------------------------------------------------
// Pico and shade remote buttons: LEAP ButtonNumber -> a readable name, per
// model. Numbers from the tables of the Home Assistant lutron_caseta
// integration (Apache-2.0, see NOTICE). An unknown model or number gets the
// LEAP name or "Button <n>": never fatal (Home Assistant #184579).
// -----------------------------------------------------------------------------

const PICO_ON_OFF = { 0: 'On', 2: 'Off' };
const PICO_RAISE_LOWER = { 3: 'Raise', 4: 'Lower' };

/** FourGroupRemote (shade remote): 5 buttons for all shades, then 4 groups. */
function fourGroupRemote() {
  const names = {};
  const actions = ['Open', 'Stop', 'Close', 'Raise', 'Lower'];
  ['All', 'Group 1', 'Group 2', 'Group 3', 'Group 4'].forEach((group, g) => {
    actions.forEach((action, a) => {
      names[g * 5 + a] = `${group} ${action.toLowerCase()}`;
    });
  });
  return names;
}

export const BUTTON_NAMES = Object.freeze({
  Pico2Button: PICO_ON_OFF,
  PaddleSwitchPico: PICO_ON_OFF,
  Pico2ButtonRaiseLower: { ...PICO_ON_OFF, ...PICO_RAISE_LOWER },
  Pico3Button: { ...PICO_ON_OFF, 1: 'Favorite' },
  Pico3ButtonRaiseLower: { ...PICO_ON_OFF, 1: 'Favorite', ...PICO_RAISE_LOWER },
  Pico4Button: { 1: 'Button 1', 2: 'Button 2', 3: 'Button 3', 4: 'Button 4' },
  Pico4ButtonScene: { 1: 'Button 1', 2: 'Button 2', 3: 'Button 3', 4: 'Off' },
  Pico4ButtonZone: { 1: 'On', 2: 'Raise', 3: 'Lower', 4: 'Off' },
  Pico4Button2Group: {
    1: 'Group 1 button 1',
    2: 'Group 1 button 2',
    3: 'Group 2 button 1',
    4: 'Group 2 button 2',
  },
  FourGroupRemote: fourGroupRemote(),
});

/**
 * @param {string} type DeviceType of the remote
 * @param {number} number ButtonNumber
 * @param {unknown} [leapName] the button Name or engraving from the bridge
 * @returns {string}
 */
export function buttonName(type, number, leapName) {
  const known = BUTTON_NAMES[type]?.[number];
  if (known) return known;
  if (typeof leapName === 'string' && leapName.trim()) return leapName.replace(/\s+/g, ' ').trim();
  return `Button ${number}`;
}

/**
 * Raise / lower buttons repeat while held: their long press is detected a
 * little later, so a short press stays a click.
 *
 * @param {string} name
 */
export function isRaiseLower(name) {
  return /\b(raise|lower)\b/i.test(name);
}

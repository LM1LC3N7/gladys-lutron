// -----------------------------------------------------------------------------
// Lutron device and zone types -> what they are (kind).
//
// Caséta and RA2 Select name a device by its DeviceType; RadioRA 3 and
// HomeWorks QSX describe zones by their ControlType: both land in the same
// kinds. Lists from pylutron-caseta (Apache-2.0, see NOTICE). An unknown type
// gives null: logged once by the caller and skipped, never fatal.
// -----------------------------------------------------------------------------

export const KINDS = Object.freeze({
  DIMMER: 'dimmer',
  WHITE_TUNE: 'white-tune', // Lumaris tunable white tape light
  SPECTRUM: 'spectrum', // Ketra, Lumaris RGB + tunable white
  SWITCH: 'switch',
  CCO: 'cco', // contact closure output (relay)
  FAN: 'fan',
  SHADE: 'shade', // lift only
  DRAPE: 'drape',
  LIFT_TILT: 'lift-tilt', // lift and tilt (wood blinds)
  TILT_BLIND: 'tilt-blind', // tilt only
  OPEN_CLOSE: 'open-close', // open / close / stop, no position
  REMOTE: 'remote', // Pico and shade remotes
  KEYPAD: 'keypad', // RA3 / QSX keypads (buttons + LEDs)
  OCCUPANCY_SENSOR: 'occupancy-sensor',
});

const TYPES = {
  [KINDS.DIMMER]: [
    'WallDimmer',
    'PlugInDimmer',
    'InLineDimmer',
    'SunnataDimmer',
    'TempInWallPaddleDimmer',
    'WallDimmerWithPreset',
    'Dimmed',
    'DivaSmartDimmer',
    'PowPak0-10V',
  ],
  [KINDS.WHITE_TUNE]: ['WhiteTune'],
  [KINDS.SPECTRUM]: ['SpectrumTune', 'ColorTune'],
  [KINDS.SWITCH]: [
    'WallSwitch',
    'OutdoorPlugInSwitch',
    'PlugInSwitch',
    'InLineSwitch',
    'PowPakSwitch',
    'SunnataSwitch',
    'TempInWallPaddleSwitch',
    'Switched',
    'DivaSmartSwitch',
  ],
  [KINDS.CCO]: ['CCO'],
  [KINDS.FAN]: ['CasetaFanSpeedController', 'MaestroFanSpeedController', 'FanSpeed'],
  [KINDS.SHADE]: [
    'SerenaHoneycombShade',
    'SerenaRollerShade',
    'TriathlonHoneycombShade',
    'TriathlonEssentialsRollerShade',
    'TriathlonRollerShade',
    'QsWirelessShade',
    'QsWirelessHorizontalSheerBlind',
    'Shade',
    'PalladiomWireFreeShade',
    'SerenaEssentialsRollerShade',
  ],
  [KINDS.DRAPE]: ['RightDrawDrape', 'LeftDrawDrape', 'CenterDrawDrape', 'Drape'],
  [KINDS.LIFT_TILT]: ['QsWirelessWoodBlind'],
  [KINDS.TILT_BLIND]: ['SerenaTiltOnlyWoodBlind', 'TriathlonTiltOnlyWoodBlind', 'Tilt'],
  [KINDS.OPEN_CLOSE]: ['OpenCloseStop'],
  [KINDS.REMOTE]: [
    'Pico1Button',
    'Pico2Button',
    'Pico2ButtonRaiseLower',
    'Pico3Button',
    'Pico3ButtonRaiseLower',
    'Pico4Button',
    'Pico4ButtonScene',
    'Pico4ButtonZone',
    'Pico4Button2Group',
    'PaddleSwitchPico',
    'FourGroupRemote',
  ],
  [KINDS.KEYPAD]: [
    'SeeTouchTabletopKeypad',
    'SunnataKeypad',
    'SunnataHybridKeypad',
    'SeeTouchHybridKeypad',
    'SeeTouchKeypad',
    'SeeTouchInternational',
    'HomeownerKeypad',
    'GrafikTHybridKeypad',
    'AlisseKeypad',
    'PalladiomKeypad',
    'PhantomKeypad',
    'N-CVLpqtTTOIeG-4hcjKgw', // Vierti hybrid keypad (no readable type name)
  ],
  [KINDS.OCCUPANCY_SENSOR]: [
    'RPSOccupancySensor',
    'RPSCeilingMountedOccupancySensor',
    'RPSWallMountedOccupancySensor',
  ],
};

const BY_TYPE = new Map(
  Object.entries(TYPES).flatMap(([kind, types]) => types.map((type) => [type, kind])),
);

/**
 * @param {unknown} type DeviceType (Caséta) or zone ControlType (RA3/QSX)
 * @returns {string | null} one of KINDS, null when unknown
 */
export function kindOf(type) {
  if (typeof type !== 'string') return null;
  const kind = BY_TYPE.get(type);
  if (kind) return kind;
  // New models of a known family keep its suffix.
  if (/Drape$/.test(type)) return KINDS.DRAPE;
  if (/Shade$/.test(type)) return KINDS.SHADE;
  if (/^Pico/.test(type)) return KINDS.REMOTE;
  if (/Keypad$/.test(type)) return KINDS.KEYPAD;
  return null;
}

/** Kinds controlled through a zone (`/zone/{id}/commandprocessor`). */
export const ZONE_KINDS = Object.freeze([
  KINDS.DIMMER,
  KINDS.WHITE_TUNE,
  KINDS.SPECTRUM,
  KINDS.SWITCH,
  KINDS.CCO,
  KINDS.FAN,
  KINDS.SHADE,
  KINDS.DRAPE,
  KINDS.LIFT_TILT,
  KINDS.TILT_BLIND,
  KINDS.OPEN_CLOSE,
]);

export const LIGHT_KINDS = Object.freeze([KINDS.DIMMER, KINDS.WHITE_TUNE, KINDS.SPECTRUM]);
export const COVER_KINDS = Object.freeze([
  KINDS.SHADE,
  KINDS.DRAPE,
  KINDS.LIFT_TILT,
  KINDS.TILT_BLIND,
  KINDS.OPEN_CLOSE,
]);
export const BUTTON_KINDS = Object.freeze([KINDS.REMOTE, KINDS.KEYPAD]);

/** Battery powered devices whose `/device/{id}/status` reports a battery. */
export const MAY_HAVE_BATTERY = /serena|triathlon|qswireless|wirefree|palladiom|occupancy/i;

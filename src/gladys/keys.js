// -----------------------------------------------------------------------------
// Keys published in the manifest and stored by Gladys.
//
// Scene trigger and scene action keys are saved inside the users' scenes, and
// widget keys inside their dashboards: renaming or removing one breaks every
// scene or dashboard using it. They are frozen here and pinned by
// test/manifest.test.js — add new keys, never rename these.
// -----------------------------------------------------------------------------

export const CONFIG_KEYS = Object.freeze({
  BRIDGE_HOST: 'bridge_host',
  BUTTON_DETECTION: 'button_detection',
  DEFAULT_FADE_SECONDS: 'default_fade_seconds',
});

// Written by the integration outside the config_schema: the core stores them
// with the configuration (so in the Gladys backups) and never shows them in
// the UI. The pairing credentials of the bridge.
export const STORAGE_KEYS = Object.freeze({
  LEAP_KEY: 'leap_key',
  LEAP_CERT: 'leap_cert',
  LEAP_CA: 'leap_ca',
  BRIDGE_SERIAL: 'bridge_serial',
  BRIDGE_TYPE: 'bridge_type',
});

export const MANIFEST_ACTIONS = Object.freeze({
  PAIR_BRIDGE: 'pair_bridge',
  TEST_CONNECTION: 'test_connection',
  REFRESH_DEVICES: 'refresh_devices',
  FORGET_BRIDGE: 'forget_bridge',
  DIAGNOSTICS: 'diagnostics',
});

export const SCENE_TRIGGERS = Object.freeze({
  BRIDGE_OFFLINE: 'bridge_offline',
  BRIDGE_ONLINE: 'bridge_online',
  AREA_SCENE_ACTIVATED: 'area_scene_activated',
});

export const SCENE_ACTIONS = Object.freeze({
  SET_LEVEL_WITH_FADE: 'set_level_with_fade',
  SET_TILT: 'set_tilt',
  PRESS_KEYPAD_BUTTON: 'press_keypad_button',
});

export const WIDGETS = Object.freeze({
  OVERVIEW: 'lutron_overview',
});

export const BUTTON_DETECTION = Object.freeze({
  INSTANT: 'instant',
  NORMAL: 'normal',
  RELAXED: 'relaxed',
});

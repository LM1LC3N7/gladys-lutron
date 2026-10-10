// -----------------------------------------------------------------------------
// Entry point of the Lutron external integration for Gladys Assistant.
//
// Wiring only: the LEAP client lives in src/leap/ (no Gladys dependency), the
// Gladys adapter in src/gladys/. The SDK reads GLADYS_HOST_API_URL,
// GLADYS_INTEGRATION_TOKEN and GLADYS_INTEGRATION_SELECTOR from the
// environment injected by the Gladys supervisor.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createLutronIntegration } from './src/gladys/integration.js';
import { MANIFEST_ACTIONS, SCENE_ACTIONS, WIDGETS } from './src/gladys/keys.js';

// Development only: a fake bridge on other ports (the TLS checks stay on).
const port = (name) => Number.parseInt(process.env[name] ?? '', 10) || undefined;

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
const lutron = createLutronIntegration({
  gladys,
  logger,
  version,
  ports: { leap: port('LUTRON_LEAP_PORT'), pairing: port('LUTRON_PAIRING_PORT') },
});
const { bridge } = lutron;

gladys.onConfigUpdated((raw) => lutron.applyConfig(raw));
gladys.on('connected', () => lutron.applyConfig(gladys.config));

gladys.onScanRequest(() => lutron.onScanRequest());
gladys.onSetValue((device, feature, value) => lutron.onSetValue(device, feature, value));
gladys.onDeviceCreated((device) => lutron.onDeviceCreated(device));

gladys.onAction(MANIFEST_ACTIONS.PAIR_BRIDGE, () => bridge.pairAction());
gladys.onAction(MANIFEST_ACTIONS.TEST_CONNECTION, () => bridge.testConnection());
gladys.onAction(MANIFEST_ACTIONS.REFRESH_DEVICES, () => bridge.refresh());
gladys.onAction(MANIFEST_ACTIONS.FORGET_BRIDGE, () => bridge.forget());
gladys.onAction(MANIFEST_ACTIONS.DIAGNOSTICS, () => bridge.diagnostics());
gladys.onSceneAction(SCENE_ACTIONS.SET_LEVEL_WITH_FADE, (fields) =>
  lutron.setLevelWithFade(fields),
);
gladys.onSceneAction(SCENE_ACTIONS.SET_TILT, (fields) => lutron.setTilt(fields));
gladys.onSceneAction(SCENE_ACTIONS.PRESS_KEYPAD_BUTTON, (fields) =>
  lutron.pressKeypadButton(fields),
);
gladys.onWidgetGet(WIDGETS.OVERVIEW, () => lutron.getOverview());
gladys.onWidgetAction(WIDGETS.OVERVIEW, (actionKey) => lutron.onWidgetAction(actionKey));

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await lutron.close();
});

logger.info('Starting the Lutron integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection to Gladys failed', err);
  process.exit(1);
});

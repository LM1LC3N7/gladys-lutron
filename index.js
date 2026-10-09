// -----------------------------------------------------------------------------
// Entry point of the Lutron external integration for Gladys Assistant.
//
// Wiring only: the LEAP client lives in src/leap/ (no Gladys dependency), the
// Gladys adapter in src/gladys/. The SDK reads GLADYS_HOST_API_URL,
// GLADYS_INTEGRATION_TOKEN and GLADYS_INTEGRATION_SELECTOR from the
// environment injected by the Gladys supervisor.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { createBridgeController } from './src/gladys/bridgeController.js';
import { MANIFEST_ACTIONS, SCENE_ACTIONS, WIDGETS } from './src/gladys/keys.js';
import { MESSAGES } from './src/gladys/messages.js';

// Development only: a fake bridge on other ports (the TLS checks stay on).
const port = (name) => Number.parseInt(process.env[name] ?? '', 10) || undefined;

const gladys = new GladysIntegration();
const bridge = createBridgeController({
  gladys,
  logger,
  ports: { leap: port('LUTRON_LEAP_PORT'), pairing: port('LUTRON_PAIRING_PORT') },
});

// Surfaces of later milestones (TODO.md) answer explicitly meanwhile.
const notYet = MESSAGES.notAvailableYet;

const applyConfig = (raw = {}) => bridge.apply(normalizeConfig(raw));

gladys.onConfigUpdated((raw) => applyConfig(raw));
gladys.on('connected', () => applyConfig(gladys.config));

// Always answer a scan: an empty list ends it at once (devices: milestone 4).
gladys.onScanRequest(() => gladys.publishDiscoveredDevices([]));

gladys.onAction(MANIFEST_ACTIONS.PAIR_BRIDGE, () => bridge.pairAction());
gladys.onAction(MANIFEST_ACTIONS.TEST_CONNECTION, () => bridge.testConnection());
gladys.onAction(MANIFEST_ACTIONS.REFRESH_DEVICES, () => bridge.refresh());
gladys.onAction(MANIFEST_ACTIONS.FORGET_BRIDGE, () => bridge.forget());
gladys.onAction(MANIFEST_ACTIONS.DIAGNOSTICS, () => notYet);
gladys.onSceneAction(SCENE_ACTIONS.SET_LEVEL_WITH_FADE, () => {
  throw new Error(notYet.en);
});
gladys.onSceneAction(SCENE_ACTIONS.SET_TILT, () => {
  throw new Error(notYet.en);
});
gladys.onWidgetGet(WIDGETS.OVERVIEW, () => ({
  ttl_seconds: 300,
  components: [{ type: 'text', variant: 'caption', text: notYet.en }],
}));

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  await bridge.close();
});

logger.info('Starting the Lutron integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection to Gladys failed', err);
  process.exit(1);
});

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
import { MANIFEST_ACTIONS, SCENE_ACTIONS, WIDGETS } from './src/gladys/keys.js';

const gladys = new GladysIntegration();

// Milestone 1: the manifest is complete, the features land milestone by
// milestone (TODO.md). Every declared surface answers explicitly meanwhile.
const notYet = {
  en: 'Not available yet in this development version.',
  fr: 'Pas encore disponible dans cette version de développement.',
};

const applyConfig = async (raw = {}) => {
  const config = normalizeConfig(raw);
  await gladys.setConnectionStatus(false, {
    en: config.credentials ? 'Paired, not connected yet.' : 'Not paired with a Lutron bridge yet.',
    fr: config.credentials
      ? 'Associé, pas encore connecté.'
      : 'Pas encore associé à un bridge Lutron.',
  });
};

gladys.onConfigUpdated((raw) => applyConfig(raw));
gladys.on('connected', () => applyConfig(gladys.config));

// Always answer a scan: an empty list ends it at once.
gladys.onScanRequest(() => gladys.publishDiscoveredDevices([]));

gladys.onAction(MANIFEST_ACTIONS.PAIR_BRIDGE, () => notYet);
gladys.onAction(MANIFEST_ACTIONS.TEST_CONNECTION, () => notYet);
gladys.onAction(MANIFEST_ACTIONS.REFRESH_DEVICES, () => notYet);
gladys.onAction(MANIFEST_ACTIONS.FORGET_BRIDGE, () => notYet);
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
});

logger.info('Starting the Lutron integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection to Gladys failed', err);
  process.exit(1);
});

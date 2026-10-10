// Start the whole adapter in-process against the fake bridge (pylutron
// responses by default), already connected and loaded.

import { LeapSession } from '../../src/leap/session.js';
import { createLutronIntegration } from '../../src/gladys/integration.js';
import { ok, startFakeBridge } from './fakeBridge.js';
import { createMemoryGladys, silentLogger } from './memoryGladys.js';
import { casetaRoutes } from './pylutronBridge.js';
import { CREDENTIALS } from './tls.js';
import { waitFor } from './waitFor.js';

const PAIRED = {
  bridge_host: '127.0.0.1',
  leap_key: CREDENTIALS.key,
  leap_cert: CREDENTIALS.cert,
  leap_ca: CREDENTIALS.ca,
};

export async function startIntegration(t, { routes = casetaRoutes(), devices, options = {} } = {}) {
  const bridge = await startFakeBridge({
    routes: {
      ...routes,
      '/device?where=IsThisDevice:true': () =>
        ok({ Devices: [{ Name: 'Smart Bridge', ModelNumber: 'L-BDG2-WH', SerialNumber: 1234 }] }),
    },
  });
  t.after(() => bridge.close());
  const gladys = createMemoryGladys({ config: { ...PAIRED }, devices });
  const lutron = createLutronIntegration({
    gladys,
    logger: silentLogger,
    version: 'test',
    ports: { leap: bridge.port },
    controllerOptions: {
      createSession: (o) =>
        new LeapSession({
          ...o,
          connectionOptions: { ...o.connectionOptions, requestTimeoutMs: 150 },
          timings: { reconnectMinMs: 20, reconnectMaxMs: 40 },
        }),
    },
    publisherLimits: { flushDelayMs: 1 },
    offlineAfterMs: 60,
    ...options,
  });
  t.after(() => lutron.close());
  await lutron.applyConfig(gladys.config);
  await waitFor(() => lutron.system.ready, { what: 'the model' });
  return { bridge, gladys, lutron };
}

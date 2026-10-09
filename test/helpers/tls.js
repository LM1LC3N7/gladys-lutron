// Test TLS material (see test/fixtures/tls/README.md).
import { readFileSync } from 'node:fs';

const file = (name) => readFileSync(new URL(`../fixtures/tls/${name}`, import.meta.url), 'utf8');

export const TLS = Object.freeze({
  bridgeCa: file('bridge-ca.pem'),
  bridgeCert: file('bridge.pem'),
  bridgeKey: file('bridge.key'),
  clientCert: file('client.pem'),
  clientKey: file('client.key'),
  otherCa: file('other-ca.pem'),
  strangerCert: file('stranger.pem'),
  strangerKey: file('stranger.key'),
});

/** Credentials of a paired integration, as stored in the Gladys config. */
export const CREDENTIALS = Object.freeze({
  key: TLS.clientKey,
  cert: TLS.clientCert,
  ca: TLS.bridgeCa,
});

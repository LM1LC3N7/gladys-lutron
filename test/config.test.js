import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  normalizeButtonDetection,
  normalizeConfig,
  normalizeFadeSeconds,
  normalizeHost,
} from '../src/config.js';

test('an empty configuration gives the defaults and no pairing', () => {
  assert.deepEqual(normalizeConfig(), {
    bridgeHost: null,
    bridgeHostInvalid: false,
    buttonDetection: DEFAULTS.buttonDetection,
    defaultFadeSeconds: DEFAULTS.defaultFadeSeconds,
    credentials: null,
    bridgeSerial: null,
    bridgeType: null,
  });
});

test('the bridge address must be an IPv4 (no mDNS name resolution in the container)', () => {
  assert.equal(normalizeHost(' 192.168.1.20 '), '192.168.1.20');
  assert.equal(normalizeHost('lutron-0123abcd.local'), null);
  assert.equal(normalizeHost('fe80::1'), null);
  assert.equal(normalizeHost(''), null);
  assert.equal(normalizeHost(42), null);
  assert.equal(normalizeConfig({ bridge_host: 'bridge.local' }).bridgeHostInvalid, true);
  assert.equal(normalizeConfig({ bridge_host: '  ' }).bridgeHostInvalid, false);
});

test('unknown button modes fall back to normal', () => {
  assert.equal(normalizeButtonDetection('instant'), 'instant');
  assert.equal(normalizeButtonDetection('relaxed'), 'relaxed');
  assert.equal(normalizeButtonDetection('fast'), 'normal');
  assert.equal(normalizeButtonDetection(undefined), 'normal');
});

test('the fade time is clamped and rounded, strings accepted', () => {
  assert.equal(normalizeFadeSeconds(2.4), 2);
  assert.equal(normalizeFadeSeconds('5'), 5);
  assert.equal(normalizeFadeSeconds(-3), 0);
  assert.equal(normalizeFadeSeconds(600), 60);
  assert.equal(normalizeFadeSeconds('abc'), 0);
  assert.equal(normalizeFadeSeconds(null), 0);
});

test('credentials are only usable when the three PEM values are present', () => {
  const full = { leap_key: 'K', leap_cert: 'C', leap_ca: 'A', bridge_serial: '0123ABCD' };
  assert.deepEqual(normalizeConfig(full).credentials, { key: 'K', cert: 'C', ca: 'A' });
  assert.equal(normalizeConfig(full).bridgeSerial, '0123ABCD');
  assert.equal(normalizeConfig({ ...full, leap_ca: '' }).credentials, null);
});

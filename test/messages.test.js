import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeLabel, describeError, describeSession, MESSAGES } from '../src/gladys/messages.js';
import {
  BridgeClosedEarlyError,
  BridgeUnreachableError,
  CertificateRefusedError,
  InvalidCredentialsError,
  LeapTimeoutError,
} from '../src/leap/errors.js';
import { PairingRefusedError, PairingTimeoutError } from '../src/leap/pairing.js';
import { SESSION_STATES } from '../src/leap/session.js';

const HOST = '192.168.1.20';

test('every error says what to do, in English and French', () => {
  const cases = [
    [new PairingTimeoutError(60_000), /not pressed in time/, /pas été pressé à temps/],
    [
      new PairingRefusedError('401 Unauthorized'),
      /refused the pairing \(401/,
      /refusé l'association/,
    ],
    [new CertificateRefusedError('bridge'), /Forget the bridge/, /Oublier le bridge/],
    [new CertificateRefusedError('integration'), /not the paired bridge/, /pas le bridge associé/],
    [new InvalidCredentialsError(), /damaged/, /endommagée/],
    [new BridgeClosedEarlyError(), /right after accepting/, /juste après/],
    [
      new BridgeUnreachableError(HOST, { code: 'EHOSTUNREACH' }),
      /does not answer at 192\.168\.1\.20 \(EHOSTUNREACH\)/,
      /ne répond pas/,
    ],
    [new LeapTimeoutError('/device', 4000), /slow to answer \(\/device\)/, /tarde à répondre/],
    [new Error('odd'), /odd/, /odd/],
  ];
  for (const [error, en, fr] of cases) {
    const message = describeError(error, HOST);
    assert.match(message.en, en, error.name);
    assert.match(message.fr, fr, error.name);
  }
});

test('the session status names the bridge once known', () => {
  const info = { system: 'caseta', name: 'Smart Bridge', model: 'L-BDG2-WH' };
  const connected = describeSession(
    { state: SESSION_STATES.CONNECTED, host: HOST, leapVersion: '1.123', error: null },
    info,
  );
  assert.equal(connected.connected, true);
  assert.equal(
    connected.message.en,
    'Connected to Smart Bridge (L-BDG2-WH) at 192.168.1.20, LEAP 1.123.',
  );
  const connecting = describeSession(
    { state: SESSION_STATES.CONNECTING, host: HOST, error: null },
    null,
  );
  assert.match(connecting.message.fr, /Connexion au bridge/);
  const stopped = describeSession({ state: SESSION_STATES.STOPPED, host: HOST, error: null }, null);
  assert.equal(stopped.message, MESSAGES.notPaired);
  const waiting = describeSession(
    { state: SESSION_STATES.WAITING, host: HOST, error: new BridgeUnreachableError(HOST) },
    null,
  );
  assert.equal(waiting.connected, false);
  assert.match(waiting.message.en, /does not answer/);
});

test('bridge labels fall back on the system name', () => {
  assert.equal(bridgeLabel(null), 'Lutron');
  assert.equal(bridgeLabel({ system: 'ra3' }), 'RadioRA 3');
  assert.equal(bridgeLabel({ system: 'caseta', name: 'Smart Bridge 2' }), 'Smart Bridge 2');
});

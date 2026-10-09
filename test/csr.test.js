import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPrivateKey } from 'node:crypto';
import { createCertificateRequest } from '../src/leap/csr.js';

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('creates an RSA-2048 key and a PEM certificate request', async () => {
  const { keyPem, csrPem } = await createCertificateRequest('gladys-lutron');
  const key = createPrivateKey(keyPem);
  assert.equal(key.asymmetricKeyType, 'rsa');
  assert.equal(key.asymmetricKeyDetails.modulusLength, 2048);
  assert.match(
    csrPem,
    /^-----BEGIN CERTIFICATE REQUEST-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE REQUEST-----\n$/,
  );
});

test(
  'OpenSSL verifies the request signature and reads the subject',
  { skip: !hasOpenssl },
  async () => {
    const { csrPem } = await createCertificateRequest('gladys-lutron');
    const output = execFileSync('openssl', ['req', '-verify', '-noout', '-subject'], {
      input: csrPem,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    assert.match(output, /CN\s*=\s*gladys-lutron/);
  },
);

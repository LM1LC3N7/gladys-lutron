// -----------------------------------------------------------------------------
// Key pair + PKCS#10 certificate signing request with node:crypto only.
//
// The bridge signs this request at pairing; the private key never leaves
// Gladys. RSA-2048 / SHA-256 like pylutron-caseta. Node has no CSR builder,
// so the few DER structures needed are written here (checked against
// OpenSSL: `openssl req -verify` in test/csr.test.js).
// -----------------------------------------------------------------------------

import { generateKeyPair, sign } from 'node:crypto';
import { promisify } from 'node:util';

const generateKeyPairAsync = promisify(generateKeyPair);

const OID_COMMON_NAME = '2.5.4.3';
const OID_SHA256_WITH_RSA = '1.2.840.113549.1.1.11';

function derLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  for (let rest = length; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag, ...parts) {
  const value = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(value.length), value]);
}

const sequence = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);

function objectIdentifier(dotted) {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const bytes = [40 * first + second];
  for (const number of rest) {
    const chunk = [number & 0x7f];
    for (let value = number >> 7; value > 0; value >>= 7) chunk.unshift((value & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

const toPem = (label, der) =>
  `-----BEGIN ${label}-----\n${der
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n')}\n-----END ${label}-----\n`;

/**
 * @param {string} commonName subject CN of the request (shown nowhere by Lutron)
 * @returns {Promise<{ keyPem: string, csrPem: string }>}
 */
export async function createCertificateRequest(commonName = 'gladys-lutron') {
  const { privateKey, publicKey } = await generateKeyPairAsync('rsa', { modulusLength: 2048 });
  const subjectPublicKeyInfo = publicKey.export({ type: 'spki', format: 'der' });
  const subject = sequence(
    set(sequence(objectIdentifier(OID_COMMON_NAME), tlv(0x0c, Buffer.from(commonName, 'utf8')))),
  );
  const version = tlv(0x02, Buffer.from([0]));
  const noAttributes = Buffer.from([0xa0, 0x00]);
  const requestInfo = sequence(version, subject, subjectPublicKeyInfo, noAttributes);
  const signature = sign('sha256', requestInfo, privateKey);
  const algorithm = sequence(objectIdentifier(OID_SHA256_WITH_RSA), Buffer.from([0x05, 0x00]));
  const request = sequence(requestInfo, algorithm, tlv(0x03, Buffer.from([0]), signature));
  return {
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    csrPem: toPem('CERTIFICATE REQUEST', request),
  };
}

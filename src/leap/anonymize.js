// -----------------------------------------------------------------------------
// Anonymization of LEAP answers before they reach a log or a bug report.
//
// Kept: the structure, device types, models, firmware versions, room and
// device names (needed to understand a setup, and visible in the Gladys UI
// anyway). Masked: serial numbers (replaced by stable pseudonyms, so links
// between answers survive), MAC and IP addresses, bridge host names, and any
// geographic position. Anything that looks like a credential is dropped.
// -----------------------------------------------------------------------------

const MAC = /\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// At least 5 groups, or a "::": never a LEAP duration such as "00:00:02".
const IPV6 =
  /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b|\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?/gi;
const BRIDGE_HOST = /\blutron-[0-9a-f]{6,}\b/gi;

const SECRET_KEY = /certificate|privatekey|password|secret|token|csr\b/i;
const POSITION_KEY = /latitude|longitude|geolocation/i;
const SERIAL_KEY = /serial/i;
const MAC_KEY = /mac(address)?$/i;
const ADDRESS_KEY = /ipaddress|ipv4|ipv6|gateway|dns|subnet|netmask/i;

/** Replaces serial numbers by "serial-1", "serial-2"… consistently. */
export function createPseudonymizer() {
  const serials = new Map();
  return {
    serial(value) {
      const key = String(value);
      if (!serials.has(key)) serials.set(key, `serial-${serials.size + 1}`);
      return serials.get(key);
    },
  };
}

function maskString(text) {
  return text
    .replace(MAC, 'xx:xx:xx:xx:xx:xx')
    .replace(BRIDGE_HOST, 'lutron-xxxxxxxx')
    .replace(IPV4, 'x.x.x.x')
    .replace(IPV6, 'x:x:x:x');
}

/**
 * @param {unknown} value a JSON value (LEAP body)
 * @param {ReturnType<typeof createPseudonymizer>} [pseudonyms] share one across a whole dump
 * @returns {unknown} an anonymized deep copy
 */
export function anonymize(value, pseudonyms = createPseudonymizer()) {
  const walk = (node, key = '') => {
    if (Array.isArray(node)) return node.map((item) => walk(item, key));
    if (node !== null && typeof node === 'object') {
      const copy = {};
      for (const [childKey, child] of Object.entries(node)) {
        if (SECRET_KEY.test(childKey)) {
          copy[childKey] = '<redacted>';
        } else if (POSITION_KEY.test(childKey)) {
          copy[childKey] = null;
        } else {
          copy[childKey] = walk(child, childKey);
        }
      }
      return copy;
    }
    if (node === null || node === undefined) return node;
    if (SERIAL_KEY.test(key) && (typeof node === 'number' || typeof node === 'string')) {
      return pseudonyms.serial(node);
    }
    if (MAC_KEY.test(key) && typeof node === 'string') return 'xx:xx:xx:xx:xx:xx';
    if (ADDRESS_KEY.test(key) && typeof node === 'string') return 'x.x.x.x';
    return typeof node === 'string' ? maskString(node) : node;
  };
  return walk(value);
}

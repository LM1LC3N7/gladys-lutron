import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyOf, parseMdnsResults, parseTxt } from '../src/leap/discovery.js';
import { serialToHex, systemOf } from '../src/leap/bridgeInfo.js';

test('bridges are read from the raw mDNS answers relayed by the Gladys core', () => {
  const bridges = parseMdnsResults([
    {
      name: 'Lutron Status',
      host: 'Lutron-0123abcd.local',
      addresses: ['fe80::1', '192.168.1.20'],
      port: 22,
      txt: ['MACADDR=00:11:22:33:44:55', 'SYSTYPE=SmartBridge2'],
    },
    {
      name: 'Lutron Status',
      host: 'Lutron-0456ef01.local.',
      addresses: ['192.168.1.9'],
      txt: ['SYSTYPE=RadioRa3'],
    },
    { name: 'printer', host: 'printer.local', addresses: ['192.168.1.30'], txt: [] },
    { name: 'ipv6 only', host: 'Lutron-1.local', addresses: ['fe80::2'], txt: [] },
  ]);
  assert.deepEqual(bridges, [
    { host: '192.168.1.9', serial: '0456EF01', systype: 'RadioRa3', family: 'ra3' },
    { host: '192.168.1.20', serial: '0123ABCD', systype: 'SmartBridge2', family: 'caseta' },
  ]);
});

test('families follow the SYSTYPE values Home Assistant matches', () => {
  assert.equal(familyOf('SmartBridge'), 'caseta');
  assert.equal(familyOf('ra2select'), 'ra2select');
  assert.equal(familyOf('RadioRA3'), 'ra3');
  assert.equal(familyOf('hwqsx'), 'qsx');
  assert.equal(familyOf(undefined), 'unknown');
});

test('TXT records are parsed into lower-case keys', () => {
  assert.deepEqual(parseTxt(['SYSTYPE=x', 'novalue', 42, 'A = b ']), { systype: 'x', a: 'b' });
  assert.deepEqual(parseTxt(undefined), {});
  assert.deepEqual(parseMdnsResults(null), []);
});

test('LEAP serial numbers are compared in the hex form of the mDNS host name', () => {
  assert.equal(serialToHex(19114957), '0123ABCD');
  assert.equal(serialToHex('19114957'), '0123ABCD');
  assert.equal(serialToHex(undefined), null);
  assert.equal(serialToHex(-1), null);
});

test('the project type picks the Caséta or the processor code path', () => {
  assert.equal(systemOf('Lutron Smart Bridge Project'), 'caseta');
  assert.equal(systemOf('Lutron RadioRA 3 Project'), 'ra3');
  assert.equal(systemOf('Lutron HWQS Project'), 'qsx');
  assert.equal(systemOf(undefined), 'caseta');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anonymize, createPseudonymizer } from '../src/leap/anonymize.js';

test('serial numbers become stable pseudonyms shared across answers', () => {
  const pseudonyms = createPseudonymizer();
  const a = anonymize({ Devices: [{ SerialNumber: 19114957 }, { SerialNumber: 42 }] }, pseudonyms);
  const b = anonymize({ Device: { SerialNumber: 19114957, serial: '0123ABCD' } }, pseudonyms);
  assert.deepEqual(a, { Devices: [{ SerialNumber: 'serial-1' }, { SerialNumber: 'serial-2' }] });
  assert.deepEqual(b, { Device: { SerialNumber: 'serial-1', serial: 'serial-3' } });
});

test('MAC and IP addresses, bridge host names and positions are masked', () => {
  const masked = anonymize({
    NetworkInterfaces: [
      { MACAddress: '00:11:22:33:44:55', IPAddress: '192.168.1.20', Gateway: '192.168.1.1' },
    ],
    Note: 'seen at 10.0.0.7 as Lutron-0123abcd.local, mac 0a-1b-2c-3d-4e-5f, ipv6 fe80::1 and 2001:db8:0:0:0:0:0:1',
    Location: { Latitude: 45.5, Longitude: -73.6 },
  });
  assert.deepEqual(masked.NetworkInterfaces, [
    { MACAddress: 'xx:xx:xx:xx:xx:xx', IPAddress: 'x.x.x.x', Gateway: 'x.x.x.x' },
  ]);
  assert.equal(
    masked.Note,
    'seen at x.x.x.x as lutron-xxxxxxxx.local, mac xx:xx:xx:xx:xx:xx, ipv6 x:x:x:x and x:x:x:x',
  );
  assert.deepEqual(masked.Location, { Latitude: null, Longitude: null });
});

test('credentials are dropped, the useful data is kept untouched', () => {
  const body = {
    SigningResult: { Certificate: '-----BEGIN', RootCertificate: '-----BEGIN' },
    Command: { DimmedLevelParameters: { Level: 50, FadeTime: '00:00:02' } },
    Device: {
      Name: 'Plafonnier',
      DeviceType: 'DivaSmartDimmer',
      ModelNumber: 'DVRF-6L',
      FirmwareImage: { Firmware: { DisplayName: '08.25.17f000' } },
    },
  };
  const masked = anonymize(body);
  assert.deepEqual(masked.SigningResult, {
    Certificate: '<redacted>',
    RootCertificate: '<redacted>',
  });
  assert.deepEqual(masked.Command, body.Command, 'a LEAP duration is not an IPv6 address');
  assert.deepEqual(masked.Device, body.Device);
  assert.notEqual(masked, body, 'a copy');
});

test('primitives, null and arrays are handled', () => {
  assert.equal(anonymize(null), null);
  assert.equal(anonymize(7), 7);
  assert.deepEqual(anonymize(['192.168.0.1']), ['x.x.x.x']);
});

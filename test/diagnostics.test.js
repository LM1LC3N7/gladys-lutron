import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeapConnection } from '../src/leap/connection.js';
import {
  DIAGNOSTICS_BEGIN,
  DIAGNOSTICS_END,
  LINE_PREFIX,
  collectDiagnostics,
  toLogLines,
} from '../src/leap/diagnostics.js';
import { ok, startFakeBridge } from './helpers/fakeBridge.js';
import { CREDENTIALS } from './helpers/tls.js';

const CASETA_ROUTES = {
  '/project': () => ok({ Project: { ProductType: 'Lutron Smart Bridge Project' } }),
  '/device?where=IsThisDevice:true': () =>
    ok({ Devices: [{ href: '/device/1', SerialNumber: 19114957 }] }),
  '/area': () => ok({ Areas: [{ href: '/area/2', Name: 'Salon' }] }),
  '/device': () =>
    ok({
      Devices: [
        { href: '/device/1', DeviceType: 'SmartBridge', SerialNumber: 19114957 },
        {
          href: '/device/3',
          Name: 'Plafonnier',
          DeviceType: 'DivaSmartDimmer',
          SerialNumber: 1234,
          LocalZones: [{ href: '/zone/1' }],
        },
        {
          href: '/device/4',
          Name: 'Pico',
          DeviceType: 'Pico3ButtonRaiseLower',
          SerialNumber: 5678,
        },
        {
          href: '/device/5',
          Name: 'Store',
          DeviceType: 'SerenaRollerShade',
          LocalZones: [{ href: '/zone/2' }],
        },
      ],
    }),
  '/zone/1/status': () => ok({ ZoneStatus: { Level: 40, Zone: { href: '/zone/1' } } }),
  '/zone/2/status': () => ok({ ZoneStatus: { Level: 100, Zone: { href: '/zone/2' } } }),
  '/device/5/status': () => ok({ DeviceStatus: { BatteryStatus: { LevelState: 'Good' } } }),
  '/button': () => ok({ Buttons: [{ href: '/button/101', ButtonNumber: 0 }] }),
  '/slow': () => undefined,
};

async function connect(t, routes) {
  const bridge = await startFakeBridge({ routes });
  t.after(() => bridge.close());
  const connection = new LeapConnection({
    host: bridge.host,
    port: bridge.port,
    credentials: CREDENTIALS,
    requestTimeoutMs: 300,
  });
  await connection.open();
  t.after(() => connection.close());
  return { bridge, connection };
}

test('a Caséta crawl reads the system, every zone status and the shade battery, read-only', async (t) => {
  const { bridge, connection } = await connect(t, CASETA_ROUTES);
  const report = await collectDiagnostics(connection);
  const urls = report.entries.map((e) => e.url);
  for (const url of [
    '/project',
    '/device',
    '/button',
    '/virtualbutton',
    '/zone/1/status',
    '/zone/2/status',
    '/device/5/status',
  ]) {
    assert.ok(urls.includes(url), url);
  }
  assert.ok(!urls.includes('/device/3/status'), 'no battery request for a dimmer');
  assert.ok(
    bridge.state.requests.every((r) => r.CommuniqueType === 'ReadRequest'),
    'read-only',
  );
  const virtual = report.entries.find((e) => e.url === '/virtualbutton');
  assert.deepEqual(virtual, { url: '/virtualbutton', outcome: 'status', status: '404 NotFound' });
  const devices = report.entries.find((e) => e.url === '/device').body.Devices;
  assert.deepEqual(
    devices.map((d) => d.SerialNumber),
    ['serial-1', 'serial-2', 'serial-3', undefined],
  );
  const bridgeDevice = report.entries.find((e) => e.url === '/device?where=IsThisDevice:true').body;
  assert.equal(bridgeDevice.Devices[0].SerialNumber, 'serial-1', 'the same pseudonym everywhere');
  assert.equal(report.truncated, false);
});

test('an RA3 crawl follows areas, control stations and keypads', async (t) => {
  const { connection } = await connect(t, {
    '/project': () => ok({ Project: { ProductType: 'Lutron RadioRA 3 Project' } }),
    '/area': () => ok({ Areas: [{ href: '/area/547', Name: 'Cuisine' }] }),
    '/area/547/associatedcontrolstation': () =>
      ok({
        ControlStations: [
          {
            AssociatedGangedDevices: [
              { Device: { href: '/device/900', DeviceType: 'SunnataKeypad' } },
              { Device: { href: '/device/901', DeviceType: 'SunnataDimmer' } },
            ],
          },
        ],
      }),
    '/device/900/buttongroup/expanded': () => ok({ ButtonGroupsExpanded: [] }),
  });
  const report = await collectDiagnostics(connection, { system: 'ra3' });
  const urls = report.entries.map((e) => e.url);
  for (const url of [
    '/zone/status',
    '/area/status',
    '/area/547/associatedzone',
    '/area/547/areascene',
    '/device/900/buttongroup/expanded',
  ]) {
    assert.ok(urls.includes(url), url);
  }
  assert.ok(!urls.includes('/device/901/buttongroup/expanded'), 'dimmers have no button groups');
});

test('timeouts are recorded and the crawl stops at its request budget', async (t) => {
  const { connection } = await connect(t, { ...CASETA_ROUTES, '/project': () => undefined });
  const report = await collectDiagnostics(connection, { maxRequests: 3 });
  assert.equal(report.entries.length, 3);
  assert.equal(report.truncated, true);
  assert.deepEqual(report.entries[1], { url: '/project', outcome: 'timeout' });
});

test('log lines: markers, a header, one line per collection item', () => {
  const lines = toLogLines(
    {
      entries: [
        {
          url: '/device',
          outcome: 'ok',
          body: { Devices: [{ href: '/device/1' }, { href: '/device/2' }] },
        },
        { url: '/project', outcome: 'ok', body: { Project: { ProductType: 'x' } } },
        { url: '/zone', outcome: 'status', status: '405 MethodNotAllowed' },
      ],
      truncated: false,
      durationMs: 12,
    },
    { version: '0.0.0' },
  );
  assert.equal(lines[0], DIAGNOSTICS_BEGIN);
  assert.equal(lines.at(-1), DIAGNOSTICS_END);
  const parsed = lines.slice(1, -1).map((line) => {
    assert.ok(line.startsWith(LINE_PREFIX));
    return JSON.parse(line.slice(LINE_PREFIX.length));
  });
  assert.deepEqual(parsed[0], { header: { version: '0.0.0' } });
  assert.deepEqual(parsed[1], {
    url: '/device',
    outcome: 'ok',
    collection: 'Devices',
    index: 0,
    count: 2,
    item: { href: '/device/1' },
  });
  assert.equal(parsed[2].index, 1);
  assert.deepEqual(parsed[3], {
    url: '/project',
    outcome: 'ok',
    body: { Project: { ProductType: 'x' } },
  });
  assert.deepEqual(parsed[4], { url: '/zone', outcome: 'status', status: '405 MethodNotAllowed' });
  assert.deepEqual(parsed[5], { requests: 3, truncated: false, durationMs: 12 });
});

test('an unexpected error on one endpoint is recorded, the crawl goes on', async () => {
  const connection = {
    async read(url) {
      if (url === '/project') throw new Error('boom');
      return {};
    },
  };
  const report = await collectDiagnostics(connection, { system: 'caseta' });
  assert.deepEqual(report.entries[1], { url: '/project', outcome: 'error', error: 'boom' });
  assert.ok(report.entries.length > 5);
});

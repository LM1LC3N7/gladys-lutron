// Milestone 6: scene actions, the overview widget and its actions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { KINDS } from '../src/leap/deviceTypes.js';
import { createSceneActions } from '../src/gladys/sceneActions.js';
import { WIDGET_ACTIONS, buildOverview } from '../src/gladys/widget.js';
import { startIntegration } from './helpers/integration.js';
import { ok } from './helpers/fakeBridge.js';
import { casetaRoutes } from './helpers/pylutronBridge.js';

function fakeSystem(zones) {
  const calls = [];
  return {
    ready: true,
    calls,
    zone: (id) => zones.find((zone) => zone.id === id) ?? null,
    setLevel: async (...args) => calls.push(['setLevel', ...args]),
    setTilt: async (...args) => calls.push(['setTilt', ...args]),
  };
}

test('scene actions: a level with a fade, a tilt; the wrong devices refused', async () => {
  const zones = [
    { id: '1', kind: KINDS.DIMMER, name: 'Salon Plafonnier' },
    { id: '2', kind: KINDS.SHADE, name: 'Salon Store' },
    { id: '3', kind: KINDS.LIFT_TILT, name: 'Bureau Store bois' },
  ];
  const system = fakeSystem(zones);
  const catalog = {
    zoneOfDevice: new Map([
      ['dev-1', '1'],
      ['dev-2', '2'],
      ['dev-3', '3'],
    ]),
  };
  const actions = createSceneActions({ system, catalog: () => catalog });

  await actions.setLevelWithFade({ device: 'dev-1', level: 80, fade_seconds: 1800 });
  await actions.setLevelWithFade({ device: 'dev-1', level: '0' });
  await actions.setLevelWithFade({ device: 'dev-1', level: 150, fade_seconds: 99999 });
  await actions.setTilt({ device: 'dev-3', tilt: 50 });
  assert.deepEqual(system.calls, [
    ['setLevel', '1', 80, 1800],
    ['setLevel', '1', 0, 2],
    ['setLevel', '1', 100, 14400],
    ['setTilt', '3', 50],
  ]);

  await assert.rejects(
    actions.setLevelWithFade({ device: 'dev-2', level: 5 }),
    /"Salon Store" is not a dimmer/,
  );
  await assert.rejects(
    actions.setTilt({ device: 'dev-1', tilt: 5 }),
    /is not a blind with tilting slats/,
  );
  await assert.rejects(actions.setTilt({ device: 'other', tilt: 5 }), /Unknown Lutron device/);
  await assert.rejects(actions.setLevelWithFade({ device: 'dev-1' }), /"level" must be a number/);
  await assert.rejects(actions.setLevelWithFade({ device: 'dev-1', level: 'x' }), /"level"/);
  system.ready = false;
  await assert.rejects(actions.setTilt({ device: 'dev-3', tilt: 5 }), /not connected/);
});

const INPUT = {
  paired: true,
  connected: true,
  label: 'Smart Bridge (L-BDG2-WH)',
  leapVersion: '1.123',
  statusMessage: { en: 'Connected', fr: 'Connecté' },
  smartAwaySupported: true,
  smartAway: false,
  devices: 12,
  occupiedAreas: ['Salon'],
  lowBatteries: 1,
  recentPresses: [
    { device: 'Salon Pico', button: 'On', press: 'double', at: '2026-10-10T08:00:00.000Z' },
  ],
};

const types = (content) => content.components.map((c) => c.type);

test('widget: connected, with presses, valid for the SDK', () => {
  const content = buildOverview(INPUT);
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(types(content), ['text', 'status', 'card-list', 'button']);
  assert.equal(content.components[0].text, 'Smart Bridge (L-BDG2-WH) · LEAP 1.123');
  const status = content.components[1].items;
  assert.deepEqual(
    status.map((item) => item.label.en ?? item.label),
    ['Bridge', 'Smart Away', 'Devices', 'Occupied rooms', 'Low batteries'],
  );
  assert.equal(status[4].color, 'warning');
  assert.deepEqual(content.components[2].items[0], {
    title: 'Salon Pico · On',
    subtitle: { en: 'Double click', fr: 'Double clic' },
    date: '2026-10-10T08:00:00.000Z',
  });
  assert.equal(content.components[3].action.key, WIDGET_ACTIONS.SMART_AWAY_ON);
  assert.equal(
    buildOverview({ ...INPUT, smartAway: true }).components[3].action.key,
    WIDGET_ACTIONS.SMART_AWAY_OFF,
  );
});

test('widget: offline, not paired, no press, no battery', () => {
  const offline = buildOverview({
    ...INPUT,
    connected: false,
    recentPresses: [],
    occupiedAreas: [],
    lowBatteries: null,
    leapVersion: null,
    statusMessage: { en: 'The bridge does not answer', fr: 'Le bridge ne répond pas' },
  });
  assert.deepEqual(validateWidgetContent(offline), []);
  assert.deepEqual(types(offline), ['text', 'status', 'text', 'button']);
  assert.equal(offline.components[2].text.en, 'The bridge does not answer');
  assert.equal(offline.components[3].action.key, WIDGET_ACTIONS.RECONNECT);
  assert.deepEqual(
    offline.components[1].items.map((item) => item.label.en ?? item.label),
    ['Bridge', 'Smart Away', 'Devices'],
  );

  const quiet = buildOverview({
    ...INPUT,
    recentPresses: [],
    smartAwaySupported: false,
    occupiedAreas: [],
  });
  assert.deepEqual(types(quiet), ['text', 'status', 'text']);
  assert.match(quiet.components[2].text.fr, /Aucun appui/);

  const notPaired = buildOverview({ ...INPUT, paired: false });
  assert.deepEqual(validateWidgetContent(notPaired), []);
  assert.match(notPaired.components[0].text.fr, /Pas encore associé/);
});

test('integration: widget content and actions, scene action on the bridge', async (t) => {
  const routes = {
    ...casetaRoutes(),
    'UpdateRequest /system/away/1/status': (request) =>
      ok({ AwayStatus: { EnabledState: request.Body.AwayStatus.EnabledState } }),
  };
  const { bridge, gladys, lutron } = await startIntegration(t, { routes });

  const content = lutron.getOverview();
  assert.deepEqual(validateWidgetContent(content), []);
  const items = Object.fromEntries(
    content.components[1].items.map((item) => [item.label.en ?? item.label, item.value]),
  );
  assert.deepEqual(items.Bridge, { en: 'Connected', fr: 'Connecté' });
  assert.equal(items['Occupied rooms'], 'Living Room');
  assert.equal(items['Low batteries'], 1);
  assert.equal(items.Devices, gladys.callsOf('publishDiscoveredDevices').at(-1)[0].length);

  const off = await lutron.onWidgetAction(WIDGET_ACTIONS.SMART_AWAY_OFF);
  assert.equal(off.fr, 'Smart Away est désactivé.');
  assert.equal(lutron.system.smartAway, false);
  assert.ok(gladys.callsOf('requestWidgetRefresh').length > 0);
  const reconnect = await lutron.onWidgetAction(WIDGET_ACTIONS.RECONNECT);
  assert.match(reconnect.en, /Connected to/);
  await assert.rejects(lutron.onWidgetAction('dance'), /Unknown widget action/);

  const dimmer = 'ext:ext-test-lutron:zone:00000929';
  await lutron.setLevelWithFade({ device: dimmer, level: 30, fade_seconds: 600 });
  assert.deepEqual(bridge.requestsTo('/zone/1/commandprocessor').at(-1).Body.Command, {
    CommandType: 'GoToDimmedLevel',
    DimmedLevelParameters: { Level: 30, FadeTime: '00:10:00' },
  });
  await assert.rejects(lutron.setTilt({ device: dimmer, tilt: 50 }), /not a blind/);
});

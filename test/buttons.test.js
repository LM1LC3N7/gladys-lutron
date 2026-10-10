// Pico remotes: button names per model, press detection, end to end from a
// LEAP button event to a Gladys button state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETECTION_TIMINGS, PRESSES, createButtonTracker } from '../src/leap/buttonTracker.js';
import { BUTTON_NAMES, buttonName, isRaiseLower } from '../src/leap/picoModels.js';
import { startIntegration } from './helpers/integration.js';
import { casetaRoutes } from './helpers/pylutronBridge.js';
import { waitFor } from './helpers/waitFor.js';

test('button names: per model, then the LEAP name, then "Button n"', () => {
  assert.equal(buttonName('Pico3ButtonRaiseLower', 0), 'On');
  assert.equal(buttonName('Pico3ButtonRaiseLower', 1), 'Favorite');
  assert.equal(buttonName('Pico3ButtonRaiseLower', 4), 'Lower');
  assert.equal(buttonName('Pico4ButtonZone', 2), 'Raise');
  assert.equal(buttonName('Pico4ButtonScene', 4), 'Off');
  assert.equal(buttonName('PaddleSwitchPico', 2), 'Off');
  assert.equal(buttonName('FourGroupRemote', 0), 'All open');
  assert.equal(buttonName('FourGroupRemote', 13), 'Group 2 raise');
  assert.equal(buttonName('FourGroupRemote', 24), 'Group 4 lower');
  assert.equal(Object.keys(BUTTON_NAMES.FourGroupRemote).length, 25);
  assert.equal(buttonName('Pico9Button', 7, '  Scène\n soirée '), 'Scène soirée');
  assert.equal(buttonName('Pico9Button', 7), 'Button 7');
  assert.equal(isRaiseLower('Group 2 raise'), true);
  assert.equal(isRaiseLower('Lower'), true);
  assert.equal(isRaiseLower('Favorite'), false);
});

/** A tracker on a manual clock. */
function manualTracker(mode) {
  let now = 0;
  let timers = [];
  const presses = [];
  const tracker = createButtonTracker({
    mode,
    onPress: (id, press) => presses.push(`${id}:${press}@${now}`),
    setTimer: (fn, ms) => {
      const timer = { at: now + ms, fn };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timers = timers.filter((t) => t !== timer);
    },
  });
  const advance = (ms) => {
    const until = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = due.at;
      due.fn();
    }
    now = until;
  };
  return { tracker, presses, advance, pending: () => timers.length };
}

test('normal: click after the double-click window', () => {
  const { tracker, presses, advance } = manualTracker('normal');
  tracker.handle('1', 'Press');
  advance(100);
  tracker.handle('1', 'Release');
  advance(299);
  assert.deepEqual(presses, []);
  advance(1);
  assert.deepEqual(presses, ['1:click@400']);
});

test('normal: double click reported on the second press', () => {
  const { tracker, presses, advance, pending } = manualTracker('normal');
  tracker.handle('1', 'Press');
  advance(80);
  tracker.handle('1', 'Release');
  advance(150);
  tracker.handle('1', 'Press');
  assert.deepEqual(presses, ['1:double@230']);
  advance(80);
  tracker.handle('1', 'Release');
  advance(1000);
  assert.deepEqual(presses, ['1:double@230'], 'no click after the double');
  assert.equal(pending(), 0);
});

test('normal: long press, then its release; raise / lower wait longer', () => {
  const { tracker, presses, advance } = manualTracker('normal');
  tracker.handle('1', 'Press');
  advance(350);
  assert.deepEqual(presses, ['1:long-press@350']);
  advance(1000);
  tracker.handle('1', 'Release');
  assert.deepEqual(presses, ['1:long-press@350', '1:long-release@1350']);

  tracker.handle('2', 'Press', { raiseLower: true });
  advance(500);
  tracker.handle('2', 'Release');
  advance(300);
  assert.equal(presses.at(-1), '2:click@2150', 'a 500 ms press on Raise stays a click');
  tracker.handle('2', 'Press', { raiseLower: true });
  advance(600);
  assert.equal(presses.at(-1), '2:long-press@2750');
});

test('relaxed: wider windows', () => {
  const { tracker, presses, advance } = manualTracker('relaxed');
  assert.deepEqual(DETECTION_TIMINGS.relaxed, {
    doubleMs: 450,
    longMs: 750,
    raiseLowerExtraMs: 250,
  });
  tracker.handle('1', 'Press');
  advance(600);
  tracker.handle('1', 'Release');
  advance(400);
  tracker.handle('1', 'Press');
  assert.deepEqual(presses, ['1:double@1000']);
});

test('instant: a click on every press, nothing else', () => {
  const { tracker, presses, advance, pending } = manualTracker('instant');
  tracker.handle('1', 'Press');
  tracker.handle('1', 'Release');
  tracker.handle('1', 'Press');
  advance(2000);
  tracker.handle('1', 'Release');
  tracker.handle('1', 'MultiTap');
  tracker.handle('1', 'LongHold');
  assert.deepEqual(presses, ['1:click@0', '1:click@0']);
  assert.equal(pending(), 0);
});

test('native MultiTap and LongHold (RA3 / QSX), lost releases, mode change', () => {
  const { tracker, presses, advance, pending } = manualTracker('normal');
  tracker.handle('1', 'Press');
  tracker.handle('1', 'MultiTap');
  tracker.handle('1', 'Release');
  advance(1000);
  assert.deepEqual(presses, ['1:double@0']);

  tracker.handle('2', 'Press');
  advance(100);
  tracker.handle('2', 'LongHold');
  tracker.handle('2', 'LongHold');
  assert.equal(presses.at(-1), '2:long-press@1100');
  // The Release was lost: the next press closes the long press first.
  tracker.handle('2', 'Press');
  assert.equal(presses.at(-1), '2:long-release@1100');
  tracker.handle('2', 'Release');
  tracker.handle('2', 'MultiTap');
  assert.equal(presses.at(-1), '2:double@1100');

  tracker.handle('3', 'Release');
  tracker.handle('3', 'Hold?');
  tracker.handle('3', 'Press');
  tracker.setMode('relaxed');
  tracker.setMode('relaxed');
  assert.equal(tracker.mode, 'relaxed');
  assert.equal(pending(), 0, 'a mode change forgets the presses in progress');
  advance(5000);
  assert.equal(presses.length, 4);
  assert.equal(PRESSES.LONG_RELEASE, 'long-release');
});

test('end to end: Pico events -> button states, every click published', async (t) => {
  const tags = new Map();
  const routes = casetaRoutes();
  for (const id of ['101', '102', '103']) {
    routes[`SubscribeRequest /button/${id}/status/event`] = (request, client) => {
      tags.set(id, { tag: request.Header.ClientTag, client });
      return { CommuniqueType: 'SubscribeResponse', Header: { StatusCode: '204 NoContent' } };
    };
  }
  const { gladys, lutron } = await startIntegration(t, { routes });
  await lutron.applyConfig({ ...gladys.config, button_detection: 'instant' });
  for (const device of gladys.createAll()) await lutron.onDeviceCreated(device);

  const [devices] = gladys.callsOf('publishDiscoveredDevices').at(-1);
  const pico = devices.find((d) => d.name === 'Master Bathroom Pico');
  assert.deepEqual(
    pico.features.map((f) => [f.name, f.category, f.type, f.read_only]),
    [['On', 'button', 'click', true]],
  );
  const remote = devices.find((d) => d.name === 'Living Room Blinds Remote');
  assert.deepEqual(
    remote.features.map((f) => f.name),
    ['All open', 'Group 1 open'],
  );

  const press = (id, event) => {
    const { tag, client } = tags.get(id);
    client.send({
      CommuniqueType: 'ReadResponse',
      Header: { ClientTag: tag, StatusCode: '200 OK', Url: `/button/${id}/status/event` },
      Body: {
        ButtonStatus: { Button: { href: `/button/${id}` }, ButtonEvent: { EventType: event } },
      },
    });
  };
  press('101', 'Press');
  press('101', 'Release');
  press('101', 'Press');
  press('101', 'Release');
  const feature = pico.features[0].external_id;
  await waitFor(() => gladys.states().filter(([id]) => id === feature).length === 2);
  assert.deepEqual(
    gladys.states().filter(([id]) => id === feature),
    [
      [feature, 1],
      [feature, 1],
    ],
    'two identical clicks are two events',
  );
  assert.deepEqual(
    lutron.recentPresses.map((p) => [p.device, p.button, p.press]),
    [
      ['Master Bathroom Pico', 'On', 'click'],
      ['Master Bathroom Pico', 'On', 'click'],
    ],
  );

  await lutron.applyConfig({ ...gladys.config, button_detection: 'normal' });
  press('102', 'Press');
  await waitFor(() => lutron.recentPresses[0].press === 'long-press', { what: 'long press' });
  press('102', 'Release');
  await waitFor(() => lutron.recentPresses[0].press === 'long-release', { what: 'release' });
  const allOpen = remote.features[0].external_id;
  assert.deepEqual(
    gladys.states().filter(([id]) => id === allOpen),
    [
      [allOpen, 3],
      [allOpen, 4],
    ],
  );
});

// Milestone 7: RadioRA 3 and HomeWorks QSX (pylutron-caseta's processor
// responses): model, keypads and LEDs, area scenes, colour, keypad presses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hueSaturationToRgb, rgbToHueSaturation } from '../src/leap/color.js';
import { hsvCommand, kelvinCommand, warmDimCommand } from '../src/leap/commands.js';
import { LeapConnection } from '../src/leap/connection.js';
import { KINDS } from '../src/leap/deviceTypes.js';
import { LutronSystem, loadModel } from '../src/leap/system.js';
import { ok, startFakeBridge } from './helpers/fakeBridge.js';
import { startIntegration } from './helpers/integration.js';
import { casetaRoutes, processorRoutes } from './helpers/pylutronBridge.js';
import { CREDENTIALS } from './helpers/tls.js';
import { waitFor } from './helpers/waitFor.js';

const RA3 = { system: 'ra3', name: 'Enclosure Device 001', serial: '00A98AC7' };
const QSX = { system: 'qsx', name: 'Enclosure Device 001', serial: '00BC614E' };
const SCENES = {
  547: [
    { href: '/areascene/827', Name: 'Bright' },
    { href: '/areascene/828', Name: 'Night' },
  ],
};

async function connect(t, routes) {
  const bridge = await startFakeBridge({ routes });
  t.after(() => bridge.close());
  const connection = new LeapConnection({
    host: bridge.host,
    port: bridge.port,
    credentials: CREDENTIALS,
    requestTimeoutMs: 500,
  });
  await connection.open();
  t.after(() => connection.close());
  return { bridge, connection };
}

test('colour: RGB <-> hue and saturation', () => {
  assert.deepEqual(rgbToHueSaturation(0xff0000), { hue: 0, saturation: 100 });
  assert.deepEqual(rgbToHueSaturation(0x00ff00), { hue: 120, saturation: 100 });
  assert.deepEqual(rgbToHueSaturation(0x0000ff), { hue: 240, saturation: 100 });
  assert.deepEqual(rgbToHueSaturation(0xff00ff), { hue: 300, saturation: 100 });
  assert.deepEqual(rgbToHueSaturation(0xffffff), { hue: 0, saturation: 0 });
  assert.deepEqual(rgbToHueSaturation(0), { hue: 0, saturation: 0 });
  assert.equal(hueSaturationToRgb(0, 100), 0xff0000);
  assert.equal(hueSaturationToRgb(120, 100), 0x00ff00);
  assert.equal(hueSaturationToRgb(240, 100), 0x0000ff);
  assert.equal(hueSaturationToRgb(60, 100), 0xffff00);
  assert.equal(hueSaturationToRgb(180, 100), 0x00ffff);
  assert.equal(hueSaturationToRgb(300, 100), 0xff00ff);
  assert.equal(hueSaturationToRgb(-60, 0), 0xffffff);
  for (const rgb of [0x123456, 0xff8800, 0x33cc99]) {
    const { hue, saturation } = rgbToHueSaturation(rgb);
    const back = rgbToHueSaturation(hueSaturationToRgb(hue, saturation));
    assert.ok(Math.abs(back.hue - hue) <= 1 && Math.abs(back.saturation - saturation) <= 1);
  }
});

test('colour commands: kelvin, HSV, warm dim (white tune and spectrum)', () => {
  assert.deepEqual(kelvinCommand(KINDS.WHITE_TUNE, 2700.4), {
    CommandType: 'GoToWhiteTuningLevel',
    WhiteTuningLevelParameters: { WhiteTuningLevel: { Kelvin: 2700 } },
  });
  assert.deepEqual(kelvinCommand(KINDS.SPECTRUM, 3000), {
    CommandType: 'GoToSpectrumTuningLevel',
    SpectrumTuningLevelParameters: { ColorTuningStatus: { WhiteTuningLevel: { Kelvin: 3000 } } },
  });
  assert.deepEqual(hsvCommand(370, 120), {
    CommandType: 'GoToSpectrumTuningLevel',
    SpectrumTuningLevelParameters: {
      ColorTuningStatus: { HSVTuningLevel: { Hue: 10, Saturation: 100 } },
    },
  });
  assert.deepEqual(warmDimCommand(KINDS.WHITE_TUNE, true), {
    CommandType: 'GoToWarmDim',
    WarmDimParameters: { CurveDimming: { Curve: { href: '/curve/1' } } },
  });
  assert.deepEqual(warmDimCommand(KINDS.SPECTRUM, false), {
    CommandType: 'GoToSpectrumTuningLevel',
    SpectrumTuningLevelParameters: { ColorTuningStatus: { CurveDimming: null } },
  });
});

test('RA3 model: zones per area, Picos and keypads with engravings and LEDs, occupancy, scenes', async (t) => {
  const { connection } = await connect(t, processorRoutes('ra3', { areaScenes: SCENES }));
  const model = await loadModel(connection, RA3);
  assert.equal(model.system, 'ra3');
  assert.deepEqual(
    model.zones.map((z) => [z.id, z.kind, z.name]),
    [
      ['536', KINDS.SWITCH, 'Equipment Room Overhead'],
      ['1361', KINDS.DIMMER, 'Primary Bath Vanities'],
      ['1377', KINDS.DIMMER, 'Primary Bath Shower & Tub'],
      ['1393', KINDS.SWITCH, 'Primary Bath Vent'],
      ['2091', KINDS.DIMMER, 'Entry Overhead'],
      ['2107', KINDS.DIMMER, 'Entry Landscape'],
      ['2010', KINDS.DIMMER, 'Porch'],
    ],
  );
  const remotes = Object.fromEntries(model.buttonDevices.map((d) => [d.id, d]));
  assert.equal(remotes[5341].name, 'Equipment Room TestingPico TestingPicoDev');
  assert.equal(remotes[5341].serial, '040F9816');
  assert.deepEqual(
    remotes[5341].buttons.map((b) => [b.name, b.raiseLower]),
    [
      ['On', false],
      ['Favorite', false],
      ['Off', false],
      ['Raise', true],
      ['Lower', true],
    ],
  );
  assert.equal(remotes[1488].buttons[0].name, 'Play/Pause', 'the engraving wins');
  assert.equal(remotes[2139].kind, KINDS.KEYPAD);
  assert.equal(remotes[2139].name, 'Entry by Living Room Scene Keypad');
  assert.equal(remotes[2139].areaId, '766');
  assert.deepEqual(
    remotes[2139].buttons.map((b) => [b.number, b.name, b.ledId]),
    [
      [1, 'Bright', '2144'],
      [2, 'Entertain', '2145'],
      [3, 'Dining', '2146'],
      [4, 'Off', '2147'],
    ],
  );
  assert.deepEqual(
    model.occupancyGroups.map((g) => [g.id, g.name, g.sensorDeviceIds]),
    [
      ['766', 'Entry Occupancy', ['1870', '1888']],
      ['2796', 'Porch Occupancy', ['1970']],
    ],
  );
  assert.deepEqual(
    model.scenes.map((s) => [s.id, s.name, s.source, s.areaId]),
    [
      ['827', 'Bright', 'areascene', '547'],
      ['828', 'Night', 'areascene', '547'],
    ],
  );
  assert.equal(model.smartAway, false);
});

test('QSX model: white tune and colour zones with their range, CCO, open/close/stop', async (t) => {
  const { connection } = await connect(t, processorRoutes('hwqsx'));
  const model = await loadModel(connection, QSX);
  const zone = (id) => model.zones.find((z) => z.id === id);
  assert.equal(zone('1692').kind, KINDS.SPECTRUM);
  assert.deepEqual(zone('1692').whiteRange, { min: 1400, max: 10000 });
  assert.equal(zone('989').kind, KINDS.WHITE_TUNE);
  assert.deepEqual(zone('989').whiteRange, { min: 1400, max: 5000 });
  assert.equal(zone('991').kind, KINDS.SPECTRUM);
  assert.equal(zone('993').kind, KINDS.CCO);
  assert.equal(zone('1999').kind, KINDS.OPEN_CLOSE);
  assert.equal(zone('1313').kind, KINDS.SHADE);
  const keypads = model.buttonDevices.map((d) => d.name);
  assert.ok(keypads.includes('Living Room Entryway Keypad 1'), '"Device 1" says less');
  assert.ok(keypads.includes('Foyer Front Door Keypad 1'));
  assert.deepEqual(model.unknownTypes, []);
});

test('RA3 system: states, LEDs, area scene changes, keypad presses', async (t) => {
  const routes = processorRoutes('ra3', { areaScenes: SCENES, leds: { 2144: 'On' } });
  routes['CreateRequest /button/2149/commandprocessor'] = () => ({
    CommuniqueType: 'CreateResponse',
    Header: { StatusCode: '201 Created' },
  });
  const { bridge, connection } = await connect(t, routes);
  const system = new LutronSystem();
  t.after(() => system.detach());
  const events = [];
  for (const name of ['zone', 'occupancy', 'led', 'areaScene']) {
    system.on(name, (...args) => events.push([name, ...args]));
  }
  await system.attach(connection, RA3);
  assert.equal(system.processor, true);
  assert.equal(system.zones.get('536').on, false);
  assert.equal(system.zones.size, 7, 'one /zone/status for every zone');
  assert.equal(bridge.requestsTo('/zone/536/status').length, 0);
  assert.equal(system.leds.get('2144'), true);
  assert.equal(system.leds.get('2145'), false);
  assert.ok(events.some(([name, ledId, on]) => name === 'led' && ledId === '2144' && on));
  assert.equal(system.occupancy.get('766'), null, 'Unknown');
  assert.equal(events.filter(([name]) => name === 'areaScene').length, 0, 'not at load');

  const areaStatus = (scene) => ({
    CommuniqueType: 'ReadResponse',
    Header: { StatusCode: '200 OK', MessageBodyType: 'OneAreaStatus' },
    Body: {
      AreaStatus: {
        href: '/area/547/status',
        OccupancyStatus: 'Occupied',
        CurrentScene: scene ? { href: `/areascene/${scene}` } : null,
      },
    },
  });
  bridge.broadcast(areaStatus(828));
  await waitFor(() => events.some(([name]) => name === 'areaScene'));
  const [, scene, areaId] = events.find(([name]) => name === 'areaScene');
  assert.equal(scene.name, 'Night');
  assert.equal(areaId, '547');
  bridge.broadcast(areaStatus(828));
  bridge.broadcast(areaStatus(null));
  bridge.broadcast(areaStatus(999));
  await waitFor(() => events.filter(([name]) => name === 'areaScene').length === 2);
  assert.equal(events.filter(([name]) => name === 'areaScene')[1][1].name, 'Scene 999');

  await system.setLed('2145', true);
  assert.equal(system.leds.get('2145'), true);
  await assert.rejects(system.setLed('1', true), /Unknown Lutron LED/);
  await system.pressButton('2149');
  assert.deepEqual(bridge.requestsTo('/button/2149/commandprocessor')[0].Body, {
    Command: { CommandType: 'PressAndRelease' },
  });
  await assert.rejects(system.pressButton('1'), /Unknown Lutron button/);
  // A scene change right after our own press in that area is not reported.
  bridge.broadcast({
    ...areaStatus(827),
    Body: { AreaStatus: { href: '/area/766/status', CurrentScene: { href: '/areascene/5' } } },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(events.filter(([name]) => name === 'areaScene').length, 2);
});

test('Caséta: a Pico button cannot be pressed from Gladys', async (t) => {
  const { connection } = await connect(t, casetaRoutes());
  const system = new LutronSystem();
  t.after(() => system.detach());
  await system.attach(connection, { system: 'caseta' });
  await assert.rejects(system.pressButton('101'), /cannot press a Pico button/);
  await assert.rejects(system.setKelvin('1', 2700), /no colour temperature/);
  await assert.rejects(system.setColor('1', 0xff0000), /no colour/);
  await assert.rejects(system.setWarmDim('1', true), /no warm dimming/);
});

test('integration (QSX): colour features, LEDs, area scene trigger, keypad press action', async (t) => {
  const routes = {
    ...processorRoutes('hwqsx', { leds: { 1631: 'On' } }),
    'CreateRequest /button/1640/commandprocessor': () => ({
      CommuniqueType: 'CreateResponse',
      Header: { StatusCode: '201 Created' },
    }),
  };
  for (const zone of ['985', '989', '991']) {
    routes[`CreateRequest /zone/${zone}/commandprocessor`] = () => ok(undefined);
  }
  const { bridge, gladys, lutron } = await startIntegration(t, { routes });
  const [devices] = gladys.callsOf('publishDiscoveredDevices').at(-1);
  const byName = (name) => devices.find((d) => d.name === name);
  const lamp = byName('Foyer Table Lamp');
  assert.deepEqual(
    lamp.features.map((f) => `${f.category}/${f.type}`),
    ['light/binary', 'light/brightness', 'light/temperature', 'light/color', 'switch/binary'],
  );
  assert.equal(lamp.features[2].unit, 'kelvin');
  assert.equal(lamp.features[2].min, 1400);
  const tape = byName('Foyer Lumaris Tape Strip');
  assert.equal(tape.features[2].max, 5000);
  assert.equal(tape.features.length, 4, 'white tune: no colour');
  const keypad = byName('Bedroom 1 Entryway Keypad 1');
  assert.deepEqual(
    keypad.features.map((f) => f.name),
    [
      'Bedroom',
      'Shades',
      'Bright',
      'Dimmed',
      'Bedroom LED',
      'Shades LED',
      'Bright LED',
      'Dimmed LED',
    ],
  );

  for (const device of gladys.createAll()) await lutron.onDeviceCreated(device);
  await lutron.publisher.drain();
  const states = new Map(gladys.states());
  assert.equal(states.get(keypad.features[4].external_id), 1, 'LED 1631 on');
  assert.equal(states.get(keypad.features[5].external_id), 0);

  // Commands: colour temperature, colour, warm dim, LED.
  const set = (device, index, value) => lutron.onSetValue(device, device.features[index], value);
  await set(lamp, 2, 3000);
  assert.deepEqual(bridge.requestsTo('/zone/985/commandprocessor').at(-1).Body.Command, {
    CommandType: 'GoToSpectrumTuningLevel',
    SpectrumTuningLevelParameters: { ColorTuningStatus: { WhiteTuningLevel: { Kelvin: 3000 } } },
  });
  await set(lamp, 3, 0x00ff00);
  assert.deepEqual(
    bridge.requestsTo('/zone/985/commandprocessor').at(-1).Body.Command
      .SpectrumTuningLevelParameters,
    { ColorTuningStatus: { HSVTuningLevel: { Hue: 120, Saturation: 100 } } },
  );
  await set(tape, 2, 99999);
  assert.equal(
    bridge.requestsTo('/zone/989/commandprocessor').at(-1).Body.Command.WhiteTuningLevelParameters
      .WhiteTuningLevel.Kelvin,
    5000,
    'kept within the range of the zone',
  );
  await set(tape, 3, 1);
  assert.equal(
    bridge.requestsTo('/zone/989/commandprocessor').at(-1).Body.Command.CommandType,
    'GoToWarmDim',
  );
  await set(keypad, 5, 1);
  assert.equal(bridge.requestsTo('/led/1632/status').at(-1).Body.LEDStatus.State, 'On');

  // Area scene trigger: names, not ids.
  bridge.broadcast({
    CommuniqueType: 'ReadResponse',
    Header: { StatusCode: '200 OK' },
    Body: { AreaStatus: { href: '/area/804/status', CurrentScene: { href: '/areascene/812' } } },
  });
  await waitFor(() => gladys.callsOf('publishSceneEvent').length === 1);
  assert.deepEqual(gladys.callsOf('publishSceneEvent')[0], [
    'area_scene_activated',
    { area: 'Foyer', scene: 'Scene 812' },
  ]);
  // Scene action: by engraving or number.
  await lutron.pressKeypadButton({ device: keypad.external_id, button: 'shades' });
  assert.equal(bridge.requestsTo('/button/1640/commandprocessor').length, 1);
  await lutron.pressKeypadButton({ device: keypad.external_id, button: '2' });
  assert.equal(bridge.requestsTo('/button/1640/commandprocessor').length, 2);
  await assert.rejects(
    lutron.pressKeypadButton({ device: keypad.external_id, button: 'Disco' }),
    /has no button "Disco": Bedroom \(1\), Shades \(2\)/,
  );
  await assert.rejects(
    lutron.pressKeypadButton({ device: lamp.external_id, button: '1' }),
    /Unknown Lutron keypad/,
  );
});

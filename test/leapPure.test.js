// Pure LEAP helpers: device types, command bodies, status parsers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, kindOf } from '../src/leap/deviceTypes.js';
import {
  fanCommand,
  fanSpeedToPercent,
  formatDuration,
  levelCommand,
  moveCommand,
  percentToFanSpeed,
  pressCommand,
  tiltCommand,
  toLevel,
} from '../src/leap/commands.js';
import {
  areaStatesOf,
  batteryLowOf,
  occupancyStatesOf,
  parseButtonEvent,
  parseLedStatus,
  parseZoneStatus,
  smartAwayOf,
  zoneStatesOf,
} from '../src/leap/status.js';

test('kindOf: the Lutron types of the maintainer and the common ones', () => {
  assert.equal(kindOf('DivaSmartDimmer'), KINDS.DIMMER);
  assert.equal(kindOf('WallDimmer'), KINDS.DIMMER);
  assert.equal(kindOf('Dimmed'), KINDS.DIMMER, 'RA3 zone ControlType');
  assert.equal(kindOf('Switched'), KINDS.SWITCH);
  assert.equal(kindOf('DivaSmartSwitch'), KINDS.SWITCH);
  assert.equal(kindOf('CCO'), KINDS.CCO);
  assert.equal(kindOf('CasetaFanSpeedController'), KINDS.FAN);
  assert.equal(kindOf('SerenaRollerShade'), KINDS.SHADE);
  assert.equal(kindOf('SerenaTiltOnlyWoodBlind'), KINDS.TILT_BLIND);
  assert.equal(kindOf('QsWirelessWoodBlind'), KINDS.LIFT_TILT);
  assert.equal(kindOf('OpenCloseStop'), KINDS.OPEN_CLOSE);
  assert.equal(kindOf('RightDrawDrape'), KINDS.DRAPE);
  assert.equal(kindOf('Pico3ButtonRaiseLower'), KINDS.REMOTE);
  assert.equal(kindOf('FourGroupRemote'), KINDS.REMOTE);
  assert.equal(kindOf('SunnataKeypad'), KINDS.KEYPAD);
  assert.equal(kindOf('RPSOccupancySensor'), KINDS.OCCUPANCY_SENSOR);
  assert.equal(kindOf('WhiteTune'), KINDS.WHITE_TUNE);
  assert.equal(kindOf('SpectrumTune'), KINDS.SPECTRUM);
});

test('kindOf: new models of a known family, and unknown types', () => {
  assert.equal(kindOf('SivoiaFutureShade'), KINDS.SHADE);
  assert.equal(kindOf('FancyDrape'), KINDS.DRAPE);
  assert.equal(kindOf('Pico5Button'), KINDS.REMOTE);
  assert.equal(kindOf('FutureKeypad'), KINDS.KEYPAD);
  assert.equal(kindOf('SmartBridge'), null);
  assert.equal(kindOf('Toaster'), null);
  assert.equal(kindOf(undefined), null);
});

test('formatDuration: hh:mm:ss, bounded to 4 hours', () => {
  assert.equal(formatDuration(0), '00:00:00');
  assert.equal(formatDuration(2), '00:00:02');
  assert.equal(formatDuration(3725), '01:02:05');
  assert.equal(formatDuration(14400), '04:00:00');
  assert.equal(formatDuration(99999), '04:00:00');
  assert.equal(formatDuration(-5), '00:00:00');
  assert.equal(formatDuration('x'), '00:00:00');
});

test('toLevel: integers within 0-100, a non-number is refused', () => {
  assert.equal(toLevel(42.6), 43);
  assert.equal(toLevel(-1), 0);
  assert.equal(toLevel(140), 100);
  assert.equal(toLevel('55'), 55);
  assert.throws(() => toLevel('abc'), RangeError);
});

test('fan speeds <-> percent: the four speeds of Lutron fans', () => {
  assert.equal(percentToFanSpeed(0), 'Off');
  assert.equal(percentToFanSpeed(25), 'Low');
  assert.equal(percentToFanSpeed(40), 'Medium');
  assert.equal(percentToFanSpeed(70), 'MediumHigh');
  assert.equal(percentToFanSpeed(100), 'High');
  assert.equal(percentToFanSpeed(200), 'High');
  assert.equal(fanSpeedToPercent('MediumHigh'), 75);
  assert.equal(fanSpeedToPercent('Turbo'), null);
});

test('levelCommand: per kind, with and without a fade', () => {
  assert.deepEqual(levelCommand(KINDS.DIMMER, 50), {
    CommandType: 'GoToLevel',
    Parameter: [{ Type: 'Level', Value: 50 }],
  });
  assert.deepEqual(levelCommand(KINDS.DIMMER, 50, 90), {
    CommandType: 'GoToDimmedLevel',
    DimmedLevelParameters: { Level: 50, FadeTime: '00:01:30' },
  });
  assert.deepEqual(levelCommand(KINDS.WHITE_TUNE, 30, 2), {
    CommandType: 'GoToWhiteTuningLevel',
    WhiteTuningLevelParameters: { Level: 30, FadeTime: '00:00:02' },
  });
  assert.deepEqual(levelCommand(KINDS.SPECTRUM, 30), {
    CommandType: 'GoToSpectrumTuningLevel',
    SpectrumTuningLevelParameters: { Level: 30 },
  });
  assert.deepEqual(levelCommand(KINDS.CCO, 100), {
    CommandType: 'GoToCCOLevel',
    CCOLevelParameters: { CCOLevel: 'Closed' },
  });
  assert.equal(levelCommand(KINDS.CCO, 0).CCOLevelParameters.CCOLevel, 'Open');
  assert.deepEqual(levelCommand(KINDS.SWITCH, 100, 5), {
    CommandType: 'GoToLevel',
    Parameter: [{ Type: 'Level', Value: 100 }],
  });
});

test('tilt, fan, move and press commands', () => {
  assert.deepEqual(tiltCommand(50), { CommandType: 'GoToTilt', TiltParameters: { Tilt: 50 } });
  assert.deepEqual(fanCommand(50), {
    CommandType: 'GoToFanSpeed',
    FanSpeedParameters: { FanSpeed: 'Medium' },
  });
  assert.deepEqual(moveCommand('Raise'), { CommandType: 'Raise' });
  assert.deepEqual(pressCommand(), { CommandType: 'PressAndRelease' });
});

test('parseZoneStatus: level, switched, CCO, fan, tilt, colour', () => {
  assert.deepEqual(parseZoneStatus({ Level: 40, Zone: { href: '/zone/1' } }), {
    zoneId: '1',
    level: 40,
    on: null,
    fanSpeed: null,
    tilt: null,
    kelvin: null,
    hue: null,
    saturation: null,
    warmDim: null,
  });
  assert.equal(parseZoneStatus({ href: '/zone/7/status', SwitchedLevel: 'On' }).on, true);
  assert.equal(parseZoneStatus({ Zone: { href: '/zone/7' }, CCOLevel: 'Open' }).on, false);
  assert.equal(parseZoneStatus({ Zone: { href: '/zone/7' }, Level: -1 }).level, null);
  assert.equal(parseZoneStatus({ Zone: { href: '/zone/2' }, FanSpeed: 'High' }).fanSpeed, 'High');
  assert.equal(parseZoneStatus({ Zone: { href: '/zone/3' }, Tilt: 25 }).tilt, 25);
  const color = parseZoneStatus({
    Zone: { href: '/zone/9' },
    ColorTuningStatus: {
      HSVTuningLevel: { Hue: 120, Saturation: 80 },
      CurveDimming: { Curve: { href: '/curve/1' } },
    },
  });
  assert.equal(color.hue, 120);
  assert.equal(color.saturation, 80);
  assert.equal(color.warmDim, true);
  const white = parseZoneStatus({
    Zone: { href: '/zone/9' },
    ColorTuningStatus: { WhiteTuningLevel: { Kelvin: 2700 } },
  });
  assert.equal(white.kelvin, 2700);
  assert.equal(white.warmDim, false);
  assert.equal(parseZoneStatus({ Level: 5 }), null);
  assert.equal(parseZoneStatus(null), null);
});

test('zoneStatesOf: one or many zone statuses', () => {
  assert.equal(zoneStatesOf({ ZoneStatus: { Level: 1, Zone: { href: '/zone/1' } } }).length, 1);
  assert.equal(
    zoneStatesOf({
      ZoneStatuses: [
        { href: '/zone/1/status', Level: 1 },
        { href: '/zone/2/status', Level: 2 },
        { nonsense: true },
      ],
    }).length,
    2,
  );
  assert.deepEqual(zoneStatesOf({ Other: 1 }), []);
});

test('parseButtonEvent, smart away, LEDs, battery', () => {
  assert.deepEqual(
    parseButtonEvent({
      ButtonStatus: { Button: { href: '/button/101' }, ButtonEvent: { EventType: 'Press' } },
    }),
    { buttonId: '101', event: 'Press' },
  );
  assert.equal(parseButtonEvent({ ButtonStatus: {} }), null);
  assert.equal(smartAwayOf({ AwayStatus: { EnabledState: 'Enabled' } }), true);
  assert.equal(smartAwayOf({ AwayStatus: { EnabledState: 'Disabled' } }), false);
  assert.equal(smartAwayOf({}), null);
  assert.deepEqual(parseLedStatus({ LEDStatus: { LED: { href: '/led/5' }, State: 'On' } }), {
    ledId: '5',
    on: true,
  });
  assert.equal(parseLedStatus({ LEDStatus: { LED: { href: '/led/5' }, State: 'Blink' } }), null);
  assert.equal(batteryLowOf({ DeviceStatus: { BatteryStatus: { LevelState: 'Low' } } }), true);
  assert.equal(batteryLowOf({ DeviceStatus: { BatteryStatus: { LevelState: 'Good' } } }), false);
  assert.equal(batteryLowOf({ DeviceStatus: {} }), null);
  assert.equal(batteryLowOf(null), null);
});

test('occupancy groups (Caséta) and area statuses (RA3/QSX)', () => {
  assert.deepEqual(
    occupancyStatesOf({
      OccupancyGroupStatuses: [
        { OccupancyGroup: { href: '/occupancygroup/2' }, OccupancyStatus: 'Occupied' },
        { OccupancyGroup: { href: '/occupancygroup/3' }, OccupancyStatus: 'Unknown' },
      ],
    }),
    [
      { groupId: '2', occupied: true },
      { groupId: '3', occupied: null },
    ],
  );
  assert.deepEqual(
    occupancyStatesOf({
      OccupancyGroupStatus: { href: '/occupancygroup/4/status', OccupancyStatus: 'Unoccupied' },
    }),
    [{ groupId: '4', occupied: false }],
  );
  assert.deepEqual(
    areaStatesOf({
      AreaStatuses: [
        {
          href: '/area/547/status',
          OccupancyStatus: 'Occupied',
          CurrentScene: { href: '/areascene/827' },
        },
        { href: '/area/3/status', CurrentScene: null },
        { href: '/area/4/status', Level: 10 },
      ],
    }),
    [
      { areaId: '547', occupied: true, sceneId: '827' },
      { areaId: '3', occupied: undefined, sceneId: null },
      { areaId: '4', occupied: undefined, sceneId: undefined },
    ],
  );
});

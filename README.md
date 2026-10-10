# Lutron integration for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) to
control Lutron lighting, shades and fans and to use Pico remotes in Gladys
scenes, **fully locally** over Lutron's LEAP protocol: Caséta (Smart Hub and
Smart Bridge PRO), RA2 Select, RadioRA 3 and HomeWorks QSX.

> **Status: in development** (milestones 1 to 7 of 8 done: LEAP client, local pairing, devices, states and commands, Pico buttons, scene actions and triggers, dashboard widget, RadioRA 3 / HomeWorks QSX; hardening comes next). The audit of existing libraries and
> integrations is in [AUDIT.md](./AUDIT.md), the implementation plan in
> [TODO.md](./TODO.md).

## Planned scope (v1)

- Bridge discovery on the network and pairing from the Gladys UI (press the
  button on the bridge), no cloud account.
- Dimmers (with fade time), switches and plug-in modules, shades and tilt
  blinds, fans, occupancy groups, Lutron scenes, Smart Away, shade battery.
- Pico remotes as Gladys buttons: click, double click and long press, usable
  in the core "device state" scene trigger.
- A robust connection: keep-alive watchdog, reconnection and full state
  resync.
- Gladys 5.1 surfaces: a dashboard overview widget, scene actions for what
  device features cannot express (fade, tilt, keypad press), bridge
  offline/online and room scene triggers.
- RadioRA 3 and HomeWorks QSX: keypads with engravings and LEDs, tunable
  white and colour lights.

## Design choices

- An in-house LEAP client with no runtime dependency besides the Gladys SDK,
  ported from [pylutron-caseta](https://github.com/gurumitts/pylutron-caseta)
  (Apache-2.0, the library Home Assistant uses). The npm `lutron-leap`
  package was not used: it is GPL-3.0 and never verifies the bridge
  certificate, among other issues (see [AUDIT.md](./AUDIT.md) §2).
- No duplicate of Gladys features: button presses, occupancy and battery are
  device features driving the core scene trigger, not custom triggers.

## Development

```sh
npm ci
npm run format:check && npm run lint && npm test && npm audit
npm run validate:manifest   # Gladys store validator
```

- `src/leap/`: the LEAP client (TLS connection, session with keep-alive and
  reconnection, pairing, mDNS answers parsing, the project model, status
  parsers, command bodies, the live system with its 15-minute resync); no
  Gladys import.
- `src/gladys/`: the Gladys adapter (configuration, bridge controller,
  devices and their external ids, rate-limited state publisher, commands,
  transport badges and offline detection, messages, frozen manifest keys);
  `src/gladys/integration.js` ties them together, `index.js` only registers
  the handlers.
- `test/helpers/fakeBridge.js`: a fake Lutron bridge over TLS used by the
  tests, serving the LEAP answers of pylutron-caseta's tests
  (`test/fixtures/pylutron/`, `test/helpers/pylutronBridge.js`);
  `test/index.e2e.test.js` runs the real `index.js` against it and a fake
  Gladys.
- `LUTRON_LEAP_PORT` / `LUTRON_PAIRING_PORT`: development only, to reach a
  fake bridge on other ports (TLS checks stay on).

## Disclaimer

Not affiliated with or endorsed by Lutron Electronics. Lutron, Caséta, Pico,
RadioRA and HomeWorks are trademarks of Lutron Electronics Co., Inc. LEAP is
not publicly documented by Lutron and a firmware update may change it.

# Audit — Lutron (LEAP) integration for Gladys Assistant

Research done on 2026-10-09, before any code. It answers four questions:
which library to build on, what the other home-automation systems already do
(and get wrong), what Gladys already provides (to avoid duplicates), and what
the Gladys sandbox allows. The resulting plan is in [TODO.md](./TODO.md).

## 1. Summary

- **Protocol**: LEAP only (JSON over TLS, port 8081; pairing on port 8083 by
  pressing the bridge button). It is fully local and is the only protocol of
  the standard Caséta bridge and of RadioRA 3. The telnet "Lutron Integration
  Protocol" exists only on Smart Bridge PRO, RA2 Select, RadioRA 2 and
  HomeWorks QS, so it is out of scope.
- **Library**: do **not** depend on `lutron-leap`. It is GPL-3.0, has npm
  audit findings, has an unmaintained mDNS dependency, never checks the
  bridge certificate, and corrupts accented names. Write a small LEAP client
  with **zero runtime dependencies** (`node:tls`, `node:crypto`), ported from
  the Apache-2.0 `pylutron-caseta` that Home Assistant uses. Estimated size:
  700 to 900 lines plus tests.
- **Reference implementation**: Home Assistant `lutron_caseta`. It has three
  long-standing gaps that are cheap for us to close:
  - no double-click or long press on Pico remotes;
  - states go stale after a silent disconnection;
  - "button" means "send a press", not "a press happened", which confuses
    users.
- **Gladys**: nothing Lutron-specific exists. Lutron Caséta is named by the
  Gladys maintainer as "the biggest North-American gap"
  ([forum 10385](https://community.gladysassistant.com/t/10385)). Lutron
  products do not speak Matter natively, so the Gladys Matter integration
  does not cover them either.
- **Naming**: rename the repository to `gladys-lutron` **before the first
  release** (see §7).

## 2. Node.js LEAP libraries

Checked with `npm view`, `npm install --ignore-scripts` + `npm audit`, and a
read of the sources (shallow clones).

| Package                                                                               | Latest (date)       | License     | Runtime deps (installed) | npm audit                                                       | Maintenance                                                                          | RA3 / QSX          | Pairing CSR           |
| ------------------------------------------------------------------------------------- | ------------------- | ----------- | ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------ | --------------------- |
| [`lutron-leap`](https://github.com/thenewwazoo/lutron-leap-js)                        | 3.6.2 (2026-08-31)  | **GPL-3.0** | 6 (23 packages, 16 MB)   | 1 high, 3 moderate (`ip-address@8.1.0`, `sprintf-js`, `uuid@9`) | Release bursts (2022, 2023, 2026), manual publishes, QSX PR unreviewed               | crawl added in 3.5 | no (bring node-forge) |
| `@vpulim/lutron-leap`, `@terafin2/lutron-leap`                                        | 2023                | GPL-3.0     | similar                  | 1 high                                                          | abandoned forks                                                                      | no                 | no                    |
| [`@mkellsy/leap-client`](https://github.com/mkellsy/leap-client)                      | 1.7.8 (2025-03-29)  | MIT         | 10 (96 packages, 13 MB)  | 2 high (`node-forge` GHSA-86w9-cpqp-85rv), `uuid`               | dormant; writes to `~/.leap` (breaks on a read-only rootfs); wrong tilt/fan commands | yes                | yes (node-forge)      |
| [`@vldmit/leap-client`](https://github.com/vldmit/leap-client)                        | 1.7.10 (2026-07-20) | MIT         | same as above            | 2 high                                                          | one-person fork, started 2026-07                                                     | yes                | yes                   |
| [`pylutron-caseta`](https://github.com/gurumitts/pylutron-caseta) (Python, reference) | 0.29.0 (2026-06-10) | Apache-2.0  | `cryptography`, `orjson` | n/a                                                             | very active, used by Home Assistant, commits up to 2026-10-04                        | yes                | yes                   |

`caseta-leap` does not exist on npm. The Node-RED nodes
(`node-red-contrib-caseta`, `node-red-contrib-lutron`) use telnet, not LEAP.

### `lutron-leap` defects relevant to us

About 350 of its 2,450 TypeScript lines are the actual framing, correlation
and subscription logic. The author's README says the socket handling is
"super duper ugly". Defects found:

1. `data.toString()` on each TCP chunk without a `StringDecoder`: a multi-byte
   character split across chunks becomes U+FFFD ("Salle à manger").
2. The pairing client parses raw chunks (no line buffering), and its `close`
   handler is never run.
3. `rejectUnauthorized: false`: the bridge certificate is never verified, so a
   LAN man-in-the-middle goes unnoticed.
4. `reconfigureBridge()` drops the ping interval without `clearInterval`: one
   more timer on each mDNS re-announce.
5. Timed-out requests stay in `inFlightRequests` forever.
6. Before 3.6.2 a failed keep-alive ping did nothing. The Homebridge plugin
   had to add its own watchdog and re-subscribe logic.
7. Discovery reads private internals of `tinkerhub-mdns` (last published
   2022); its Docker mDNS bug has been open since 2022
   ([#22](https://github.com/thenewwazoo/lutron-leap-js/issues/22)).
8. QSX detection is a guess (`/device` returns 204 or five devices or fewer).

The npm `dist` is byte-identical to a rebuild of the tag. One extra example
file shows it is published by hand from a local checkout.

### Decision: in-house client, zero runtime dependency

- **License**: depending on, forking or vendoring `lutron-leap` makes the
  image GPL-3.0. Porting the design of `pylutron-caseta` (Apache-2.0) with
  attribution is compatible with the Apache-2.0 license used by the other
  integrations of this maintainer.
- **Security**: proper CA pinning, no `node-forge` (high advisory still open
  in 1.4.0), nothing to audit beyond the Gladys SDK.
- **Pairing without a library**: a PKCS#10 CSR built with `node:crypto` only
  takes about 20 lines; a proof of concept was checked with
  `openssl req -verify` ("self-signature verify OK").
- **Size**: framing, tags, subscriptions, ping, reconnection ≈ 300 lines;
  pairing ≈ 150; Caséta + RA3/QSX model loaders ≈ 350. Memory use is
  negligible against the 256 MB budget.

### LEAP facts to implement (from `pylutron-caseta`)

- Messages are one JSON object per line (`\r\n`). Requests:
  `{"CommuniqueType":"ReadRequest|SubscribeRequest|CreateRequest|UpdateRequest","Header":{"ClientTag":"<uuid>","Url":"/…"},"Body":{…}}`.
  Untagged messages are unsolicited status updates and must be dispatched
  too. `204 NoContent` has no body.
- Keep-alive: `ReadRequest /server/1/status/ping` every 60 s
  (`Body.PingResponse.LEAPVersion`). Subscriptions belong to one connection:
  after any reconnection, load and subscribe again from scratch.
- TLS client options: stored CA, client cert and key, `minVersion: TLSv1.2`,
  `rejectUnauthorized: true`, no host-name check (the bridge certificate has
  no usable name). IPv4 only
  ([pylutron #139](https://github.com/gurumitts/pylutron-caseta/issues/139)).
- **Pairing** (port 8083):
  1. Generate an RSA-2048 key and a SHA-256 CSR.
  2. Open TLS with the public "LAP" client certificate and key that every
     LEAP client ships (`pylutron_caseta/assets.py`). Trust the LAP CA
     (valid until 2035-10-31) and `lutron-root` (RA3/QSX, valid until 2036).
  3. Wait for the user to press the bridge button. The bridge sends
     `{"Header":{"StatusCode":"200 OK",…},"Body":{"Status":{"Permissions":["Public","PhysicalAccess"]}}}`.
  4. Send
     `{"Header":{"RequestType":"Execute","Url":"/pair","ClientTag":"get-cert"},"Body":{"CommandType":"CSR","Parameters":{"CSR":"…","DisplayName":"gladys-lutron","DeviceUID":"000000000000","Role":"Admin"}}}`.
  5. Read `Body.SigningResult.Certificate` and `RootCertificate`. For RA3 and
     QSX, keep `lutron-root` as the CA instead.
  6. Check: ping on port 8081 with the new credentials.
- **Model (Caséta, RA2 Select)**: `/project` (`ProductType` picks the code
  path), `/area`, `/device`, `/button`, `/virtualbutton` (programmed scenes),
  `/occupancygroup`, `/zone/{id}/status`, `/device?where=IsThisDevice:true`
  (the bridge), `/system/away/1/status` (Smart Away), `/device/{id}/status`
  (shade battery).
- **Model (RA3, QSX)**: per area `/area/{id}/associatedcontrolstation`
  (keypads), `/device/{id}/buttongroup/expanded` (buttons, engravings, LEDs),
  `/area/{id}/associatedzone` (zones, `ControlType`, white-tuning range),
  `/area/{id}/areascene` (scenes, activated through
  `/preset/{id}/commandprocessor`), occupancy via `/area/status`.
- **Events**: `/zone/status` (subscribe on RA3/QSX; untagged `OneZoneStatus`
  on Caséta), `/button/{id}/status/event` (`Press`, `Release`, `MultiTap`,
  `LongHold`), `/occupancygroup/status` (Caséta) or `/area/status` (RA3),
  `/led/{id}/status`, `/system/away/1/status`.
- **Commands** (`CreateRequest /zone/{id}/commandprocessor`): `GoToLevel`,
  `GoToDimmedLevel` (with `FadeTime` "hh:mm:ss"), `GoToFanSpeed`
  (`Off|Low|Medium|MediumHigh|High`), `GoToTilt`, `Raise` / `Lower` / `Stop`,
  `GoToWhiteTuningLevel`, `GoToSpectrumTuningLevel`, `GoToWarmDim`,
  `GoToCCOLevel`. Scenes: `PressAndRelease` on
  `/virtualbutton/{id}/commandprocessor`. Keypad press (RA3/QSX):
  `/button/{id}/commandprocessor`. A Caséta Pico press **cannot** be
  simulated ([pylutron #96](https://github.com/gurumitts/pylutron-caseta/issues/96)).
  `GoToShadeLevel` and `GoToSwitchedLevel` are used by no audited library:
  do not use them.
- **Quirks**: `Raise`/`Lower` send no immediate status; a big QSX project
  needs about 800 calls and 42 s to load; firmware 23.4 broke some
  occupancy sensors
  ([pylutron #144](https://github.com/gurumitts/pylutron-caseta/issues/144));
  a slow `/device` read after a bridge reboot can leave a connection without
  subscriptions
  ([pylutron #206](https://github.com/gurumitts/pylutron-caseta/issues/206)).

## 3. Home Assistant

### `lutron_caseta` (core, LEAP, `pylutron-caseta`)

Source read on `dev` (2026-10-09). Supports the Caséta Smart Hub and Smart
Bridge PRO, RA2 Select, RadioRA 3 and HomeWorks QSX.

| Platform        | What it creates                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `light`         | Dimmers with transition; WhiteTune, SpectrumTune/Ketra, ColorTune, warm dim (2024); restores the last brightness |
| `switch`        | Switches, PowPak, CCO relays; **keypad LEDs** (RA3/QSX); **Smart Away** (2025-11)                                |
| `cover`         | Shades (open/close/stop/position), tilt-only wood blinds, OpenCloseStop (2026-08)                                |
| `fan`           | Four speeds mapped to percentages                                                                                |
| `scene`         | Caséta scenes (`/virtualbutton`), none on RA3/QSX                                                                |
| `button`        | One entity per keypad or Pico button, which **sends** a press (Pico ones disabled by default)                    |
| `binary_sensor` | One occupancy entity per **occupancy group**; shade battery low (2026)                                           |
| `event`         | None yet: draft [PR #184266](https://github.com/home-assistant/core/pull/184266)                                 |

- Device triggers `press`, `release`, `multi_tap` (some keypads only),
  `long_press` (QSX only: "Caseta and RadioRA3 processors do not emit
  LongHold"). Readable button names per Pico model (`on`, `off`, `stop`,
  `raise`, `lower`, `button_1`…), from the LEAP button numbers.
- Bus event `lutron_caseta_button_event` (serial, model, button, area,
  action).
- Setup: zeroconf `_lutron._tcp` (`SYSTYPE` smartbridge / ra2select /
  radiora3 / hwqs), a "press the button" link step, three PEM files stored.
  Connection timeout 9 s, configuration load 50 s
  ([#110067](https://github.com/home-assistant/core/issues/110067)).
- Diagnostics download; Lutron areas suggested as HA areas.

The older `lutron` integration (RadioRA 2 / HomeWorks QS over telnet) shows
two ideas worth reusing: **event** entities for keypad buttons, and keypad
LEDs as a select (Off / On / Slow flash / Fast flash). Its documented
gotcha: the repeater turns a keypad LED back off a few seconds after a
press.

### Home Assistant pain points (issues and forum)

1. **Stale states after a silent disconnection**, open since 2024
   ([#128541](https://github.com/home-assistant/core/issues/128541), 31
   comments): commands still work, status updates stop, only a reload fixes
   it. Also daily drops after the Smart Away release
   ([#158147](https://github.com/home-assistant/core/issues/158147)).
2. **No double-click or long press on Pico remotes**: requested for years
   ([#71844](https://github.com/home-assistant/core/issues/71844),
   [forum 521194](https://community.home-assistant.io/t/lutron-caseta-integration-pico-remote-double-click-hold-events/521194),
   [forum 1003422](https://community.home-assistant.io/t/lutron-caseta-pico-remove-double-long-press-new-approach/1003422)).
   Users rely on templates or the `pico_click` custom component. RA3 keypads
   send press then release on every press
   ([#105532](https://github.com/home-assistant/core/issues/105532)).
3. **"Button" means "send a press"**: the entity trigger never fires on a
   physical press ([#177026](https://github.com/home-assistant/core/issues/177026)).
4. **Battery**: no Pico or sensor battery at all; shade battery only since
   2026 ([#74544](https://github.com/home-assistant/core/issues/74544)).
5. **Several RA3 processors** create duplicate devices and duplicate Pico
   events ([#179339](https://github.com/home-assistant/core/issues/179339)).
6. **Setup and connection**: large projects timed out; jumbo frames broke
   the TLS handshake
   ([#139232](https://github.com/home-assistant/core/issues/139232));
   unhelpful pairing errors.
7. **New device types missed** for years: wood tilt blinds, PowPak 0-10V,
   Diva/Claro, fan medium-high speed, shade stutter. An unmapped button even
   dropped the connection
   ([#184579](https://github.com/home-assistant/core/pull/184579)).
8. **No scenes on RA3** ([#82764](https://github.com/home-assistant/core/issues/82764)).

## 4. Other ecosystems

- **Homebridge** ([`@homebridge-plugins/homebridge-lutron`](https://github.com/homebridge-plugins/homebridge-lutron),
  3.2.1, 2026-08-24, uses `lutron-leap`): Caséta, PRO, RA2 Select; dimmers,
  switches, Serena tilt blinds, occupancy, all Picos. No fans, roller shades
  or keypads. Pairing in its own settings page. **Double and long press
  detected in software** (`ButtonState.ts`): double-press window 300 ms
  (450 ms "relaxed"), long press after 350 ms (300 quick, 750 relaxed),
  +250 ms on raise/lower buttons; each can be disabled. A `filterPico`
  option hides Picos already bound to Lutron loads. A **connection
  watchdog** (ping every 60 s, 10 s timeout, reconnect after 3 failures)
  added in 3.1.8 because the library never repaired half-open sockets.
- **Hubitat**: built-in "Lutron Integrator", telnet only (PRO, RA2 Select,
  RA2, HWQS). Picos as "pushed/held" (hold timed by Hubitat) or the faster
  "pushed/released".
- **openHAB**: Lutron binding with an experimental LEAP bridge (Caséta, RA2
  Select, RA3). Certificates made by hand with pylutron's `lap-pair` and a
  Java keystore. Dimmer fade times, fan, shade, blind tilt, occupancy group,
  Pico, keypad with LED channels, virtual keypad for scenes. States that
  RA3 reports hold and multi-tap only for buttons programmed for them in
  Lutron Designer, which contradicts Home Assistant: to test on hardware.
- **Homey** (Drenso app): 17 device types; Pico flow cards pressed, long
  pressed, released; no double press.
- **SmartThings**: official cloud integration, dimmers and switches only,
  Picos invisible. **Node-RED**: telnet only. **Domoticz, Jeedom**: nothing.
- **Matter**: no native Matter on Caséta or RA3
  ([PCWorld, 2025-07](https://www.pcworld.com/article/2844095/this-smart-lighting-brand-is-matter-agnostic-and-thats-fine-by-me.html)).
  Only third-party bridges (Homebridge in Matter mode, Matterbridge), which
  lose fade, LEDs, Smart Away, battery and areas.
- **Lutron**: LEAP replaces telnet, needs physical access to pair, and is
  not publicly documented
  ([Lutron support](https://support.lutron.com/us/en/product/radiora3/article/networking/Lutron-s-LEAP-API-Integration-Protocol)).
  Firmware updates may change it.

### Feature matrix

| Feature                | HA `lutron_caseta`         | Homebridge | Hubitat  | openHAB (LEAP)         | **Gladys (target)**               |
| ---------------------- | -------------------------- | ---------- | -------- | ---------------------- | --------------------------------- |
| Standard Caséta hub    | ✔                          | ✔          | ✖        | ✔                      | ✔                                 |
| RA3 / QSX              | ✔ / ✔                      | ✖ / ✖      | ✖ / ✖    | ✔ / ✖                  | ✔ / ✔ (untested without hardware) |
| mDNS discovery         | ✔                          | ✔          | ✖        | ✔                      | ✔ (mediated by the Gladys core)   |
| Pairing from the UI    | ✔                          | ✔          | n/a      | ✖                      | ✔                                 |
| Fade time              | ✔                          | ✖          | ?        | ✔                      | ✔                                 |
| Tunable white / colour | ✔                          | ✖          | ?        | ✖                      | ✔ (milestone 7)                   |
| Shades + tilt          | ✔                          | tilt only  | ✔        | ✔                      | ✔                                 |
| Fan                    | ✔                          | ✖          | ✔        | ✔                      | ✔                                 |
| Occupancy              | groups                     | ✔          | RA2 only | groups                 | groups                            |
| Pico press / release   | ✔                          | ✔          | ✔        | ✔                      | ✔                                 |
| Double / long press    | native only (rare)         | ✔ software | hold     | native (if programmed) | ✔ native + software, configurable |
| Keypad LEDs            | ✔                          | ✖          | ?        | ✔                      | ✔ (milestone 7)                   |
| Scenes                 | Caséta                     | ✖          | ✔        | ✔                      | ✔ Caséta + RA3/QSX                |
| Smart Away             | ✔                          | ✖          | ✖        | ✖                      | ✔                                 |
| Battery                | shades (low)               | ✖          | ✖        | ✖                      | shades (low)                      |
| Watchdog + resync      | ping; stale-state bug open | ✔          | n/a      | 5 min heartbeat        | ✔ ping + periodic state re-read   |
| Diagnostics            | ✔                          | logs       | ✖        | ✖                      | ✔                                 |

## 5. Gladys Assistant

### What exists

- **No Lutron integration**, no issue or pull request mentioning Lutron on
  [GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/issues?q=lutron).
- [Forum 10385](https://community.gladysassistant.com/t/10385) (2026-07-27,
  updated 2026-10-09): Lutron Caséta ranked among the popular Home Assistant
  integrations (2.4 % of installs), "the biggest North-American gap", with
  `lutron-leap` suggested. We diverge on that library for the reasons of §2;
  worth saying on the forum when the integration is announced.
- An AI-generated **Matterbridge** plugin for Lutron
  ([factory issue #36](https://github.com/GladysAssistant/matterbridge-ai-plugin-factory/issues/36))
  was never tested; the factory repository was archived on 2026-08-03.
- Gladys handles Matter since 4.58, and Matterbridge since 4.68, but Lutron
  devices do not speak Matter: nothing duplicates a native integration.

### External integration contract (spec + SDK 0.14.0)

Source of truth:
[`docs/specs/external-integrations`](https://github.com/GladysAssistant/Gladys/tree/master/docs/specs/external-integrations)
on Gladys master, the
[store schema](https://github.com/GladysAssistant/integration-store) and
the [SDK](https://github.com/GladysAssistant/integration-sdk-js) (0.14.0,
2026-09-21, latest). Gladys core is 5.1.4.

- **Sandbox**: bridge network `gladys-integrations`, read-only rootfs, all
  capabilities dropped, 256 MB RAM, 0.5 CPU, 100 PIDs, only `/data`
  writable (plus a 64 MB `/tmp`). **Unicast to the LAN works; multicast,
  broadcast and mDNS never reach the container.**
- **mDNS** is only possible through **mediated discovery**: declare
  `network_discovery: [{ "type": "mdns", "service": "_lutron._tcp" }]`
  and call `scanNetwork('mdns', { timeoutSeconds })`. The core captures the
  answers on the host network. On demand only (one active scan per 10 s).
  A manual IP must stay possible.
- **`/data` is not in the Gladys backups**. The spec advises persisting what
  matters with `setConfig` keys outside `config_schema` (hidden storage).
- **Rate limits**: 300 states/min, 300 scene events/min, command
  acknowledgement within **5 s** (never retried by the core), 15 s for a
  widget answer.
- **Selector**: `GLADYS_INTEGRATION_SELECTOR` is `ext-<owner>-<repo>` and is
  the prefix of every device `external_id` (§7).
- **Transports** are labels only: declare `["local"]` (the forum asks every
  integration to declare it).
- `gladys_version` must be `>=5.1.0` for widgets and scene triggers/actions;
  5.1.0 had an update bug fixed in 5.1.1, so target `>=5.1.1`.
- Unreleased on SDK master (do not rely on them before a release):
  `publishChangedStates` (it deduplicates, so it would **drop a second
  identical click**: never use it for buttons), `DEVICE_POLL_FREQUENCIES`,
  `parseMdnsTxt`, `@gladysassistant/integration-sdk/testing`.

### Gladys device features available

| Lutron thing              | Gladys category / type                                               | Notes                                                                   |
| ------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Dimmer                    | `light` / `binary` + `brightness`                                    | No transition in the feature model → global default fade + scene action |
| Tunable white             | `light` / `temperature` (`unit: kelvin`)                             | Range from `WhiteTuningLevelRange`                                      |
| Colour (Ketra, Lumaris)   | `light` / `color` (integer RGB)                                      | Converted to LEAP HSV                                                   |
| Switch, plug, PowPak, CCO | `switch` / `binary`                                                  |                                                                         |
| Shade, drape              | `shutter` or `curtain` / `state` (`COVER_STATE` 1/0/-1) + `position` | **No tilt type** in Gladys                                              |
| Fan                       | `fan` / `percent` (step 25)                                          | `FAN_MODE` has no MediumHigh; percent maps the 4 speeds exactly         |
| Pico / keypad button      | `button` / `click` (`BUTTON_STATUS`)                                 | CLICK 1, DOUBLE_CLICK 2, LONG_CLICK_PRESS 3, LONG_CLICK_RELEASE 4…      |
| Scene (Caséta, RA3/QSX)   | `button` / `push`                                                    | A push button in the UI and a device action in scenes                   |
| Occupancy group           | `presence-sensor` / `binary`                                         | No occupancy category; presence fits "the room is occupied"             |
| Shade battery             | `battery-low` / `binary`                                             | Good/Low only, no percentage exists in LEAP                             |
| Smart Away                | `switch` / `binary` on the bridge device                             |                                                                         |
| Keypad LED (RA3/QSX)      | `switch` / `binary`                                                  |                                                                         |

### What Gladys already does (no duplicate)

The core scene trigger **"device state"** (`device.new-state`) fires on every
published state, including identical repeated values, with operators
`=, !=, >, <…`. For `button` features, the scene editor lists the
`BUTTON_STATUS` values. So:

- **Pico clicks, double clicks and long presses are features, not custom
  scene triggers.** A "button pressed" trigger would duplicate the core.
- Occupancy, shade battery low, Smart Away: features too, no trigger.
- Lights, shades, fans, scenes: controlled by the core "control a device"
  action and by the dashboard boxes. Custom scene actions only for what the
  feature model cannot express (fade time, tilt).
- The core dashboard already renders lights, shades and buttons. A widget
  must bring something the device boxes cannot show.
- A `device` integration has no notification API: notifications are the
  user's scenes, fed by the features above.

## 6. Must have vs nice to have

**Must have** (the Home Assistant level, plus its gaps):

1. mDNS discovery (mediated) + manual IP; pairing from the Gladys UI by
   pressing the bridge button; clear errors ("button not pressed in time",
   "certificate refused", "bridge unreachable").
2. A robust connection: 60 s ping watchdog, reconnection with backoff,
   **full reload and re-subscription after every reconnection**, periodic
   re-read of the states against the silent stale subscription, a long
   configuration load timeout, per-device transport badges.
3. Dimmers (fade), switches, shades (position, stop, tilt-only blinds,
   open/close/stop), fans (four speeds), occupancy groups, Caséta scenes,
   Smart Away, shade battery. Unknown device types and button numbers are
   logged and skipped, never fatal.
4. Picos as Gladys button devices with readable names per model, and
   **click, double click and long press** usable directly in the core scene
   trigger.
5. Stable identifiers (serial number, project-scoped fallback), Lutron area
   shown in the device name or room suggestion.

**Nice to have**: RA3/QSX keypads with LEDs and engravings, area scenes,
tunable white and colour, warm dim, a `filterPico`-like option, device type
exclusion, diagnostics export, several bridges.

**Pitfalls to document for users**: LEAP is undocumented and firmware may
change it; occupancy is per group and its timeout is set on the sensor;
Picos report no battery level; jumbo frames can break pairing; the original
(non-LEAP) Smart Bridge is not supported; native hold and multi-tap depend
on the system.

## 7. Repository name

Recommendation: **rename `gladys-Lutron-caseta` to `gladys-lutron`, before
the first release.**

- LEAP is shared by Caséta, RA2 Select, RadioRA 3 and HomeWorks QSX: the
  integration is "Lutron", Caséta is one product line of it (Home Assistant's
  `lutron_caseta` also drives RA3 and QSX, a frequent source of confusion
  with its separate `lutron` RadioRA 2 integration).
- Consistency with `gladys-frigate`, `gladys-ecoflow`: all lower case, brand
  only. The Docker image becomes `ghcr.io/lm1lc3n7/gladys-lutron`.
- **It must happen before any install**: the selector
  `ext-<owner>-<repo>` prefixes every device `external_id`. Renaming the
  repository after users created devices would orphan all of them (new
  identifiers, scenes and dashboards to redo).
- Manifest name: "Lutron" (3 to 30 characters), with Caséta, RA2 Select,
  RadioRA 3 and HomeWorks QSX in the description and the docs.

## Sources

- Gladys: [external integrations spec](https://github.com/GladysAssistant/Gladys/tree/master/docs/specs/external-integrations),
  [developer docs](https://gladysassistant.com/docs/dev/external-integrations/),
  [integration store](https://github.com/GladysAssistant/integration-store),
  [SDK](https://github.com/GladysAssistant/integration-sdk-js),
  [template](https://github.com/GladysAssistant/integration-template-js),
  [5.1 widgets and scenes](https://gladysassistant.com/blog/gladys-5-1-integration-widgets-and-scenes/),
  forum topics [10385](https://community.gladysassistant.com/t/10385),
  [10987](https://community.gladysassistant.com/t/10987),
  [10990](https://community.gladysassistant.com/t/10990),
  [10890](https://community.gladysassistant.com/t/10890).
- Libraries: [lutron-leap-js](https://github.com/thenewwazoo/lutron-leap-js),
  [pylutron-caseta](https://github.com/gurumitts/pylutron-caseta),
  [mkellsy/leap-client](https://github.com/mkellsy/leap-client),
  [homebridge-lutron](https://github.com/homebridge-plugins/homebridge-lutron).
- Home Assistant: [lutron_caseta docs](https://www.home-assistant.io/integrations/lutron_caseta/),
  [source](https://github.com/home-assistant/core/tree/dev/homeassistant/components/lutron_caseta),
  [lutron docs](https://www.home-assistant.io/integrations/lutron/), issues
  and forum threads linked above.
- Others: [openHAB Lutron binding](https://github.com/openhab/openhab-addons/blob/main/bundles/org.openhab.binding.lutron/README.md),
  [Hubitat Lutron Integrator](https://hubitat.com/home-automation/lutron-integrator),
  [Homey Lutron Caséta](https://homey.app/en-us/app/com.casetawireless/Lutron-Caseta/).

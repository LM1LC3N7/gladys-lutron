# TODO — Lutron integration v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone (tick the boxes, move decisions in).
The research behind every choice is in [AUDIT.md](./AUDIT.md).

## Working method (same as gladys-frigate and gladys-ecoflow)

- One milestone at a time, **one commit per milestone**, tests green before
  moving on. Present a short plan before coding a milestone; ask blocking
  questions instead of assuming.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm audit`, then check and update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md`, `CLAUDE.md` and this file.
- CI: if **every** job fails in under 2 seconds, the GitHub Actions quota is
  exhausted — do not change the code, tell the maintainer. Push at most once
  a day unless the maintainer asks otherwise.
- Code, comments, README in English; user docs in English and French.

## Status

- [x] **Milestone 0 — audit and plan** (this file, [AUDIT.md](./AUDIT.md))
- [x] Answers to the open questions (2026-10-09, see "Answers" below)
- [x] **Milestone 1 — scaffold, manifest, store validation, CI**
- [x] **Milestone 2 — LEAP client: connection, framing, watchdog**
- [x] **Milestone 3 — pairing, discovery, configuration UX**
- [x] **Milestone 4 — Caséta / RA2 Select model, devices, states, commands**
- [x] **Milestone 5 — Pico remotes and buttons (click, double, long)**
- [x] **Milestone 6 — scene actions, scene triggers, dashboard widget →
      release 0.1.0**
- [x] **Milestone 7 — RadioRA 3 / HomeWorks QSX, keypads, LEDs, colour →
      release 0.2.0**
- [x] **Milestone 8 — hardening, diagnostics, forum announcement**

## Answers of the maintainer (2026-10-09)

1. **Repository renamed** to `LM1LC3N7/gladys-lutron`, default branch `main`.
   Image: `ghcr.io/lm1lc3n7/gladys-lutron`.
2. **Hardware**: Caséta Diva starter kit DVRF-BDG-1D-C (Caséta Smart Hub,
   Diva smart dimmer, Pico remote, Canadian version) and a second Diva smart
   dimmer (DVRF-6L). **Priority on this hardware**, without leaving aside the
   other Lutron devices common in Home Assistant setups (shades, fans,
   switches, other Picos, occupancy sensors, RA3/QSX later). Legacy systems
   (telnet LIP, the original non-LEAP Smart Bridge) are out for now.
3. **Everything local**, from the configuration to the pairing and the daily
   use: no Lutron account, no cloud, no Internet needed by the integration.
   The public LAP pairing certificate and key are therefore bundled (copied
   from pylutron-caseta, Apache-2.0, credited in `NOTICE`): pairing is
   impossible without them. Only adding devices to the bridge needs the
   Lutron app (Lutron's own setup, outside Gladys); documented.
4. **Pairing credentials in hidden config keys**: confirmed by the spec
   (`host-api-endpoints.md`, `POST /config`: "keys outside the schema are the
   integration's free internal storage, never displayed in the UI"), stored
   in the Gladys database, so in its backups. `/data` holds nothing.
5. **One bridge in v1** (proposal kept).
6. **Button mode configurable** in the form (`button_detection`: Instant /
   Normal / Slow, default Normal), each mode explained in the field
   description in English and French.

## Decisions

| Topic         | Decision                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Targets       | Gladys `>=5.1.1` (widgets and scene triggers need 5.1; 5.1.0 had an update bug). SDK `@gladysassistant/integration-sdk` `^0.14.0`. Caséta standard and PRO, RA2 Select first; RA3 and QSX in milestone 7. The original non-LEAP Smart Bridge (L-BDG) is out.                                                                                                                    |
| Protocol      | LEAP only (TLS 8081, pairing 8083). No telnet / LIP.                                                                                                                                                                                                                                                                                                                            |
| Library       | **In-house LEAP client, zero runtime dependency** besides the SDK, ported from pylutron-caseta (Apache-2.0, attribution in `NOTICE`). `lutron-leap` is GPL-3.0 and has the defects listed in AUDIT.md §2: reference only, never imported or copied.                                                                                                                             |
| Layering      | `src/leap/` never imports the Gladys SDK nor `src/gladys/` (ESLint rule, as in gladys-frigate); `src/gladys/` is a thin adapter; `index.js` only wires.                                                                                                                                                                                                                         |
| TLS           | Bridge certificate verified against the CA received at pairing (`lutron-root` for RA3/QSX), `minVersion: TLSv1.2`, no host-name check (the bridge certificate has none), IPv4. A refused certificate is an explicit status, never a silent retry loop.                                                                                                                          |
| Discovery     | Manifest `network_discovery: [{ "type": "mdns", "service": "_lutron._tcp" }]`; `scanNetwork('mdns')` when pairing without a host, and to find the bridge again when its IP changes (matched by serial number). Manual IP always possible.                                                                                                                                       |
| Connection    | Ping `/server/1/status/ping` every 60 s, 10 s timeout, socket destroyed on failure; reconnection backoff 2 s → 60 s; **full reload and re-subscription after every reconnection**; zone states re-read every 15 min against the silent stale subscription (HA #128541); configuration load timeout 60 s; request timeout 4 s (Gladys acknowledgement: 5 s).                     |
| Identifiers   | `externalIds(type, platformId)` with the Lutron serial number; zones without their own serial: `<bridge serial>-zone-<id>`; scenes: `<bridge serial>-scene-<id>`. Frozen once released.                                                                                                                                                                                         |
| Buttons       | One Gladys device per Pico or keypad, one `button`/`click` feature per physical button, named per model (On, Off, Raise, Lower, Favorite, Button 1…). Values `BUTTON_STATUS`: `CLICK`, `DOUBLE_CLICK`, `LONG_CLICK_PRESS`, `LONG_CLICK_RELEASE`, declared in `supported_options`. Always `publishState` (never a deduplicating publisher): two identical clicks are two events. |
| No duplicates | No custom scene trigger for button presses, occupancy, battery or Smart Away: they are features, and the core "device state" trigger already covers them. No custom scene action for on/off, level, position, scene activation: the core "control a device" action covers them.                                                                                                 |
| Fade          | Config `default_fade_seconds` (0 = the device's own fade) for every level command; scene action `set_level_with_fade` for a per-scene fade.                                                                                                                                                                                                                                     |
| Tilt          | Tilt-only blinds (Serena wood): the `position` feature drives the tilt. Shades with lift and tilt: `position` = lift, tilt through the scene action `set_tilt` (Gladys has no tilt feature type).                                                                                                                                                                               |
| Fan           | `fan`/`percent`, step 25: 0 Off, 25 Low, 50 Medium, 75 MediumHigh, 100 High (`FAN_MODE` has no MediumHigh).                                                                                                                                                                                                                                                                     |
| Rate limits   | States batched (≤ 100 per call) and kept under 250/min; a full resync is spread when the project is large. Scene events ≤ 300/min, never fired in reaction to our own command.                                                                                                                                                                                                  |
| Out of v1     | Several bridges (milestone 8 if requested), occupancy sensor settings (set on the sensor), Pico battery (not in LEAP), telnet LIP, Matter, firmware updates, timeclocks.                                                                                                                                                                                                        |

## Milestone 1 — scaffold, manifest, store validation, CI (done)

Done as planned, from the gladys-frigate / gladys-ecoflow setup:
`package.json` (runtime dependency: the SDK only), ESLint with the layering
rule on `src/leap/`, Prettier, `Dockerfile` (`node:24-alpine`, `dumb-init`,
`USER node`, `/data`), CI (`ci.yml`: format, lint, tests with coverage on
Node 22 and 24, runtime audit, store validator with `--skip-image-check`,
Docker build; `build.yml` / `release.yml` for the multi-arch GHCR image;
Dependabot for npm, Docker and Actions), the complete v1 manifest, frozen
keys (`src/gladys/keys.js`, pinned by `test/manifest.test.js`),
`src/config.js`, `docs/en.md` / `docs/fr.md`, `cover.png`, `LICENSE`,
`NOTICE`, `CHANGELOG.md`. `index.js` answers every declared surface with
"not available yet" until its milestone lands.

Notes:

- `npx github:GladysAssistant/integration-store` could not install in the
  development container (an `@aws-sdk` version missing from its npm mirror);
  the same validator run from a clone of the store
  (`node src/validate-cli.js <dir> --skip-image-check`) passes: only the
  expected warnings (image not published, cover not on `main` yet).
- The base image is not pinned by digest yet: Dependabot's docker ecosystem
  proposes the updates.

### Manifest (published in milestone 1)

Configuration (`config_schema`):

| Key                    | Type    | Notes                                                                                                                                       |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `bridge_section`       | section | Steps: leave the IP empty to search the network, press "Pair the bridge", then the small black button at the back of the bridge within 60 s |
| `bridge_host`          | string  | Optional IPv4; filled in by the pairing when the bridge is found by mDNS                                                                    |
| `options_section`      | section |                                                                                                                                             |
| `default_fade_seconds` | number  | 0–60, default 0 (the device's fade)                                                                                                         |
| `button_detection`     | select  | `instant` / `normal` / `relaxed`, default `normal` (question 6)                                                                             |

Hidden keys (written by the integration, question 4): `leap_key`,
`leap_cert`, `leap_ca`, `bridge_serial`, `bridge_type`.

Configuration actions: `pair_bridge` (timeout 120 s), `test_connection`,
`refresh_devices` (reload the Lutron project, refresh the Discover tab),
`forget_bridge` (delete the credentials), `diagnostics` (sanitized model
dump in the logs, used for fixtures and support).

Scene triggers: `bridge_offline`, `bridge_online` (variables: `reason`,
`offline_seconds`); `area_scene_activated` in milestone 7 (fields `area`,
`scene`; RA3/QSX only).

Scene actions: `set_level_with_fade` (device, level 0–100, fade seconds),
`set_tilt` (device, tilt 0–100); `press_keypad_button` in milestone 7
(device, button).

Widget: `lutron_overview` (see milestone 6).

## Milestone 2 — LEAP client (`src/leap/`, no Gladys import) (done)

- `framing.js`: JSON lines with a UTF-8 `StringDecoder` (accents split
  across chunks), 4 MB cap, malformed lines skipped, `parseStatus`,
  `idFromHref`.
- `errors.js`: `BridgeUnreachableError`, `CertificateRefusedError`
  (`refusedBy: bridge | integration`), `InvalidCredentialsError`,
  `LeapTimeoutError`, `LeapStatusError`, `LeapClosedError`,
  `BridgeClosedEarlyError`.
- `connection.js`: TLS 1.2+ with the pairing credentials, chain verified
  against the pairing authority (host-name check only skipped), `ClientTag`
  correlation, timed-out requests forgotten, `204` = null body, paging
  followed and merged, tagged subscriptions, untagged messages emitted as
  `unsolicited`, throwing handlers isolated.
- `session.js`: ping every 60 s (10 s timeout), backoff 2 s → 60 s,
  `onReady(connection)` after every (re)connection with a 90 s timeout and a
  close-and-retry on failure, no retry on a certificate problem until
  `reconnectNow()`, `restart()`, `stop()` that never waits for a model load.
- Tests: a fake LEAP bridge over TLS (`test/helpers/fakeBridge.js`, test
  certificates in `test/fixtures/tls/`).

Findings to check on real hardware (milestone 3/4):

- Node's TLS server closes the socket instead of sending a TLS alert when it
  refuses a client certificate; a real bridge (OpenSSL) should send an alert
  (`ERR_SSL_*_ALERT_*`), classified as "the bridge refused our certificate".
  If it closes silently instead, the session reports
  `BridgeClosedEarlyError` ("closed right after accepting"), and the status
  suggests pairing again.
- Unsolicited messages received while the model loads are not forwarded
  (the model is not ready); the zone states are read explicitly at the end
  of the load, and again every 15 minutes (milestone 4).

## Milestone 3 — pairing, discovery, configuration UX (done)

- `src/leap/csr.js`: RSA-2048 key + PKCS#10 SHA-256 request with
  `node:crypto` only, verified by `openssl req -verify` in the tests.
- `src/leap/assets.js`: LAP CA, certificate and key, `lutron-root`, copied
  verbatim from pylutron-caseta (commit `c0dcc22`, 2026-10-05), checked
  (fingerprints `38:C7:E9:46…` and `DC:16:E4:7F…`, key matching the
  certificate).
- `src/leap/pairing.js`: port 8083 with the LAP certificate (TLS 1.2),
  LAP authority first then `lutron-root` (processor), wait for the
  `PhysicalAccess` status, `/pair` CSR, signed certificate, check by a ping
  on 8081. Typed errors `PairingTimeoutError`, `PairingRefusedError`.
- `src/leap/discovery.js`: raw answers of the core mDNS scan →
  `{ host, serial (hex), systype, family }`; `src/leap/bridgeInfo.js`:
  `/project` (Caséta vs RA3 vs QSX) and the bridge device (name, model,
  serial in hex, firmware).
- `src/gladys/bridgeController.js`: configuration → session, actions
  `pair_bridge` (mDNS search when no IP: none / several / one),
  `test_connection` (ping or immediate reconnection), `forget_bridge`,
  `refresh_devices` (reconnect and reload); credentials stored as hidden
  config keys (verified in the Gladys sources: the form save only writes
  `config_schema` keys and the front end never receives the others); the
  bridge serial saved on the first connection; a bridge that changed IP is
  found again by its serial (after 3 failed reconnections, at most every
  5 minutes) and followed.
- `src/gladys/messages.js`: every status and action result says what is
  wrong and what to do, in English and French.
- `index.js`: wired; `LUTRON_LEAP_PORT` / `LUTRON_PAIRING_PORT` move the
  ports for development (the TLS checks stay on).
- Tests: fake pairing server, controller against the fake bridge, end to
  end (`test/index.e2e.test.js`: the real `index.js` against a fake Gladys
  and a fake bridge).

To check on the maintainer's hardware (Caséta Smart Hub, Diva, Pico):

- [ ] mDNS answer of the bridge: host name `Lutron-<hex>.local`, `SYSTYPE`
      value, and whether the Gladys core relays it (`scanNetwork`).
- [x] Pairing end to end, then the status "Connected to … LEAP x.y"
      (2026-10-15, Caséta Smart Hub: everything works; the overview widget
      said "Not paired yet" until a restart, fixed: it reads the pairing from
      the bridge controller, the core echoes no config update for the
      integration's own `setConfig`).
- [ ] What a bridge does with a certificate it no longer knows (reset
      bridge): TLS alert or silent close (see milestone 2 findings).

## Diagnostics action (done, ahead of milestone 4, at the maintainer's request)

- `src/leap/anonymize.js`: serial numbers → stable pseudonyms
  (`serial-1`…), MAC / IP / bridge host names / positions masked,
  credential-like keys redacted; LEAP durations (`00:00:02`) untouched.
- `src/leap/diagnostics.js`: read-only crawl (≤ 300 requests, ≤ 70 s):
  Caséta / RA2 Select (`/project`, `/area`, `/device`, `/button`,
  `/buttongroup`, `/zone`, `/virtualbutton`, `/occupancygroup` + status,
  Smart Away, every zone status, battery of shades and sensors) or RA3 /
  QSX (zones and area status, per area control stations, zones and scenes,
  button groups of keypads and Picos); each endpoint's outcome recorded
  (`ok`, `status`, `timeout`, `error`); log lines between
  `LUTRON DIAGNOSTICS BEGIN` / `END`, one per collection item.
- `bridgeController.diagnostics()`: header (versions, pairing, session
  state, bridge info anonymized), works offline (state only).
- Next: the maintainer's dump becomes the milestone 4 fixtures
  (`test/fixtures/`), after a last manual check of the names.

## Milestone 4 — Caséta / RA2 Select model, devices, states, commands (done)

- `src/leap/deviceTypes.js`: Lutron DeviceType / zone ControlType → kind
  (dimmer, white tune, spectrum, switch, CCO, fan, shade, drape, lift+tilt,
  tilt-only, open/close/stop, remote, keypad, occupancy sensor), from
  pylutron-caseta's lists, plus suffix rules for new models (`…Shade`,
  `…Drape`, `Pico…`, `…Keypad`). Unknown → null, logged once, skipped.
- `src/leap/model.js`: `/area`, `/device` (required), `/virtualbutton`,
  `/occupancygroup`, `/system/away/1/status`, `/device/{id}/status` of the
  battery powered devices (optional: a 404 or a silent endpoint is skipped).
  Zones named "<Area> <Name>".
- `src/leap/status.js`: zone, button, occupancy, area, Smart Away, LED and
  battery bodies → plain values; `src/leap/commands.js`: LEAP command bodies
  (`GoToLevel`, `GoToDimmedLevel` with `FadeTime`, white / spectrum tuning,
  `GoToCCOLevel`, `GoToFanSpeed`, `GoToTilt`, `Raise` / `Lower` / `Stop`,
  `PressAndRelease`).
- `src/leap/system.js`: `attach(connection)` from the session `onReady`:
  model, subscriptions (occupancy, Smart Away), every zone status read, then
  the events (`model`, `zone`, `occupancy`, `smartAway`, `battery`,
  `offline`); messages routed by their body (tagged or not); states received
  while loading are applied, emitted after the model; resync every 15 min
  (zones, occupancy, Smart Away, batteries). Commands: the answer's status is
  applied at once; "on" restores the last level above 0.
- `src/gladys/devices.js`: catalog (Discover tab) and index feature → target.
  External ids: zone `<device serial>` (or `<bridge serial>-zone-<id>` when
  the serial is missing or not unique: pylutron's fixtures have duplicates),
  occupancy `<bridge serial>-<group id>`, scene `<bridge serial>-scene-<id>`,
  bridge `<bridge serial>` (Smart Away). Params `LUTRON_AREA`, `LUTRON_TYPE`,
  `LUTRON_MODEL`, `GLADYS_TRANSPORT`.
- `src/gladys/states.js`: only created features, deduplicated, ≤ 100 per
  request, ≤ 250 per minute (the rest waits), a failed batch republished
  with the next change, replay when a device is created; button events
  published at once, never deduplicated.
- `src/gladys/commands.js`: on/off, brightness, switch, fan, position (tilt
  for tilt-only blinds), open/close/stop (`Raise`/`Lower`/`Stop`, or tilt
  50/0), Smart Away, scene; optimistic position after `Raise`/`Lower`.
- `src/gladys/availability.js`: transport badges and the offline / online
  detection (used by the scene triggers of milestone 6).
- `src/gladys/integration.js`: the wiring; the Discover tab is published
  after every model load (so "Refresh the devices" refreshes it).
- Fixtures: pylutron-caseta's test responses (`test/fixtures/pylutron/`,
  Apache-2.0) served by `test/helpers/pylutronBridge.js`.

Still to check on the maintainer's bridge: the unsolicited zone statuses
after a command and a Pico press (no explicit subscription on Caséta, like
pylutron-caseta), `MessageBodyType` values, the battery answer of a sensor.

## Milestone 5 — Pico remotes and buttons (done)

- `src/leap/picoModels.js`: button numbers → names for Pico 2B, 2B
  raise/lower, 3B, 3B raise/lower, 4B, 4B scene, 4B zone, 4B 2-group,
  paddle Pico and the shade 4-group remote (25 buttons), after Home
  Assistant's tables (Apache-2.0); otherwise the LEAP name, then
  "Button n".
- `src/leap/buttonTracker.js`: pure, tested on a manual clock. Press arms
  the long press (350 ms normal / 750 ms relaxed, +250 ms on raise/lower);
  Release before it opens the double-click window (300 / 450 ms); a second
  Press in the window = double click at once; native `MultiTap` = double,
  `LongHold` = long press; a lost Release is closed by the next Press;
  `instant` = click on Press only. Mode change, reconnection and model
  reload forget the presses in progress.
- Caséta model: button devices (`ButtonGroups` + `/button`); system:
  `/button/{id}/status/event` subscribed after every reconnection, events
  dropped while the model loads.
- Gladys: one `remote` device per Pico (external id: its serial, or
  `<bridge serial>-device-<id>`), one read-only `button`/`click` feature per
  button (`button-<number>`, `supported_options` 1–4), every press published
  at once with `publishState` (never deduplicated). The last 8 presses are
  kept for the widget.
- Docs: example scenes per press type, why raise/lower long presses wait.

Still to check on the maintainer's Pico: the event sequence of a real
press (Press / Release only on Caséta?), and the timings in practice.

## Milestone 6 — scene actions, triggers, widget (done)

- `src/gladys/sceneActions.js`: `set_level_with_fade` (lights only, level
  0–100, fade 0–4 h, default 2 s) and `set_tilt` (lift+tilt and tilt-only
  blinds); a device that cannot do it, an unknown device, a missing value
  or an offline bridge are refused with a message saying why.
- `src/gladys/availability.js` (milestone 4) drives `bridge_offline`
  (`bridge_name`, `reason`) and `bridge_online` (`bridge_name`,
  `offline_seconds`): one event per transition, after 2 minutes without a
  working connection, never before the first connection nor after a
  deliberate stop (forget, new address, shutdown).
- `src/gladys/widget.js`, `lutron_overview` built from memory (answers at
  once even offline): caption (bridge, LEAP version); status (bridge,
  Smart Away, devices, occupied rooms, low batteries); card list of the
  last 8 presses; buttons Smart Away on/off (widget actions, so it works
  without the bridge device created) and "Reconnect" while offline. The
  core is nudged (`requestWidgetRefresh`) on presses, occupancy, Smart Away
  and connection changes. Content checked with the SDK's
  `validateWidgetContent`.
- Rejected on purpose: per-room light or shade controls (core room box).
- Docs `en`/`fr`: scenes, widget, "good to know" (AUDIT.md §6 pitfalls).

Release: run the **Release** workflow (minor) from GitHub Actions once the
maintainer has validated the integration on their hardware; it bumps
`package.json` and the manifest, turns "Unreleased" into the version and
publishes the image. Add the `gladys-assistant-integration` topic to the
repository.

## Milestone 7 — RadioRA 3 / HomeWorks QSX (done, testers wanted)

- `src/leap/processorModel.js`: per area `associatedzone` (kind from the
  `ControlType`, `WhiteTuningLevelRange`), `associatedcontrolstation` →
  keypads and Picos (`buttongroup/expanded`, `/device/{id}`): engraving
  first, then the Pico table, then the LEAP name; LED of each key;
  `areascene` (any collection of `/areascene/` items); occupancy per area
  from the sensors of `/device?where=IsThisDevice:false`; `/device` never
  read (204 on QSX). "Device 1" style names become "Keypad 1".
- `src/leap/system.js`: `loadModel` picks Caséta or processor from
  `/project`; processors subscribe `/zone/status` (one read for every zone),
  `/area/status` (occupancy, active scene), every `/led/{id}/status`; resync
  reads them again. Events `led`, `areaScene` (a change after the load, not
  within 5 s of our own press in that area). Commands `setKelvin` (kept in
  the zone range), `setColor` (RGB → HSV), `setWarmDim`, `setLed`,
  `pressButton` (refused on Caséta: pylutron-caseta #96).
- `src/leap/color.js`: RGB ↔ hue / saturation.
- Gladys: white tune → `light/temperature` (kelvin, range of the zone) and a
  "Warm dim" switch; spectrum (Ketra, Lumaris RGB+TW) → also `light/color`;
  keypads → `button/click` per key plus `switch/binary` per LED
  (`led-<number>`); scene action `press_keypad_button` (device, engraving
  or number); scene trigger `area_scene_activated` (fields and variables
  `area`, `scene`: Lutron names).
- **Deviation from the plan**: area scenes are not published as
  `button`/`push` features. No source confirms the LEAP request activating
  an area scene, and a button that does nothing is worse than none; a
  keypad key runs the same scene (`press_keypad_button`). To revisit with a
  tester's Diagnostics export.
- Tests on pylutron-caseta's RA3 and QSX responses
  (`processorRoutes()` in `test/helpers/pylutronBridge.js`).

To check with testers: native `MultiTap` / `LongHold` (QSX sends
`LongHold`; openHAB says RA3 sends them when programmed in Designer), the
`areascene` answer, LED changes made by Gladys being overridden by the
programming, battery answers of RA3 sensors.

## Milestone 8 — hardening (done)

- `test/longrun.test.js`: 25 reconnections with a full model reload each
  and a resync every 15 ms: no growing timers, listeners, connections or
  pending requests; states still flow at the end.
- Option `hidden_device_types` (multi-select: lights, switches, shades,
  fans, remotes, occupancy, scenes, Smart Away): left out of the Discover
  tab only; created devices keep their states and commands; changing it
  republishes the list.
- A button press is never replayed when a device is created (it would fire
  the scenes again).
- Independent review of milestones 4–8, fixed with regression tests:
  "Refresh the devices" left the system "ready" on a closed connection
  (`session.restart()` removed every close listener); two state requests
  could be in flight at once and land in the wrong order (one flush at a
  time now); a slow `/button` (or any part of the project) answer gave a
  partial model for the whole session (retried once with 10 s, then the
  load fails and is retried; same for timed-out subscriptions); our own
  keypad press could fire `area_scene_activated` for another room (5 s
  suppression is global now); a forget during an outage still reported it
  (availability reset on every deliberate stop); subscriptions run 10 at a
  time for big processors.
- Store validator run from a clone of `GladysAssistant/integration-store`:
  passes (warnings: image not published yet, cover not on `main` yet).
- Several bridges: not requested (question 5), stays out; documented
  ("one bridge per Gladys for now").
- Forum announcement drafted in French: `docs/forum-announcement.fr.md`
  (to post in topic 10385 once 0.1.0 is published and checked).

## Next (after the hardware checks)

- [ ] Maintainer: pair the Caséta Smart Hub, create the devices, try the
      Diva dimmers and the Pico (click, double, long), send the Diagnostics
      export; turn it into `test/fixtures/` and fix what differs.
- [ ] Run the **Release** workflow (minor → 0.1.0), add the repository topic
      `gladys-assistant-integration`, post the announcement.
- [ ] RA3 / QSX testers: area scene activation, `MultiTap` / `LongHold`,
      LED behaviour, sensor batteries (see milestone 7).
- [ ] Docker Hub rate limits: `build.yml` / `release.yml` still pull from
      Docker Hub (the CI build uses `mirror.gcr.io`).

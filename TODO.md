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
- [ ] **Milestone 4 — Caséta / RA2 Select model, devices, states, commands**
- [ ] **Milestone 5 — Pico remotes and buttons (click, double, long)**
- [ ] **Milestone 6 — scene actions, scene triggers, dashboard widget →
      release 0.1.0**
- [ ] **Milestone 7 — RadioRA 3 / HomeWorks QSX, keypads, LEDs, colour →
      release 0.2.0**
- [ ] **Milestone 8 — hardening, diagnostics, forum announcement**

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
- [ ] Pairing end to end, then the status "Connected to … LEAP x.y".
- [ ] What a bridge does with a certificate it no longer knows (reset
      bridge): TLS alert or silent close (see milestone 2 findings).

## Milestone 4 — Caséta / RA2 Select model, devices, states, commands

- [ ] `src/leap/model.js`: `/project`, `/area`, `/device`, `/button`,
      `/virtualbutton`, `/occupancygroup`, zone statuses, the bridge device,
      Smart Away, shade battery; normalized model (areas, zones with type,
      button groups, occupancy groups, scenes). Unknown types logged once and
      skipped, never fatal.
- [ ] `src/leap/deviceTypes.js`: Lutron device type → kind (dimmer, switch,
      shade, tilt blind, open/close/stop cover, fan, CCO, Pico, keypad,
      sensor), from pylutron-caseta's lists.
- [ ] `src/gladys/devices.js`: Discover tab. Device name "<Area> <Name>"
      (the Lutron area as a hint for the Gladys room). Features: see
      AUDIT.md §5 table. Bridge device: Smart Away switch.
- [ ] `src/gladys/states.js`: zone status → states (dimmer level → binary +
      brightness; shade level → position; fan speed → percent; switched
      level → binary; occupancy → presence; battery → battery-low), batched,
      deduplicated except buttons, only for created devices.
- [ ] `src/gladys/commands.js`: `onSetValue` → LEAP command, answer within
      5 s, last non-zero level remembered for "on", optimistic position for
      `Raise` / `Lower` (no immediate status), scene `push` →
      `PressAndRelease`.
- [ ] Transport badges (`local` / `unreachable`), zone states re-read
      every 15 min and after every reconnection.
- [ ] Action `diagnostics` (sanitized: no certificate, key or serial in
      clear), and `refresh_devices`.
- [ ] Fixtures: anonymized dump of the maintainer's bridge (question 2),
      plus the response files of pylutron-caseta's tests (Apache-2.0) for
      the device types we do not own.

## Milestone 5 — Pico remotes and buttons

- [ ] `src/leap/picoModels.js`: button numbers → names per model (Pico 2B,
      2B raise/lower, 3B, 3B raise/lower, 4B, 4B scene, 4B zone, 4B 2-group,
      shade 4-group remote, paddle Pico), generic "Button n" for unknown
      ones (never fatal, HA #184579).
- [ ] `src/leap/buttonTracker.js`, per button, pure and tested with fake
      timers:
  - `Press` → arm the long-press timer (350 ms normal, 750 ms relaxed,
    +250 ms on raise/lower buttons);
  - long-press timer fires → `LONG_CLICK_PRESS`; next `Release` →
    `LONG_CLICK_RELEASE`;
  - `Release` before it → a second release within the double-click window
    (300 ms normal, 450 ms relaxed) → `DOUBLE_CLICK`, otherwise `CLICK`
    when the window ends;
  - native `MultiTap` → `DOUBLE_CLICK`, native `LongHold` →
    `LONG_CLICK_PRESS`, without waiting;
  - `instant` mode: `CLICK` on `Press`, nothing else.
- [ ] Subscription per button (`/button/{id}/status/event`) restored after
      every reconnection; button events ignored while the model reloads.
- [ ] Docs: one example scene per press type with the core "device state"
      trigger; why the raise/lower long press is delayed.

## Milestone 6 — scene actions, triggers, widget → release 0.1.0

- [ ] Scene actions `set_level_with_fade` and `set_tilt` (refused with a
      clear message on a device that cannot do it).
- [ ] Scene triggers `bridge_offline` / `bridge_online`: one event per
      transition, after the reconnection attempts of the first 2 minutes
      (no flapping), never during the start-up.
- [ ] Widget `lutron_overview` (≤ 8 components, answered within 15 s even
      when the bridge is down):
  - caption: bridge model, connection, LEAP version;
  - status list: connection, Smart Away, devices, occupied areas, shades
    with a low battery;
  - card list: the last button presses (remote, button, press type, time),
    which no core box shows;
  - buttons: Smart Away on/off (bound to the bridge feature), "Reconnect"
    while offline.
- [ ] Widget rejected on purpose: per-area light or shade controls (the
      core room box already does it).
- [ ] Docs `en`/`fr` complete (pairing, discovery, Docker networks, button
      modes, examples, pitfalls of AUDIT.md §6), CHANGELOG, release 0.1.0,
      repository topic `gladys-assistant-integration`.

## Milestone 7 — RadioRA 3 / HomeWorks QSX → release 0.2.0

- [ ] Model per area: control stations, keypads (`buttongroup/expanded`,
      engravings as button names), zones (`associatedzone`, `ControlType`),
      area scenes (`areascene` → presets), occupancy through `/area/status`,
      processor through `IsThisDevice`; `/project` `ProductType` picks the
      path; `204` on `/device` handled (QSX).
- [ ] Keypad LEDs as `switch`/`binary` (+ the LED auto-off gotcha in the
      docs); area scenes as `button`/`push`; scene action
      `press_keypad_button`; scene trigger `area_scene_activated`
      (`CurrentScene` of `/area/status`).
- [ ] Tunable white (`light`/`temperature` in kelvin), colour
      (`light`/`color` ↔ HSV), warm dim (also Caséta Lumaris tape light).
- [ ] Native `MultiTap` / `LongHold` checked (QSX sends `LongHold`; openHAB
      says RA3 sends them when programmed in Designer).
- [ ] Testers wanted on the forum (no hardware here, question 2).

## Milestone 8 — hardening

- [ ] Long-run test against a fake bridge (memory, timers, reconnections).
- [ ] Several bridges if requested (question 5).
- [ ] Option to hide device types; forum announcement in the thread of
      [topic 10385](https://community.gladysassistant.com/t/10385),
      explaining why `lutron-leap` was not used.

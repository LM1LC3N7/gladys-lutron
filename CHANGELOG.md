# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- The answer of "Pair the bridge" no longer leaves a 10-second timer running once the bridge is connected.

## [0.1.2] - 2026-10-15

### Fixed

- The "Lutron overview" widget said "Not paired yet" after a successful
  pairing (and "paired" after "Forget the bridge") until the integration
  restarted: Gladys sends no configuration update back for the integration's
  own writes, so the widget now reads the pairing from the bridge controller.
  Seen on the maintainer's Caséta Smart Hub. The bridge serial used in the
  device ids comes from the same place, so it no longer depends on a restart
  after pairing (only when the bridge does not report its serial).

## [0.1.1] - 2026-10-13

### Changed

- Shared tooling of the LM1LC3N7 Gladys integrations: CI on Node 22 and 24 with `npm audit`, Release workflow driven by this changelog, GitHub Releases from its sections, grouped Dependabot updates.
- Gladys integration SDK 0.15: poll-frequency and batch validation of the discovered devices, state heartbeat, the SDK fake Gladys for the tests.

## [0.1.0] - 2026-10-10

### Added

- Audit of the LEAP libraries and of the existing Lutron integrations
  (`AUDIT.md`) and the v1 plan (`TODO.md`).
- Project scaffold: manifest (configuration, actions, scene triggers and
  actions, widget, mDNS discovery), Docker image, CI, store documentation in
  English and French, cover image.
- In-house LEAP client, without any runtime dependency: TLS connection
  checking the bridge certificate, request correlation, subscriptions,
  paging, keep-alive ping every minute, reconnection with backoff and full
  reload after every reconnection, explicit errors (bridge unreachable,
  certificate refused, invalid pairing).
- Local pairing from the configuration screen: the bridge is searched on the
  network (mDNS scan run by Gladys) when no IP address is typed, then paired
  by pressing its button; the certificate it signs is kept in the Gladys
  configuration. Actions "Test the connection", "Forget the bridge" and
  "Refresh the devices"; connection status in English and French saying what
  is wrong and what to do; a bridge that changed IP address is found again by
  its serial number.
- "Diagnostics" action: a read-only, anonymized dump of the Lutron system
  (rooms, devices, buttons, scenes, levels; Caséta / RA2 Select and RA3 /
  QSX) written to the integration logs between `LUTRON DIAGNOSTICS BEGIN`
  and `LUTRON DIAGNOSTICS END`, one line per item. Serial numbers become
  stable pseudonyms; MAC and IP addresses and positions are masked.
- Devices: dimmers, switches and plug-in modules, relays (CCO), fans (four
  speeds), shades, drapes, tilt-only blinds, open/close/stop covers,
  occupancy groups, Lutron scenes and Smart Away, published to the Discover
  tab with the Lutron room in their name; shade and sensor batteries.
  States follow the bridge in real time and are read again every 15 minutes
  and after every reconnection; only the devices created in Gladys get
  states, deduplicated, batched and kept under the Gladys rate limit.
  Commands from Gladys ("on" restores the last level, the default fade time
  applies to every level). Transport badges ("local" / "unreachable").
- Pico remotes and the shade 4-group remote as Gladys button devices, with
  the button names of each model; click, double click, long press and its
  release, usable in the core "device state" trigger. Detection mode
  Instant / Normal / Slow from the configuration; raise / lower buttons wait
  a little longer before a long press.
- Scene actions "Lutron: set a level with a fade" (up to 4 hours) and
  "Lutron: tilt the slats"; scene triggers "Lutron: bridge offline" (after
  2 minutes without answer) and "Lutron: bridge back online".
- Dashboard widget "Lutron overview": bridge and connection, Smart Away,
  devices, occupied rooms, low batteries, the last Pico presses, and
  buttons for Smart Away and reconnection.
- RadioRA 3 and HomeWorks QSX processors (testers wanted): zones per room,
  keypads with their engravings and LEDs, Picos, occupancy per room, tunable
  white and colour lights (Ketra, Lumaris) with colour temperature, colour
  and warm dimming. Scene action "Lutron: press a keypad button" and scene
  trigger "Lutron: room scene activated".
- Option "Hide from the Discover tab" per device type.
- Long-run test of reconnections (no leaked timers, listeners or
  connections); a button press is never replayed on device creation.

[Unreleased]: https://github.com/LM1LC3N7/gladys-lutron/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-lutron/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-lutron/compare/v0.1.0...v0.1.1

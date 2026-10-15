# CLAUDE.md

Lutron (Caséta, RA2 Select, RadioRA 3, HomeWorks QSX) external integration
for Gladys Assistant over the local LEAP protocol (Docker container, JS SDK).
Read **[TODO.md](./TODO.md) first**: status, decisions and the plan of the
next milestones. The research behind them is in [AUDIT.md](./AUDIT.md).

## Rules

- Node.js >= 20.18.1 at runtime (the image ships 24), JavaScript ESM with
  JSDoc, no TypeScript build.
- Layering: `src/leap/` never imports the Gladys SDK nor `src/gladys/`
  (ESLint enforces it); `src/gladys/` is a thin adapter, tied together by
  `src/gladys/integration.js`; `index.js` only registers the handlers.
- `src/leap/system.js` owns the live state (model, zone states, buttons,
  LEDs, occupancy) and emits events; the Gladys side never talks LEAP.
  Every command goes through it and rejects with `BridgeOfflineError` while
  not ready.
- Runtime dependencies: `@gladysassistant/integration-sdk` only. The LEAP
  client is in-house (`node:tls`, `node:crypto`). Never import or copy
  `lutron-leap` (GPL-3.0); pylutron-caseta (Apache-2.0) is the reference,
  credited in `NOTICE`. Ask before adding a dependency.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the LAN only; mDNS only through the
  core's `scanNetwork`).
- Gladys limits: 300 states/min, 300 scene events/min, command
  acknowledgement within 5 s, widget answer within 15 s.
- Never log a private key, certificate, serial number in clear or any
  secret config value.
- The pairing lives in the bridge controller (`bridge.config`): the core
  pushes no config update back for the integration's own `setConfig`, so
  the `config` of `src/gladys/integration.js` keeps the startup values until
  a restart or a save from the UI. Read the credentials, the bridge host and
  serial from `bridge.config`.
- Button presses are `button`/`click` features published with
  `publishState` on every press (never deduplicated, never replayed); other
  states go through `src/gladys/states.js` (created features only,
  deduplicated, ≤ 250/min). No custom scene
  trigger or action that duplicates a core one (see TODO.md "No duplicates").
- Scene trigger / action / config action keys in `src/gladys/keys.js` are
  frozen once released: never rename or remove one. Same for device
  external ids.
- Code, comments and README in English; `docs/en.md` and `docs/fr.md`
  (>= 300 characters, required by the store).

## Workflow

- One milestone at a time, a short plan first, blocking questions asked
  rather than assumed, one commit per milestone with green tests.
- Before committing, run the checks below, then update README, docs,
  CHANGELOG, CLAUDE.md and TODO.md:
  `npm run format:check && npm run lint && npm test && npm audit`
- CI failing on every job in under 2 seconds = Actions quota exhausted, not a
  bug: report it, do not change the code. Push at most once a day unless
  asked.
- Store check: `npm run validate:manifest`. If `npx` cannot install the
  validator (npm mirror lag), run `node src/validate-cli.js <repo>
--skip-image-check` from a clone of `GladysAssistant/integration-store`.
- Tests talk to `test/helpers/fakeBridge.js` (LEAP over TLS with the test
  certificates of `test/fixtures/tls/`; `pylutronBridge.js` serves
  pylutron-caseta's Caséta, RA3 and QSX answers), `fakeGladys.js` (wire) or
  `memoryGladys.js` (in-process, with `helpers/integration.js`); never to a
  real bridge. A behaviour seen on real hardware becomes a fixture from the
  maintainer's Diagnostics export.

// -----------------------------------------------------------------------------
// Consistency between `gladys-assistant-integration.json` and the code. The
// store validator checks the manifest itself (`npm run validate:manifest`);
// these tests pin what the validator cannot know.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { DEFAULTS, MAX_FADE_SECONDS } from '../src/config.js';
import {
  BUTTON_DETECTION,
  CONFIG_KEYS,
  MANIFEST_ACTIONS,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  STORAGE_KEYS,
  WIDGETS,
} from '../src/gladys/keys.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('package.json'));
const index = await read('index.js');
const valueFields = manifest.config_schema.filter((f) => f.type !== 'section');
const field = (key) => valueFields.find((f) => f.key === key);

test('the manifest requires Gladys 5.1.1+ (widgets, scene triggers; 5.1.0 update bug)', () => {
  assert.equal(manifest.gladys_version, '>=5.1.1');
});

test('the manifest version and image tag follow package.json', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-lutron:${pkg.version}`);
});

test('the integration is local only and discovers the bridge through the core mDNS scan', () => {
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.network_discovery, [{ type: 'mdns', service: '_lutron._tcp' }]);
});

test('config fields match the code, with the same defaults', () => {
  assert.deepEqual(valueFields.map((f) => f.key).sort(), Object.values(CONFIG_KEYS).sort());
  assert.equal(field(CONFIG_KEYS.BUTTON_DETECTION).default, DEFAULTS.buttonDetection);
  assert.deepEqual(
    field(CONFIG_KEYS.BUTTON_DETECTION).options.map((o) => o.value),
    Object.values(BUTTON_DETECTION),
  );
  const fade = field(CONFIG_KEYS.DEFAULT_FADE_SECONDS);
  assert.equal(fade.default, DEFAULTS.defaultFadeSeconds);
  assert.equal(fade.max, MAX_FADE_SECONDS);
});

test('every button mode is explained to the user in both languages', () => {
  const { description } = field(CONFIG_KEYS.BUTTON_DETECTION);
  const words = { en: ['Instant', 'Normal', 'Slow'], fr: ['Instantané', 'Normal', 'Lent'] };
  for (const [lang, labels] of Object.entries(words)) {
    for (const label of labels) assert.match(description[lang], new RegExp(`${label} ?:`), label);
  }
});

test('the pairing credentials are internal storage, never form fields', () => {
  const formKeys = manifest.config_schema.map((f) => f.key);
  for (const key of Object.values(STORAGE_KEYS)) assert.ok(!formKeys.includes(key), key);
});

test('pairing leaves time for the user to reach the bridge button', () => {
  const pair = manifest.actions.find((a) => a.key === MANIFEST_ACTIONS.PAIR_BRIDGE);
  assert.ok(pair.timeout_seconds >= 90);
});

// Published keys are stored in the users' scenes and dashboards: never rename
// or remove one. Extending these lists is fine.
test('scene trigger keys are frozen', () => {
  assert.deepEqual(Object.values(SCENE_TRIGGERS), ['bridge_offline', 'bridge_online']);
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key),
    Object.values(SCENE_TRIGGERS),
  );
});

test('scene action keys are frozen', () => {
  assert.deepEqual(Object.values(SCENE_ACTIONS), ['set_level_with_fade', 'set_tilt']);
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key),
    Object.values(SCENE_ACTIONS),
  );
});

test('widget keys are frozen', () => {
  assert.deepEqual(Object.values(WIDGETS), ['lutron_overview']);
  assert.deepEqual(
    manifest.widgets.map((w) => w.key),
    Object.values(WIDGETS),
  );
});

test('manifest action keys match the code', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(MANIFEST_ACTIONS),
  );
});

test('no custom trigger duplicates the core "device state" trigger', () => {
  // Button presses, occupancy, battery and Smart Away are device features.
  for (const trigger of manifest.scene_triggers) {
    assert.doesNotMatch(trigger.key, /button|press|occupan|battery|away/, trigger.key);
  }
});

test('every manifest action, scene action and widget has a handler in index.js', () => {
  for (const name of Object.keys(MANIFEST_ACTIONS)) {
    assert.match(index, new RegExp(`onAction\\(\\s*MANIFEST_ACTIONS\\.${name}\\b`), name);
  }
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.match(index, new RegExp(`onSceneAction\\(\\s*SCENE_ACTIONS\\.${name}\\b`), name);
  }
  for (const name of Object.keys(WIDGETS)) {
    assert.match(index, new RegExp(`onWidgetGet\\(\\s*WIDGETS\\.${name}\\b`), name);
  }
});

test('index.js always answers a scan (else the Discover tab spins for minutes)', () => {
  assert.match(index, /gladys\.onScanRequest\(/);
});

test('the store documentation exists in English and French (>= 300 characters)', async () => {
  for (const lang of ['en', 'fr']) {
    assert.ok((await read(`docs/${lang}.md`)).length >= 300, lang);
  }
});

test('the cover image is a PNG under 150 KB, 800x534', async () => {
  const cover = await readFile(new URL('../cover.png', import.meta.url));
  assert.ok((await stat(new URL('../cover.png', import.meta.url))).size <= 150 * 1024);
  assert.equal(cover.toString('ascii', 1, 4), 'PNG');
  assert.equal(cover.readUInt32BE(16), 800);
  assert.equal(cover.readUInt32BE(20), 534);
});

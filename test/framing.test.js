import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineDecoder, encodeMessage, idFromHref, parseStatus } from '../src/leap/framing.js';

const collect = (options = {}) => {
  const messages = [];
  const errors = [];
  const decoder = createLineDecoder({
    onMessage: (m) => messages.push(m),
    onError: (e, line) => errors.push({ message: e.message, line }),
    ...options,
  });
  return { decoder, messages, errors };
};

test('messages are JSON lines terminated by CRLF', () => {
  assert.equal(encodeMessage({ a: 1 }), '{"a":1}\r\n');
});

test('a message split in arbitrary chunks is rebuilt, accents included', () => {
  const { decoder, messages } = collect();
  const bytes = Buffer.from(
    encodeMessage({ Name: 'Salle à manger — été' }) + encodeMessage({ b: 2 }),
  );
  for (let i = 0; i < bytes.length; i += 1) decoder.push(bytes.subarray(i, i + 1));
  assert.deepEqual(messages, [{ Name: 'Salle à manger — été' }, { b: 2 }]);
});

test('LF-only lines, blank lines and a last line without newline are handled', () => {
  const { decoder, messages } = collect();
  decoder.push('{"a":1}\n\r\n\n{"b":2}');
  decoder.end();
  assert.deepEqual(messages, [{ a: 1 }, { b: 2 }]);
});

test('a malformed line or a non-object is skipped and reported', () => {
  const { decoder, messages, errors } = collect();
  decoder.push('not json\r\n[1,2]\r\n{"ok":true}\r\n');
  assert.deepEqual(messages, [{ ok: true }]);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].line, 'not json');
});

test('a line over the cap is a fatal error, nothing more is parsed', () => {
  const { decoder, messages, errors } = collect({ maxLineBytes: 16 });
  decoder.push('{"a":"0123456789abcdef"');
  decoder.push('}\r\n{"b":1}\r\n');
  assert.deepEqual(messages, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, undefined);
});

test('status strings are split like pylutron-caseta does', () => {
  assert.deepEqual(parseStatus('200 OK'), { code: 200, text: 'OK' });
  assert.deepEqual(parseStatus('204 NoContent'), { code: 204, text: 'NoContent' });
  assert.deepEqual(parseStatus('weird'), { code: null, text: 'weird' });
  assert.deepEqual(parseStatus(undefined), { code: null, text: '' });
});

test('ids are taken from any href', () => {
  assert.equal(idFromHref('/zone/12/status'), '12');
  assert.equal(idFromHref('/button/105'), '105');
  assert.equal(idFromHref('/occupancygroup/2/status'), '2');
  assert.equal(idFromHref('/server/status/ping'), null);
  assert.equal(idFromHref(null), null);
});

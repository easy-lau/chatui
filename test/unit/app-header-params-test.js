#!/usr/bin/env node
const assert = require('assert');
const {
  normalizeHeaderParamConfig,
  generateShortUuid,
  buildRequestHeadersFromParams,
} = require('../../client/app/header-params');

assert.deepStrictEqual(
  normalizeHeaderParamConfig([
    { name: ' X-Trace ', mode: 'manual', value: 123 },
    { name: '', mode: 'manual', value: 'drop' },
    { name: 'X-Session', mode: 'session_short_uuid', value: 'ignored' },
    { name: 'X-Invalid', mode: 'bad', value: 'v' },
  ]),
  [
    { name: 'X-Trace', mode: 'manual', value: '123' },
    { name: 'X-Session', mode: 'session_short_uuid', value: 'ignored' },
    { name: 'X-Invalid', mode: 'manual', value: 'v' },
  ],
);
assert.deepStrictEqual(normalizeHeaderParamConfig(null), []);

assert.strictEqual(generateShortUuid(() => [0, 1, 2, 10, 15, 16, 255, 254]), '0001020a0f10');
assert.strictEqual(generateShortUuid(null, () => 36, () => 0.5).length <= 12, true);

const sessionValues = { 'X-Keep': 'keep-id' };
const result = buildRequestHeadersFromParams({
  params: [
    { name: 'X-Manual', mode: 'manual', value: 'manual-value' },
    { name: 'X-Keep', mode: 'session_short_uuid', value: '' },
    { name: 'X-New', mode: 'session_short_uuid', value: '' },
    { name: 'X-Msg', mode: 'message_short_uuid', value: '' },
    { name: 'X-Empty', mode: 'manual', value: '' },
  ],
  sessionValues,
  sessionUuid: () => 'session-id',
  messageUuid: () => 'message-id',
});
assert.deepStrictEqual(result.headers, {
  'X-Manual': 'manual-value',
  'X-Keep': 'keep-id',
  'X-New': 'session-id',
  'X-Msg': 'message-id',
});
assert.strictEqual(result.changed, true);
assert.strictEqual(sessionValues['X-New'], 'session-id');

const unchanged = buildRequestHeadersFromParams({
  params: [{ name: 'X-Keep', mode: 'session_short_uuid', value: '' }],
  sessionValues,
  sessionUuid: () => 'new-id',
});
assert.deepStrictEqual(unchanged.headers, { 'X-Keep': 'keep-id' });
assert.strictEqual(unchanged.changed, false);

console.log('app header params ok');

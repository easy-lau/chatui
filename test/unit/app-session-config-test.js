#!/usr/bin/env node
const assert = require('assert');
const {
  getEffectiveImageStylePrompt,
  getSessionChatModel,
  sessionChatModelValue,
  sessionModelOptions,
  normalizeSessionChatModel,
} = require('../../client/app/session-config');

assert.strictEqual(getEffectiveImageStylePrompt({ session: null, config: { imageStylePrompt: ' 水彩 ' } }), '水彩');
assert.strictEqual(getEffectiveImageStylePrompt({ session: { hasImageStylePromptOverride: true, imageStylePrompt: ' 赛博朋克 ' }, config: { imageStylePrompt: '水彩' } }), '赛博朋克');
assert.strictEqual(getEffectiveImageStylePrompt({ session: { hasImageStylePromptOverride: true, imageStylePrompt: '' }, config: { imageStylePrompt: '水彩' } }), '');
assert.strictEqual(getEffectiveImageStylePrompt({ session: { hasImageStylePromptOverride: false, imageStylePrompt: '赛博朋克' }, config: { imageStylePrompt: '水彩' } }), '水彩');

assert.strictEqual(getSessionChatModel({ session: { chatModel: 'local' }, config: { chatModel: 'global' }, models: ['local'] }), 'local');
assert.strictEqual(getSessionChatModel({ session: { chatModel: 'missing' }, config: { chatModel: 'global' }, models: ['local'] }), 'global');
assert.strictEqual(sessionChatModelValue({ chatModel: 'local' }, ['local']), 'local');
assert.strictEqual(sessionChatModelValue({ chatModel: 'missing' }, ['local']), '');
assert.strictEqual(normalizeSessionChatModel('local', ['local']), 'local');
assert.strictEqual(normalizeSessionChatModel('missing', ['local']), '');

assert.deepStrictEqual(
  sessionModelOptions({ models: ['a', 'b', 'a', 'img'], globalChatModel: 'global', isAllowed: model => model !== 'img' }),
  [
    { value: '', label: '跟随全局 · global' },
    { value: 'a', label: 'a' },
    { value: 'b', label: 'b' },
  ],
);
assert.deepStrictEqual(sessionModelOptions({ models: [], globalChatModel: '' }), [{ value: '', label: '跟随全局' }]);

console.log('app session config ok');

#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const browserCorePath = path.join(root, 'client/core/browser.js');
const browserCore = fs.readFileSync(browserCorePath, 'utf8');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(browserCore, context, { filename: browserCorePath });

const core = context.window.ChatUICore;
assert.ok(core, 'browser core namespace exists');
assert.ok(core.http?.normalizeError, 'http helpers are exported');
assert.ok(core.reasoning?.extractStreamDelta, 'reasoning helpers are exported');
assert.ok(core.models?.extractModels, 'model helpers are exported');
assert.ok(core.imageReferences?.makeImageReferenceId, 'image reference helpers are exported');
assert.ok(core.imageRouteContext?.buildRouteContext, 'image route context helpers are exported');
assert.ok(core.attachments?.isImageFile, 'attachment helpers are exported');

assert.strictEqual(core.http.normalizeError(null, { error: { code: 'X' } }), 'X');
assert.strictEqual(core.reasoning.extractStreamDelta({ choices: [{ delta: { content: 'hi', reasoning_content: 'why' } }] }).reasoning, 'why');
assert.strictEqual(core.models.normalizeModelType('gpt-image'), 'image');
assert.strictEqual(core.models.inferModelType({ id: 'text-embedding-3-large' }), 'embedding');
assert.strictEqual(JSON.stringify(core.models.extractModels({ data: [{ id: 'b', type: 'chat' }, { id: 'a', type: 'image' }] }).models), '["a","b"]');
assert.strictEqual(core.attachments.isImageFile({ name: 'a.png', type: '' }), true);
assert.strictEqual(core.attachments.isCompressibleRasterImage({ name: 'a.svg', type: 'image/svg+xml' }), false);
assert.strictEqual(core.imageReferences.makeImageReferenceId('display 1'), 'imgref_display_1');
assert.strictEqual(core.imageReferences.makeImageItemId('latest', 2), 'img_imgref_latest_2');

const refs = core.imageRouteContext.collectRecentImageReferences({
  display: [{ id: 'd1', role: 'assistant', rawText: '一只猫', html: '<img data-persisted-src="indexeddb://x" data-filename="x.png" />' }],
});
assert.strictEqual(refs.length, 1);
assert.strictEqual(refs[0].reference_id, 'imgref_d1');
assert.strictEqual(refs[0].candidates[0].image_id, 'img_imgref_d1_1');
assert.strictEqual(
  core.imageRouteContext.routeContextSize(core.imageRouteContext.buildRouteContext({
    messages: Array.from({ length: 200 }, (_, i) => ({ role: 'user', content: 'x'.repeat(2000) + i })),
    maxChars: 262144,
  })) <= 262144,
  true,
);

console.log('browser core bundle ok');

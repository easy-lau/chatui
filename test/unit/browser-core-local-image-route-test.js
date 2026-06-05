#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const context = { window: {}, console };
context.window.window = context.window;
vm.createContext(context);
for (const file of [
  'client/core/http.js',
  'client/core/reasoning.js',
  'client/core/models.js',
  'client/core/image-references.js',
  'client/core/image-route-context.js',
  'client/core/attachments.js',
  'client/core/browser.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const routeContext = context.window.ChatUICore.imageRouteContext;
assert.strictEqual(typeof routeContext.normalizeRoute, 'function');
assert.strictEqual(typeof routeContext.buildRouteContext, 'function');
assert.strictEqual(routeContext.inferLocalImageRoute, undefined, 'browser core must not expose local keyword route fallback');
assert.strictEqual(context.window.ChatUICoreImageRouteContext.inferLocalImageRoute, undefined, 'legacy browser namespace must not expose local keyword route fallback');
console.log('browser core route context no local fallback ok');

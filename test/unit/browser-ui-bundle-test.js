#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const browserUiPath = path.join(root, 'client/ui/browser.js');
const browserUi = fs.readFileSync(browserUiPath, 'utf8');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(browserUi, context, { filename: browserUiPath });

assert.ok(context.window.ChatUI, 'browser ui namespace exists');
assert.ok(context.window.ChatUI.fileActions?.answerFilename, 'file actions are exported');
assert.ok(context.window.ChatUI.realtime?.createRealtimeRenderer, 'realtime renderer is exported');
assert.ok(context.window.ChatUI.scroll?.activeOutputBottomTarget, 'scroll helpers are exported');
assert.ok(context.window.ChatUI.messages?.renderUserMessageParts, 'message helpers are exported');
assert.ok(context.window.ChatUI.actions?.copyText, 'message actions are exported');
assert.ok(context.window.ChatUI.imageActions?.downloadImageButtonHtml, 'image download helper is exported');
assert.ok(context.window.ChatUI.imageActions?.shareImageButtonHtml, 'image share helper is exported');
assert.ok(context.window.ChatUI.imageActions?.copyImageButtonHtml, 'image copy helper is exported');

const copyHtml = context.window.ChatUI.imageActions.copyImageButtonHtml('indexeddb://img1', 'a.png', value => String(value).replace(/&/g, '&amp;'));
assert.ok(copyHtml.includes('data-copy-image="1"'));
assert.ok(copyHtml.includes('data-persisted-href="indexeddb://img1"'));
assert.ok(copyHtml.includes('data-filename="a.png"'));
assert.ok(copyHtml.includes('aria-label="复制图片"'));

console.log('browser ui bundle ok');

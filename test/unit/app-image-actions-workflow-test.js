#!/usr/bin/env node
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { createImageActionsWorkflow } = require('../../client/app/image-actions-workflow');

const dom = new JSDOM('<!doctype html><body><div class="message assistant"><div class="content"><img class="generated-thumb" data-persisted-src="indexeddb://one" data-filename="one.png"><button class="generated-image-actions"></button></div><div class="msg-actions"><button class="copy-btn"></button><button class="refresh-btn"></button></div></div></body>');
const { document } = dom.window;
let previewed = null;
let busy = false;
let restored = false;
const workflow = createImageActionsWorkflow({
  document,
  window: { ChatUI: { imageActions: {
    downloadImageButtonHtml: () => '<button data-download-image="1">下载图片</button>',
    shareImageButtonHtml: () => '<button data-share-image="1">分享图片</button>',
    copyImageButtonHtml: () => '<button data-copy-image="1">复制图片</button>',
    imageActionButtonsHtml: () => '<button data-download-image="1">下载图片</button>',
  } }, isSecureContext: false },
  navigator: {},
  ClipboardItem: function ClipboardItem() {},
  File: function File() {},
  Image: function Image() {},
  URL: { createObjectURL: () => 'blob://one', revokeObjectURL: () => {} },
  fetch: async () => ({ ok: true, blob: async () => ({}) }),
  getImageBlob: async key => key === 'one' ? { type: 'image/png' } : null,
  toast: () => {},
  resetActionButtonState: () => {},
  markActionButtonBusy: () => { busy = true; },
  restoreActionButtonSoon: () => { restored = true; },
  openImagePreview: src => { previewed = src; },
  escapeAttr: text => String(text),
});

const message = document.querySelector('.message');
workflow.moveImageActionsToMessageActions(message);
assert.ok(!message.querySelector('.copy-btn'));
assert.ok(message.querySelector('[data-download-all-images]'));
assert.ok(!message.querySelector('.generated-image-actions'));
workflow.bindImagePreview(message);
document.querySelector('img').onclick();
assert.strictEqual(previewed, 'indexeddb://one');
assert.strictEqual(workflow.canWriteImageClipboard(), false);
(async () => {
  const actionButton = document.createElement('button');
  actionButton.dataset.persistedHref = 'indexeddb://one';
  const blob = await workflow.getImageActionBlob(actionButton);
  assert.deepStrictEqual(blob, { type: 'image/png' });
  await workflow.downloadAllImagesFromMessage(message);
  assert.strictEqual(busy, true);
  assert.strictEqual(restored, true);
  console.log('app image actions workflow ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

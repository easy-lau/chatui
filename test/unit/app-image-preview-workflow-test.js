#!/usr/bin/env node
const assert = require('assert');
const { createImagePreviewWorkflow } = require('../../client/app/image-preview-workflow');

const elements = new Map();
function makeElement(id) {
  return {
    id,
    dataset: {},
    hidden: true,
    disabled: false,
    title: '',
    src: '',
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      toggle(value, force) { force ? this.add(value) : this.remove(value); },
      contains(value) { return this.values.has(value); },
    },
    setAttribute(name, value) { this[name] = value; },
  };
}
['imagePreviewCopy', 'imagePreviewImg', 'imagePreviewDownload', 'imagePreview'].forEach(id => elements.set(id, makeElement(id)));
const revoked = [];
const workflow = createImagePreviewWorkflow({
  getElement: id => elements.get(id),
  getImageBlob: async key => key === 'one' ? { type: 'image/png' } : null,
  canWriteImageClipboard: () => true,
  imageClipboardUnsupportedMessage: () => 'unsupported',
  URL: {
    createObjectURL: () => 'blob://one',
    revokeObjectURL: url => revoked.push(url),
  },
});

workflow.updateImagePreviewCopyAvailability();
assert.strictEqual(elements.get('imagePreviewCopy').disabled, false);
assert.strictEqual(elements.get('imagePreviewCopy').title, '复制图片');

(async () => {
  const resolved = await workflow.resolvePreviewSrc('indexeddb://one');
  assert.deepStrictEqual(resolved, { src: 'blob://one', owned: true });
  await workflow.openImagePreview('indexeddb://one', 'one.png');
  assert.strictEqual(elements.get('imagePreviewImg').src, 'blob://one');
  assert.strictEqual(elements.get('imagePreviewImg').dataset.persistedSrc, 'indexeddb://one');
  assert.strictEqual(elements.get('imagePreviewDownload').hidden, false);
  assert.strictEqual(elements.get('imagePreviewCopy').hidden, false);
  assert.ok(elements.get('imagePreview').classList.contains('show'));
  workflow.closeImagePreview();
  assert.deepStrictEqual(revoked, ['blob://one']);
  assert.strictEqual(elements.get('imagePreviewImg').src, '');
  assert.strictEqual(elements.get('imagePreviewCopy').hidden, true);
  assert.ok(!elements.get('imagePreview').classList.contains('show'));
  console.log('app image preview workflow ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

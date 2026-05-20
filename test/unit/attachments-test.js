#!/usr/bin/env node
const assert = require('assert');
const {
  isImageFile,
  isCompressibleRasterImage,
  formatBytes,
  normalizeImageContextForStorage,
  parseImageContext,
  makeImageReferenceId,
  parseImageReferenceId,
  makeImageItemId,
  normalizeSelectedImageIds,
  resolveImageSelectionFromIds,
  normalizeImageSelection,
  getLatestImageReferenceTarget,
  buildRouteAttachmentMetadata,
} = require('../../client/core/attachments');

assert.strictEqual(isImageFile({ type: 'image/png' }), true);
assert.strictEqual(isImageFile({ name: 'a.webp' }), true);
assert.strictEqual(isImageFile({ name: 'a.pdf' }), false);
assert.strictEqual(isCompressibleRasterImage({ type: 'image/gif' }), false);
assert.strictEqual(isCompressibleRasterImage({ name: 'a.jpg' }), true);
assert.strictEqual(formatBytes(512), '512 B');
assert.strictEqual(formatBytes(2048), '2.0 KB');
assert.strictEqual(formatBytes(3 * 1024 * 1024), '3.0 MB');
assert.strictEqual(makeImageReferenceId('display 1'), 'imgref_display_1');
assert.strictEqual(makeImageReferenceId('imgref_latest'), 'imgref_latest');
assert.strictEqual(parseImageReferenceId('imgref_display_1'), 'display_1');
assert.strictEqual(makeImageItemId('display 1', 2), 'img_imgref_display_1_2');
assert.deepStrictEqual(normalizeSelectedImageIds(['img_imgref_display_1_2', 'bad', 'img_imgref_display_1_2']), ['img_imgref_display_1_2']);
assert.deepStrictEqual(resolveImageSelectionFromIds(['img_imgref_display_1_2', 'img_imgref_other_1'], 'display 1', 3), [2]);
assert.deepStrictEqual(normalizeImageSelection({ imageIndex: '2' }, 3), [2]);
assert.deepStrictEqual(normalizeImageContextForStorage({ mode: 'edit_image', usePreviousImage: true, selectedReferenceId: 'imgref_display_1', selectedIndexes: ['2'], selectedImageIds: ['img_imgref_display_1_2'], attachments: [{ name: 'a.png', type: 'image/png', size: '10', persistedSrc: 'indexeddb://x', imageId: 'img_imgref_display_1_2', referenceId: 'imgref_display_1', sourceIndex: 2 }] }), {
  mode: 'edit_image',
  target: '',
  prompt: '',
  usePreviousImage: true,
  updatedAt: null,
  imageCount: 1,
  referenceId: '',
  selectedReferenceId: 'imgref_display_1',
  selectedIndexes: [2],
  selectedImageIds: ['img_imgref_display_1_2'],
  attachments: [{ name: 'a.png', type: 'image/png', size: 10, src: 'indexeddb://x', imageId: 'img_imgref_display_1_2', referenceId: 'imgref_display_1', sourceIndex: 2 }],
});
assert.strictEqual(parseImageContext('{bad'), null);
assert.strictEqual(parseImageContext('{"attachments":[{"src":"x"}]}').attachments[0].src, 'x');
const latestPrevious = getLatestImageReferenceTarget({
  display: [
    { role: 'user', imageContext: JSON.stringify({ target: 'uploaded', attachments: [{ src: 'indexeddb://uploaded' }] }) },
    { role: 'assistant', html: '<img class=\"generated-thumb\" />' },
  ],
  lastGeneratedImage: { images: [{ src: 'indexeddb://generated-1' }, { src: 'indexeddb://generated-2' }] },
});
assert.strictEqual(latestPrevious.target, 'previous');
assert.strictEqual(latestPrevious.count, 2);
assert.strictEqual(latestPrevious.selection, 'all');
const latestUploaded = getLatestImageReferenceTarget({
  display: [{ role: 'user', imageContext: JSON.stringify({ target: 'uploaded', attachments: [{ src: 'indexeddb://uploaded-1' }, { src: 'indexeddb://uploaded-2' }] }) }],
  lastGeneratedImage: null,
});
assert.strictEqual(latestUploaded.target, 'uploaded');
assert.strictEqual(latestUploaded.count, 2);
assert.strictEqual(latestUploaded.selection, 'all');
assert.deepStrictEqual(buildRouteAttachmentMetadata([{ name: 'a.png', type: 'image/png', size: 12, dataUrl: 'data:image/png;base64,SECRET', text: 'SECRET' }]), [{ name: 'a.png', type: 'image/png', size: 12, is_image: true }]);
console.log('attachments ok');

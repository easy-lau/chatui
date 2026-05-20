#!/usr/bin/env node
const assert = require('assert');
const {
  IMAGE_REFERENCE_PREFIX,
  IMAGE_ITEM_PREFIX,
  sanitizeImageReferencePart,
  makeImageReferenceId,
  parseImageReferenceId,
  makeImageItemId,
  normalizeSelectedImageIds,
  resolveImageSelectionFromIds,
  normalizeImageSelection,
} = require('../../client/core/image-references');

assert.strictEqual(IMAGE_REFERENCE_PREFIX, 'imgref_');
assert.strictEqual(IMAGE_ITEM_PREFIX, 'img_');
assert.strictEqual(sanitizeImageReferencePart('display 1/中文'), 'display_1___');
assert.strictEqual(makeImageReferenceId('display 1'), 'imgref_display_1');
assert.strictEqual(makeImageReferenceId('imgref_latest'), 'imgref_latest');
assert.strictEqual(parseImageReferenceId(''), 'latest');
assert.strictEqual(parseImageReferenceId('imgref_display_1'), 'display_1');
assert.strictEqual(makeImageItemId('display 1', 2), 'img_imgref_display_1_2');
assert.deepStrictEqual(normalizeSelectedImageIds(['img_imgref_display_1_2', 'bad', 'img_imgref_display_1_2']), ['img_imgref_display_1_2']);
assert.deepStrictEqual(normalizeSelectedImageIds({ imageIds: ['img_imgref_display_1_1'] }), ['img_imgref_display_1_1']);
assert.deepStrictEqual(resolveImageSelectionFromIds(['img_imgref_display_1_2', 'img_imgref_other_1'], 'display 1', 3), [2]);
assert.deepStrictEqual(resolveImageSelectionFromIds(['img_imgref_display_1_4'], 'display 1', 3), []);
assert.deepStrictEqual(normalizeImageSelection({ imageIndex: '2' }, 3), [2]);
assert.deepStrictEqual(normalizeImageSelection([1, '2', 2, 4], 3), [1, 2]);
console.log('image references ok');

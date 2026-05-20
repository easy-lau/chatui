#!/usr/bin/env node
const assert = require('assert');
const {
  buildPromptWithTextAttachments,
  buildImagePromptWithStylePrompt,
  buildImageRequestPayload,
  createImageContext,
} = require('../../client/services/image-generation-service');

const isImageFile = item => /^image\//.test(item.type || '');
assert.strictEqual(buildPromptWithTextAttachments('画图', [], isImageFile), '画图');
assert.strictEqual(buildPromptWithTextAttachments('总结', [{ name: 'a.txt', text: 'hello', type: 'text/plain' }], isImageFile), '总结\n\n[附件：a.txt]\nhello');
assert.ok(buildPromptWithTextAttachments('', [{ name: 'a.bin', type: 'application/octet-stream', unsupportedReason: '不支持' }], isImageFile).includes('不支持'));
assert.strictEqual(buildImagePromptWithStylePrompt('一只猫', '赛博朋克'), '一只猫\n\n图片样式要求：\n赛博朋克');
assert.strictEqual(buildImagePromptWithStylePrompt('', '水彩'), '水彩');
assert.deepStrictEqual(buildImageRequestPayload({ model: 'img-model', prompt: 'p', size: 'auto' }), { model: 'img-model', prompt: 'p' });
assert.deepStrictEqual(buildImageRequestPayload({ model: 'img-model', prompt: 'p', size: '1024x1024' }), { model: 'img-model', prompt: 'p', size: '1024x1024' });
const context = createImageContext({
  prompt: '改图',
  mode: 'edit_image',
  target: 'previous',
  usePreviousImage: true,
  selectedReferenceId: 'imgref_display_1',
  selectedIndexes: [2],
  selectedImageIds: ['img_imgref_display_1_2'],
  attachments: [{ name: 'a.png', src: 'indexeddb://a', sourceIndex: 2 }],
  makeImageItemId: (reference, index) => `img_${reference}_${index}`,
});
assert.strictEqual(context.target, 'previous');
assert.strictEqual(context.attachments[0].referenceId, 'imgref_display_1');
assert.strictEqual(context.attachments[0].imageId, 'img_imgref_display_1_2');
console.log('image generation service ok');

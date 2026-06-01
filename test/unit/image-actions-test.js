#!/usr/bin/env node
const assert = require('assert');
const { downloadImageButtonHtml, shareImageButtonHtml, copyImageButtonHtml, imageActionButtonsHtml } = require('../../client/ui/image-actions');

assert.ok(downloadImageButtonHtml('x', 'a.png').includes('data-download-image'));
assert.ok(shareImageButtonHtml('x', 'a.png').includes('data-share-image'));
assert.ok(copyImageButtonHtml('x', 'a.png').includes('data-copy-image'));
assert.ok(copyImageButtonHtml('x', 'a.png').includes('aria-label="复制图片"'));
assert.ok(imageActionButtonsHtml('x', 'a.png').includes('data-download-image'));
assert.ok(!imageActionButtonsHtml('x', 'a.png').includes('data-copy-image'));
assert.ok(imageActionButtonsHtml('x', 'a.png').includes('data-share-image'));
console.log('image actions ok');

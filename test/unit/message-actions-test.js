#!/usr/bin/env node
const assert = require('assert');
const { copySuccessState, copyText, normalizeRenderedCopyText, messageCopyText } = require('../../client/ui/message-actions');

(async () => {
  assert.deepStrictEqual(copySuccessState('<ok>', '<old>'), { className: 'copied', html: '<ok>', restoreHtml: '<old>', timeoutMs: 900 });
  assert.strictEqual(normalizeRenderedCopyText('第一行\n\n第二行\n\n第三行'), '第一行\n第二行\n第三行');
  assert.strictEqual(normalizeRenderedCopyText('第一段\n\n第二段\n\n\n第三段'), '第一段\n\n第二段\n\n第三段');
  assert.strictEqual(messageCopyText('**原始**\n文本', '原始\n\n文本'), '原始\n文本');
  assert.strictEqual(messageCopyText('原始\n里有换行', '显示没有换行'), '显示没有换行');
  assert.strictEqual(messageCopyText('', '第一行\n\n第二行\n\n第三行'), '第一行\n第二行\n第三行');
  let copied = '';
  await copyText('hello', { writeText: async text => { copied = text; } });
  assert.strictEqual(copied, 'hello');
  console.log('message actions ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

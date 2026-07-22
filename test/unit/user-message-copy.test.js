'use strict';

const assert = require('assert');
const { JSDOM } = require('jsdom');
const messageWorkflow = require('../../client/app/message-workflow');

function makeCopyEvent(window) {
  let copied = '';
  const event = new window.Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { setData(type, text) { if (type === 'text/plain') copied = text; } },
  });
  return { event, copied: () => copied };
}

function selectContents(window, element) {
  const range = window.document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function testNativeFullUserMessageCopyUsesRawText() {
  const dom = new JSDOM('<article class="message user" data-raw-text="第一行 第二行 第三行"><div class="content"><div class="plain-text">第一行\n\n第二行\n\n第三行</div></div></article>');
  const content = dom.window.document.querySelector('.content');
  messageWorkflow.createMessageWorkflow({ state: {}, document: dom.window.document });
  selectContents(dom.window, content);

  const copy = makeCopyEvent(dom.window);
  content.dispatchEvent(copy.event);

  assert.strictEqual(copy.event.defaultPrevented, true);
  assert.strictEqual(copy.copied(), '第一行 第二行 第三行');
}

function testNativePartialUserMessageCopyRemainsNative() {
  const dom = new JSDOM('<article class="message user" data-raw-text="第一行 第二行"><div class="content"><div class="plain-text">第一行 第二行</div></div></article>');
  const content = dom.window.document.querySelector('.content');
  const text = content.querySelector('.plain-text').firstChild;
  messageWorkflow.createMessageWorkflow({ state: {}, document: dom.window.document });
  const range = dom.window.document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 3);
  const selection = dom.window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const copy = makeCopyEvent(dom.window);
  content.dispatchEvent(copy.event);

  assert.strictEqual(copy.event.defaultPrevented, false);
  assert.strictEqual(copy.copied(), '');
}

function testNativeAttachmentMessageCopyRemainsNative() {
  const dom = new JSDOM('<article class="message user" data-raw-text="请看附件"><div class="content"><div class="plain-text">请看附件</div><div class="user-attachment-preview-grid"></div></div></article>');
  const content = dom.window.document.querySelector('.content');
  messageWorkflow.createMessageWorkflow({ state: {}, document: dom.window.document });
  selectContents(dom.window, content);

  const copy = makeCopyEvent(dom.window);
  content.dispatchEvent(copy.event);

  assert.strictEqual(copy.event.defaultPrevented, false);
  assert.strictEqual(copy.copied(), '');
}

module.exports = [
  testNativeFullUserMessageCopyUsesRawText,
  testNativePartialUserMessageCopyRemainsNative,
  testNativeAttachmentMessageCopyRemainsNative,
];

#!/usr/bin/env node
const assert = require('assert');
const {
  formatElapsed,
  firstTokenTimeText,
  escapeHtml,
  escapeAttr,
  renderStreamingText,
  pendingFeedbackHtml,
  isChatStatusText,
} = require('../../client/app/formatting');

assert.strictEqual(formatElapsed(1234), '1.2s');
assert.strictEqual(formatElapsed(65000), '1m 5s');
assert.strictEqual(firstTokenTimeText(250), 'TTFT 0.3s');
assert.strictEqual(firstTokenTimeText(NaN), '');

assert.strictEqual(escapeHtml(`<a b='c'>&"`), '&lt;a b=&#39;c&#39;&gt;&amp;&quot;');
assert.strictEqual(escapeAttr('a\nb'), 'a&#10;b');
assert.strictEqual(renderStreamingText('a<b\nc'), '<p>a&lt;b<br>c</p>');
assert.strictEqual(
  pendingFeedbackHtml('<处理中>'),
  '<div class="pending-feedback"><span class="pending-orb" aria-hidden="true"></span><span class="pending-text">&lt;处理中&gt;</span><span class="pending-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>',
);
assert.strictEqual(isChatStatusText('正在处理请求'), true);
assert.strictEqual(isChatStatusText('正常回答'), false);

console.log('app formatting ok');

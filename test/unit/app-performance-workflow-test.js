#!/usr/bin/env node
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { createPerformanceWorkflow } = require('../../client/app/performance-workflow');

const dom = new JSDOM('<!doctype html><body><div id="messages"><div class="message" data-raw-text="**hi**"><div class="content"></div></div></div></body>');
const { document } = dom.window;
const storage = new Map();
const workflow = createPerformanceWorkflow({
  state: {},
  getElement: id => document.getElementById(id),
  document,
  window: {
    innerHeight: 800,
    __chatuiPerfLog: [],
    ChatUI: { performance: {} },
    getComputedStyle: () => ({ overflowY: 'auto' }),
  },
  localStorage: { getItem: key => storage.get(key) || null },
  performance: { now: () => 10 },
  requestAnimationFrame: cb => cb(),
  requestIdleCallback: cb => { cb({ didTimeout: false, timeRemaining: () => 8 }); return 1; },
  cancelIdleCallback: () => {},
  setTimeout: () => 1,
  clearTimeout: () => {},
  renderMarkdown: text => `<p>${text}</p>`,
  bindInlineCopyButtons: () => {},
  enhanceRenderedMarkdown: () => {},
  hydrateMessageMedia: () => {},
  escapeHtml: text => String(text).replace(/</g, '&lt;'),
});

assert.strictEqual(typeof workflow.chatuiContentHash('abc'), 'string');
assert.ok(workflow.chatuiPlainPreview('<x>').includes('&lt;x>'));
assert.strictEqual(workflow.chatuiReadBooleanFlag('missing', true), true);
assert.strictEqual(workflow.chatuiShouldLazyRender(null, ''), false);
const msg = document.querySelector('.message');
workflow.chatuiQueueLazyMessage(msg, '**hi**', { force: true });
assert.strictEqual(msg.dataset.lazyMarkdown, '0');
assert.strictEqual(msg.querySelector('.content').innerHTML, '<p>**hi**</p>');
const stats = workflow.chatuiPerfStats();
assert.strictEqual(stats.messages, 1);
assert.strictEqual(stats.flags.virtualRender, false);
console.log('app performance workflow ok');

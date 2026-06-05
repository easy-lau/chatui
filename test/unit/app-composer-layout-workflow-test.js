#!/usr/bin/env node
const assert = require('assert');
const { createComposerLayoutWorkflow } = require('../../client/app/composer-layout-workflow');

const rootStyles = new Map();
const messages = { style: {} };
const promptStyle = new Map();
const prompt = {
  scrollHeight: 96,
  style: {
    overflowY: '',
    setProperty(name, value) { promptStyle.set(name, value); },
  },
};
const composer = { getBoundingClientRect: () => ({ top: 500 }) };
let rafCalls = 0;
const workflow = createComposerLayoutWorkflow({
  getElement: id => ({ composer, messages, prompt })[id],
  window: {
    innerHeight: 800,
    visualViewport: { height: 760 },
    matchMedia: () => ({ matches: false }),
  },
  document: {
    documentElement: {
      clientHeight: 800,
      style: { setProperty: (name, value) => rootStyles.set(name, value) },
    },
  },
  requestAnimationFrame: cb => { rafCalls += 1; cb(); },
});

workflow.updateComposerSafeArea();
assert.strictEqual(rootStyles.get('--composer-safe-bottom'), '288px');
assert.strictEqual(messages.style.scrollPaddingBottom, '288px');
workflow.autoResize();
assert.strictEqual(promptStyle.get('--prompt-height'), '96px');
assert.strictEqual(promptStyle.get('height'), '96px');
assert.strictEqual(prompt.style.overflowY, 'hidden');
workflow.scheduleAutoResize();
assert.strictEqual(rafCalls, 2);
console.log('app composer layout workflow ok');

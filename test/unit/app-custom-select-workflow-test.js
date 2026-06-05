#!/usr/bin/env node
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { createCustomSelectWorkflow } = require('../../client/app/custom-select-workflow');

const dom = new JSDOM('<!doctype html><body><div id="host"><select id="model"><option value="a">A</option><option value="b" data-unrecognized="1">B（未知类型）</option></select></div></body>');
const { document, Event } = dom.window;
global.Event = Event;
const workflow = createCustomSelectWorkflow({
  getElement: id => document.getElementById(id),
  document,
  window: { innerWidth: 1024 },
});

workflow.enhanceConfigSelects(['model']);
const select = document.getElementById('model');
const wrapper = select.closest('.custom-select');
assert.ok(wrapper, 'select is wrapped');
assert.strictEqual(wrapper.querySelectorAll('.custom-select-option').length, 2);
assert.strictEqual(wrapper.querySelector('.custom-select-value .custom-select-main-text').textContent, 'A');
select.value = 'b';
workflow.updateCustomSelect(select);
assert.strictEqual(wrapper.querySelector('.custom-select-value .custom-select-main-text').textContent, 'B');
assert.strictEqual(wrapper.querySelector('.custom-select-value .model-unrecognized-badge').textContent, '未知类型');
wrapper.classList.add('open');
workflow.closeAllCustomSelects();
assert.ok(!wrapper.classList.contains('open'));
console.log('app custom select workflow ok');

#!/usr/bin/env node
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { createDialogWorkflow } = require('../../client/app/dialog-workflow');

(async () => {
  const dom = new JSDOM('<!doctype html><body><div id="confirmDialog" aria-hidden="true"><button data-confirm-cancel id="confirmDialogCancel"></button><button id="confirmDialogConfirm"></button><div id="confirmDialogTitle"></div><div id="confirmDialogMessage"></div></div></body>');
  const { document, KeyboardEvent } = dom.window;
  const timers = [];
  const workflow = createDialogWorkflow({
    document,
    window: dom.window,
    getElement: id => document.getElementById(id),
    setTimeout: cb => { timers.push(cb); return timers.length; },
    clearTimeout: () => {},
  });

  workflow.toast('OK');
  const toast = document.querySelector('.toast-popup');
  assert.strictEqual(toast.textContent, 'OK');
  assert.ok(toast.classList.contains('show'));

  const promise = workflow.showConfirmDialog({ title: 'T', message: 'M', confirmText: 'Y', cancelText: 'N' });
  assert.strictEqual(document.getElementById('confirmDialogTitle').textContent, 'T');
  assert.strictEqual(document.getElementById('confirmDialogMessage').textContent, 'M');
  assert.ok(document.body.classList.contains('confirm-open'));
  document.getElementById('confirmDialogConfirm').click();
  assert.strictEqual(await promise, true);
  assert.ok(!document.body.classList.contains('confirm-open'));

  const cancelPromise = workflow.showConfirmDialog({ message: 'Cancel?' });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.strictEqual(await cancelPromise, false);
  console.log('app dialog workflow ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

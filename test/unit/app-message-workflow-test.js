const assert = require('assert');
const fs = require('fs');
const workflow = require('../../client/app/message-workflow');

(function run() {
  const message = workflow.createMessageWorkflow({ state: {} });
  assert.strictEqual(typeof message.updateMessage, 'function');
  assert.strictEqual(typeof message.updateMessageContentLight, 'function');
  assert.strictEqual(typeof message.addMessage, 'function');
  const source = fs.readFileSync('client/app/message-workflow.js', 'utf8');
  assert.ok(source.includes('tpl.innerHTML = render(text);'), 'large final markdown should parse once as a full document');
  assert.ok(!source.includes('render(chunks[index++])'), 'large final markdown must not parse split chunks independently');
  assert.ok(source.includes('preserveMessageBottomAnchor?.(messageNode, 72)'), 'progressive DOM mounting should preserve the stream-end viewport anchor');
  assert.ok(source.includes('restoreProgressiveAnchor?.();'), 'progressive DOM mounting should restore the captured anchor while mounting');
  assert.ok(!source.includes('scrollToActiveOutput?.(messageNode, { force: true, active: true, settle: false, margin: 72 })'), 'final remount must not force a new follow-scroll target');
  assert.ok(!source.includes('skipMermaid:!phase.final'), 'streaming chunks must not auto-render mermaid or load mermaid resources');
  assert.ok(source.includes('enhanceRenderedMarkdown(root,{skipMermaid:!0,streaming:!!phase.streaming,deferMermaid:!0,allowResourceLoad:!!phase.final})'), 'streaming chunks run basic code/mermaid source enhancement without mermaid resource loading');
  assert.ok(source.includes('s.deferEnhance?(n.dataset.renderedHash=n.dataset.rawHash'), 'session restore can defer expensive per-message enhancement');
  assert.ok(source.includes('enhanceRenderedMarkdown(n,{skipMermaid:!0,allowResourceLoad:!0})'), 'normal final/history message enhancement may load markdown resources but must keep mermaid auto-render disabled');
  console.log('app message workflow ok');
})();

#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');

const workflow = fs.readFileSync('client/app/session-panel-workflow.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

assert(workflow.includes('createSessionPanelWorkflow'), 'session panel workflow factory should exist');
assert(workflow.includes('saveSessionPrompt'), 'session prompt save should live in session panel workflow');
assert(workflow.includes('openSessionImageStylePanel'), 'image style panel should live in session panel workflow');
assert(workflow.includes('openSessionModelPanel'), 'session model panel should live in session panel workflow');
assert(app.includes('getSessionPanelWorkflow().saveSessionPrompt'), 'app.js should proxy session prompt save');
assert(!app.includes('function saveSessionPrompt(){const e=$("sessionPromptInput")'), 'app.js should not keep session panel implementation');
assert(html.includes('client/app/session-panel-workflow.js'), 'index should load session panel workflow');
assert(html.indexOf('client/app/session-panel-workflow.js') < html.indexOf('./app.js'), 'session panel workflow must load before app.js');
console.log('app session panel workflow ok');

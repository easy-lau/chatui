#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
const bootstrapWorkflow = fs.readFileSync(path.join(__dirname, '../../client/app/bootstrap-workflow.js'), 'utf8');

assert.match(appJs, /function refreshActiveSessionOnReturn\(\)/, 'foreground refresh function should exist');
assert.match(bootstrapWorkflow, /document\.addEventListener\("visibilitychange"/, 'should refresh when the page becomes visible');
assert.match(bootstrapWorkflow, /window\.addEventListener\("pageshow",refreshActiveSessionOnReturn\)/, 'should refresh after bfcache/page restore');
assert.match(bootstrapWorkflow, /window\.addEventListener\("focus",refreshActiveSessionOnReturn\)/, 'should refresh after window focus');
assert.match(appJs, /readJsonStorage\(sessionStorageKey\(CHAT_KEY,e\)/, 'should reload canonical chat messages from storage');
assert.match(appJs, /readJsonStorage\(sessionStorageKey\(UI_KEY,e\)/, 'should reload canonical display items from storage');
assert.match(appJs, /syncActiveSession\(\{skipSave:!0\}\),renderActiveSession\(\)/, 'should sync state and rerender active session without overwriting storage first');
assert.match(appJs, /if\(isSessionBusy\(e\)\)return void resumeSessionJobs\(e\)/, 'should resume pending jobs instead of full rerender while active session is busy');

console.log('foreground refresh contract ok');

#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');

assert.match(
  appJs,
  /function switchSession\(e\)\{saveActivePromptDraft\(\);if\(!state\.sessions\.some\(t=>t\.id===e\)\)return;try\{saveChatHistory\(\),saveDisplayHistory\(\)\}/,
  'switchSession must persist current session messages and display before changing activeSessionId',
);
assert.match(
  appJs,
  /saveChatHistory\(\),saveDisplayHistory\(\)[\s\S]*state\.activeSessionId=e/,
  'switchSession must save the current session before replacing state.activeSessionId',
);

console.log('session switch preserves active messages ok');

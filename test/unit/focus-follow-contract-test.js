#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

assert.match(
  app,
  /function renderActiveSession\(\)[\s\S]*state\.userScrollLocked=!1[\s\S]*state\.streamFocusLocked=!1[\s\S]*settleScrollToBottom\(\{settleMs:\[50,150\]\}\)/,
  'switching/rendering a session resets stale manual scroll state and settles at the bottom after async layout changes',
);
assert.match(
  app,
  /function scrollToBottom\(e=!0,t=\{\}\)[\s\S]*state\.programmaticScrollUntil=Date\.now\(\)\+180[\s\S]*requestAnimationFrame[\s\S]*i\.forEach/,
  'programmatic bottom scroll is suppressed from manual-scroll detection and has delayed settling',
);
assert.match(
  app,
  /function markManualMessageScroll[\s\S]*Number\(e\.deltaY\|\|0\)<-1[\s\S]*!l&&\(s\|\|a\|\|o\|\|r\)[\s\S]*restoreStreamingFollowIfNearBottom\(72\)/,
  'manual upward wheel/touch/scrollbar drag pauses follow, while programmatic scroll and returning to bottom restore it',
);
assert.match(
  app,
  /function settleActiveOutput\(e,t=\{\}\)[\s\S]*requestAnimationFrame[\s\S]*setTimeout[\s\S]*150/,
  'active output has delayed final settling for markdown/mermaid/image height changes',
);
assert.match(
  app,
  /function sendChat[\s\S]*noScroll:!shouldFollowScroll\(\),streamKind:"chat"/,
  'first streaming response follows while the user has not manually scrolled away',
);
assert.match(
  app,
  /function sendChat[\s\S]*updateMessage\(g,C,\{[\s\S]*noScroll:!shouldFollowScroll\(\)[\s\S]*followActive:shouldFollowScroll\(\)[\s\S]*settleActiveOutput\(g,\{margin:72\}\)/,
  'final response follows and then settles if the user has not manually scrolled away',
);
assert.match(
  app,
  /function prepareRegeneratedResponse[\s\S]*state\.userScrollLocked=!1[\s\S]*armStreamingOutputFocus\(s,o,\{margin:72,clearStaleFocus:!0\}\)/,
  'regenerate creates a fresh streaming focus and clears stale manual scroll lock',
);
assert.ok(!app.includes('noScroll:Number.isFinite(n.replaceAssistantIndex)||!shouldFollowScroll(),streamKind:"chat"'), 'replaceAssistantIndex must not disable streaming follow');
assert.ok(!app.includes('noScroll:Number.isFinite(n.replaceAssistantIndex),runToken:o.token'), 'replaceAssistantIndex must not disable live display streaming follow');

console.log('focus follow contract ok');

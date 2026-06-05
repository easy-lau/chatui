#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');

const workflow = fs.readFileSync('client/app/media-workflow.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

assert(workflow.includes('createMediaWorkflow'), 'media workflow factory should exist');
assert(workflow.includes('persistImageSrc'), 'image persistence should live in media workflow');
assert(workflow.includes('resolvePersistedImages'), 'persisted image restore should live in media workflow');
assert(workflow.includes('deleteOrphanImageBlobs'), 'orphan image cleanup should live in media workflow');
assert(app.includes('getMediaWorkflow().persistImageSrc'), 'app.js should proxy media persistence');
assert(app.includes('getMediaWorkflow().resolvePersistedImages'), 'app.js should proxy persisted image restore');
assert(!app.includes('const imageStoreHelpers=window.ChatUIApp?.imageStore||{}'), 'app.js should not keep media store implementation block');
assert(html.includes('client/app/media-workflow.js'), 'index should load media workflow');
assert(html.indexOf('client/app/media-workflow.js') < html.indexOf('./app.js'), 'media workflow must load before app.js');
console.log('app media workflow ok');

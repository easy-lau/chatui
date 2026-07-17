'use strict';

const assert = require('assert');
const sessionDisplay = require('../../client/app/session-display');
const sessionPersistence = require('../../client/app/session-persistence');
const messageRecords = require('../../client/app/message-records');
const appState = require('../../client/app/state');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function createWorkflow({ storage, state, snapshotStore }) {
  return sessionDisplay.createSessionDisplayWorkflow({
    getState: () => state,
    getActiveSession: () => state.sessions.find(item => item.id === state.activeSessionId),
    createSession: appState.createSession,
    deriveSessionTitle: session => session.title || 'New chat',
    readJsonStorage: (key, fallback) => {
      try {
        const raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    compactDisplayItems: items => items,
    compactAdjacentDuplicateMessages: sessionPersistence.compactAdjacentDuplicateMessages,
    sanitizeStoredDisplayItem: sessionPersistence.sanitizeStoredDisplayItem,
    sanitizeStoredMessage: sessionPersistence.sanitizeStoredMessage,
    renderSessionList: () => {},
    localStorage: storage,
    messageRecords,
    snapshotStore,
    constants: {
      SESSIONS_KEY: 'sessions',
      ACTIVE_SESSION_KEY: 'active',
    },
  });
}

function createState() {
  return { sessions: [], activeSessionId: '', messages: [], models: [], reasoningMode: false };
}

async function testCurrentSnapshotFormatLoadsNormally() {
  const sessionId = 'current-session';
  const storage = createStorage({
    sessions: [{ id: sessionId, title: 'Current', updatedAt: 20 }],
    active: sessionId,
  });
  const state = createState();
  let writes = 0;
  const workflow = createWorkflow({
    storage,
    state,
    snapshotStore: {
      supported: true,
      getSnapshot: async () => ({
        id: sessionId,
        snapshotVersion: 2,
        updatedAt: 30,
        messages: [
          { role: 'user', content: 'hello', messageIndex: '0' },
          { role: 'assistant', content: 'world', responseIndex: '1' },
        ],
        pendingDisplay: [{ id: 'pending', role: 'assistant', rawText: 'working', pending: '1' }],
        lastGeneratedImage: { src: 'indexeddb://latest-image' },
      }),
      schedulePut: async () => { writes += 1; },
    },
  });

  await workflow.loadSessions();

  assert.deepStrictEqual(state.messages.map(item => item.content), ['hello', 'world']);
  assert.deepStrictEqual(state.sessions[0].display.map(item => item.id), ['pending']);
  assert.deepStrictEqual(state.sessions[0].lastGeneratedImage, { src: 'indexeddb://latest-image' });
  assert.strictEqual(state.sessions[0].snapshotUpdatedAt, 30);
  assert.strictEqual(writes, 0, 'loading a current snapshot must not rewrite it');
}

async function testLegacyLocalStoragePayloadIsIgnored() {
  const sessionId = 'legacy-local-storage';
  const storage = createStorage({
    sessions: [{ id: sessionId, title: 'Legacy', updatedAt: 20 }],
    active: sessionId,
    [`chat:${sessionId}`]: [{ role: 'user', content: 'legacy message', messageIndex: '0' }],
    [`ui:${sessionId}`]: [{ id: 'legacy-answer', role: 'assistant', rawText: 'legacy answer', responseIndex: '1' }],
    [`image:${sessionId}`]: { src: 'indexeddb://legacy-image' },
  });
  const state = createState();
  let writes = 0;
  const workflow = createWorkflow({
    storage,
    state,
    snapshotStore: {
      supported: true,
      getSnapshot: async () => null,
      schedulePut: async () => { writes += 1; },
    },
  });

  await workflow.loadSessions();

  assert.deepStrictEqual(state.messages, [], 'per-session localStorage history is no longer loaded');
  assert.deepStrictEqual(state.sessions[0].display, []);
  assert.strictEqual(state.sessions[0].lastGeneratedImage, null);
  assert.strictEqual(writes, 0, 'legacy localStorage history must not be migrated');
}

async function testVersionOneSnapshotIsIgnored() {
  const sessionId = 'snapshot-v1';
  const storage = createStorage({
    sessions: [{ id: sessionId, title: 'Old snapshot', updatedAt: 20 }],
    active: sessionId,
  });
  const state = createState();
  let writes = 0;
  const workflow = createWorkflow({
    storage,
    state,
    snapshotStore: {
      supported: true,
      getSnapshot: async () => ({
        id: sessionId,
        snapshotVersion: 1,
        updatedAt: 15,
        messages: [{ role: 'user', content: 'old snapshot message', messageIndex: '0' }],
        display: [{ id: 'old-answer', role: 'assistant', rawText: 'old answer', responseIndex: '1' }],
      }),
      schedulePut: async () => { writes += 1; },
    },
  });

  await workflow.loadSessions();
  const reloaded = await workflow.reloadSessionSnapshot(sessionId);

  assert.deepStrictEqual(state.messages, [], 'snapshotVersion 1 history is no longer loaded');
  assert.strictEqual(state.sessions[0].snapshotUpdatedAt, 0);
  assert.strictEqual(reloaded, false, 'snapshotVersion 1 history must also be ignored by live reload');
  assert.strictEqual(writes, 0, 'snapshotVersion 1 history must not be migrated');
}

module.exports = [
  testCurrentSnapshotFormatLoadsNormally,
  testLegacyLocalStoragePayloadIsIgnored,
  testVersionOneSnapshotIsIgnored,
];

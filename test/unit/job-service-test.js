#!/usr/bin/env node
const assert = require('assert');
const {
  makeClientImageJobId,
  makeClientChatJobId,
  startChatJob,
  registerChatStreamJob,
  getJob,
  waitJobEvent,
  startImageGenerationJob,
} = require('../../client/services/job-service');

(async () => {
  assert.ok(/^imgjob-/.test(makeClientImageJobId()));
  assert.ok(/^chatjob-/.test(makeClientChatJobId()));

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response('{"id":"ok"}', { status: 202, headers: { 'Content-Type': 'application/json' } });
  };
  const parseResponseJson = async res => res.json();
  const normalizeError = (_err, body) => body?.error?.message || 'bad';
  const config = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk' };

  await startChatJob({ payload: { a: 1 }, config, jobId: 'chatjob-x', headers: { 'x-test': '1' }, fetchImpl, parseResponseJson, normalizeError });
  assert.strictEqual(calls.at(-1).url, '/api/chat-jobs');
  assert.strictEqual(JSON.parse(calls.at(-1).options.body).headers['x-test'], '1');

  await registerChatStreamJob({ payload: { stream: true }, config, jobId: 'chatjob-y', start: true, fetchImpl, parseResponseJson, normalizeError });
  assert.strictEqual(calls.at(-1).url, '/api/chat-stream-jobs');
  assert.strictEqual(JSON.parse(calls.at(-1).options.body).start, true);

  await startImageGenerationJob({ payload: { prompt: 'x' }, config, jobId: 'imgjob-x', mode: 'image', files: [], fetchImpl, parseResponseJson, normalizeError });
  assert.strictEqual(calls.at(-1).url, '/api/image-jobs');

  await getJob({ url: '/api/chat-jobs/chatjob-x', fetchImpl, parseResponseJson, normalizeError });
  assert.strictEqual(calls.at(-1).url, '/api/chat-jobs/chatjob-x');

  await assert.rejects(() => getJob({
    url: '/api/nope',
    fetchImpl: async () => new Response('{"error":{"message":"nope"}}', { status: 404 }),
    parseResponseJson,
    normalizeError,
  }), /nope/);

  let closed = false;
  class QuietEventSource {
    constructor() {}
    addEventListener() {}
    close() { closed = true; }
  }
  const done = await waitJobEvent({
    url: '/api/image-jobs/imgjob-x/events',
    EventSourceImpl: QuietEventSource,
    pollIntervalMs: 5,
    pollJob: async () => ({ status: 'done', data: { ok: true } }),
  });
  assert.deepStrictEqual(done, { ok: true });
  assert.strictEqual(closed, true);

  console.log('job service ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});

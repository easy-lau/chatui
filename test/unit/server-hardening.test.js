const assert = require('assert');

const { JobStore } = require('../../server/jobs/store');
const jobEvents = require('../../server/jobs/events');
const jobUrl = require('../../server/jobs/job-url');
const { readBody } = require('../../server/http/body');
const urlPolicy = require('../../server/security/url-policy');
const extractApi = require('../../server/extract');
const { ConcurrencyLimiter } = require('../../server/concurrency');
const safeLog = require('../../server/logging/safe-log');
const { sendError } = require('../../server/http/response');
const { AppError, normalizeError, toErrorPayload } = require('../../server/errors/http-error');

function createMockResponse() {
  return {
    status: null,
    headers: null,
    body: '',
    ended: false,
    flushed: 0,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(chunk = '') { this.body += String(chunk); },
    flushHeaders() { this.flushed += 1; },
    end(body = '') { this.body += String(body || ''); this.ended = true; },
  };
}

function createMockRequest(url) {
  return {
    url,
    listeners: {},
    on(name, fn) { this.listeners[name] = fn; return this; },
    close() { this.listeners.close?.(); },
  };
}

function parseSseJson(body) {
  const dataLine = String(body || '').split(/\r?\n/).find(line => line.startsWith('data: '));
  assert.ok(dataLine, `missing SSE data line in ${body}`);
  return JSON.parse(dataLine.slice('data: '.length));
}

function parseLastSseJson(body) {
  const dataLines = String(body || '').split(/\r?\n/).filter(line => line.startsWith('data: '));
  assert.ok(dataLines.length, `missing SSE data line in ${body}`);
  return JSON.parse(dataLines.at(-1).slice('data: '.length));
}

function testJobUrlHelpersPreserveRouteParsingContract() {
  assert.deepStrictEqual(jobUrl.pathSegments('/api/chat-jobs/chatjob-abc12345/events?contentLength=1'), ['api', 'chat-jobs', 'chatjob-abc12345', 'events']);
  assert.strictEqual(jobUrl.isJobEventsUrl('/api/chat-jobs/chatjob-abc12345/events?contentLength=1'), true);
  assert.strictEqual(jobUrl.isAbortJobUrl('/api/image-jobs/imgjob-abc12345/abort?x=1'), true);
  assert.strictEqual(jobUrl.getJobIdFromUrl('/api/image-jobs/imgjob-abc12345/abort?x=1'), 'imgjob-abc12345');
  assert.strictEqual(jobUrl.getJobIdFromUrl({ url: '/api/chat-jobs/chatjob-a%2Fb/events' }), 'chatjob-a/b');
  assert.strictEqual(jobUrl.getJobIdFromUrl('/api/chat-jobs/chatjob-plain'), 'chatjob-plain');
}

function testJobEventsPreserveCompactPublicContract() {
  const job = {
    id: 'chatjob-abc12345',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    compactStream: true,
    streamDelta: { content: '增量', reasoning: '推理' },
    firstTokenMs: 12,
    durationMs: 34,
  };
  assert.deepStrictEqual(jobEvents.publicJob(job, { live: true }), { d: '增量', r: '推理', ft: 12, rt: 34 });
  job.status = 'done';
  job.data = { choices: [{ message: { content: 'abcdef', reasoning_content: 'uvwxyz' } }] };
  assert.deepStrictEqual(jobEvents.publicJob(job, { resumeUrl: '/api/chat-jobs/chatjob-abc12345/events?contentLength=2&reasoningLength=3' }), { d: 'cdef', r: 'xyz', rt: 34, done: 1 });
}

function testJobEventsSubscribeAndAbortContracts() {
  const subscribers = new Map();
  const { subscribeJob, abortJob, notifyJob } = jobEvents.createJobEvents({ jobSubscribers: subscribers });

  const missingReq = createMockRequest('/api/chat-jobs/missing-job/events');
  const missingRes = createMockResponse();
  subscribeJob(missingReq, missingRes, new Map());
  assert.strictEqual(missingRes.status, 200);
  assert.strictEqual(missingRes.headers['Content-Type'], 'text/event-stream; charset=utf-8');
  assert.strictEqual(missingRes.headers['Access-Control-Allow-Origin'], '*');
  assert.strictEqual(missingRes.ended, true);
  assert.deepStrictEqual(parseSseJson(missingRes.body), { status: 'error', error: { message: '任务不存在或服务已重启' } });

  const doneStore = new Map([['chatjob-done12345', {
    id: 'chatjob-done12345',
    status: 'done',
    createdAt: 1,
    updatedAt: 2,
    compactStream: true,
    data: { choices: [{ message: { content: 'hello world', reasoning_content: 'think' } }] },
  }]]);
  const doneReq = createMockRequest('/api/chat-jobs/chatjob-done12345/events?contentLength=6&reasoningLength=1');
  const doneRes = createMockResponse();
  subscribeJob(doneReq, doneRes, doneStore);
  assert.strictEqual(doneRes.status, 200);
  assert.strictEqual(doneRes.ended, true);
  assert.deepStrictEqual(parseSseJson(doneRes.body), { d: 'world', r: 'hink', done: 1 });
  assert.strictEqual(subscribers.has('chatjob-done12345'), false);

  let aborted = false;
  const runningJob = {
    id: 'chatjob-run12345',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    compactStream: true,
    controller: { abort: () => { aborted = true; } },
  };
  const runningStore = new Map([['chatjob-run12345', runningJob]]);
  const runningReq = createMockRequest('/api/chat-jobs/chatjob-run12345/events');
  const runningRes = createMockResponse();
  subscribeJob(runningReq, runningRes, runningStore);
  assert.strictEqual(subscribers.get('chatjob-run12345').has(runningRes), true);
  const abortedJob = abortJob(runningStore, 'chatjob-run12345');
  assert.strictEqual(aborted, true);
  assert.strictEqual(abortedJob.status, 'error');
  assert.strictEqual(runningRes.ended, true);
  assert.deepStrictEqual(parseLastSseJson(runningRes.body), { e: '任务已停止' });
  assert.strictEqual(subscribers.has('chatjob-run12345'), false);

  const firstTokenJob = { id: 'chatjob-ft12345', status: 'running', compactStream: true, firstTokenMs: 0, streamDelta: { content: 'a' } };
  const ftRes = createMockResponse();
  subscribers.set(firstTokenJob.id, new Set([ftRes]));
  notifyJob(firstTokenJob);
  assert.strictEqual(firstTokenJob.firstTokenNotified, true);
  assert.strictEqual(firstTokenJob.streamDelta, undefined);
  assert.deepStrictEqual(parseSseJson(ftRes.body), { d: 'a', ft: 0 });
}

function testServerHardeningHelpers() {
  assert.strictEqual(urlPolicy.isPrivateHostname('localhost'), true);
  assert.strictEqual(urlPolicy.normalizeBaseUrl('http://127.0.0.1:8765'), '');
  assert.strictEqual(urlPolicy.assertAllowedUpstreamUrl('https://api.example.com/v1'), true);
  assert.ok(safeLog.redactString('Authorization: Bearer sk-secret1234567890').includes('[redacted]'));
  assert.ok(!safeLog.redactString('data:image/png;base64,' + 'A'.repeat(5000)).includes('data:image'));

  const store = new JobStore('test', { ttlMs: 1000000, runningTtlMs: 10, maxJobs: 1 });
  let aborted = false;
  const now = Date.now();
  store.set('running-old', { status: 'running', createdAt: now - 1000, updatedAt: now - 1000, controller: { abort: () => { aborted = true; } } });
  store.sweep(now);
  const expired = store.get('running-old');
  assert.strictEqual(aborted, true);
  assert.strictEqual(expired.status, 'error');

  assert.strictEqual(extractApi.fileKind('a.txt', 'text/plain'), 'text');
  assert.strictEqual(extractApi.fileKind('a.pdf', ''), 'pdf');
  assert.strictEqual(extractApi.estimateDataUrlBytes('data:text/plain;base64,QUJDRA=='), 6);
  assert.throws(() => extractApi.assertExtractSizeAllowed('text', 999999999), /文件过大/);

  const limiter = new ConcurrencyLimiter(1, { maxQueue: 0 });
  return limiter.acquire()
    .then(() => limiter.acquire().then(() => assert.fail('should reject queue overflow')).catch(err => assert.strictEqual(err.statusCode, 429)))
    .finally(() => limiter.release());
}

async function testReadBodyReturns413WithoutDestroyingConnection() {
  const listeners = {};
  const req = {
    setEncoding() {},
    pause() { this.paused = true; },
    on(name, fn) { listeners[name] = fn; return this; },
  };
  const promise = readBody(req);
  listeners.data('x'.repeat(51 * 1024 * 1024));
  await assert.rejects(promise, err => err.statusCode === 413 && err.code === 'PAYLOAD_TOO_LARGE');
}

function testSendErrorKeepsLegacyContract() {
  const res = createMockResponse();
  sendError(res, 418, '旧错误文案', 'LEGACY_CODE', { field: 'name' }, { 'X-Test': 'ok' });
  assert.strictEqual(res.status, 418);
  assert.strictEqual(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.strictEqual(res.headers['X-Test'], 'ok');
  assert.deepStrictEqual(JSON.parse(res.body), { error: { code: 'LEGACY_CODE', message: '旧错误文案', detail: { field: 'name' } } });
}

function testAppErrorHelpersAreSendErrorCompatible() {
  const err = new AppError('兼容错误文案', {
    statusCode: 409,
    code: 'APP_CONFLICT',
    detail: { jobId: 'job-1' },
    headers: { 'X-App-Error': 'yes' },
  });

  assert.deepStrictEqual(normalizeError(err), {
    statusCode: 409,
    message: '兼容错误文案',
    code: 'APP_CONFLICT',
    detail: { jobId: 'job-1' },
    headers: { 'X-App-Error': 'yes' },
    original: err,
  });
  assert.deepStrictEqual(toErrorPayload(err), { error: { code: 'APP_CONFLICT', message: '兼容错误文案', detail: { jobId: 'job-1' } } });

  const res = createMockResponse();
  sendError(res, err);
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.headers['X-App-Error'], 'yes');
  assert.deepStrictEqual(JSON.parse(res.body), { error: { code: 'APP_CONFLICT', message: '兼容错误文案', detail: { jobId: 'job-1' } } });
}

module.exports = [
  testJobUrlHelpersPreserveRouteParsingContract,
  testJobEventsPreserveCompactPublicContract,
  testJobEventsSubscribeAndAbortContracts,
  testServerHardeningHelpers,
  testReadBodyReturns413WithoutDestroyingConnection,
  testSendErrorKeepsLegacyContract,
  testAppErrorHelpersAreSendErrorCompatible,
];

const assert = require('assert');

const routeDecision = require('../../client/core/route-decision');
const routeService = require('../../client/services/route-service');
const chatService = require('../../client/services/chat-service');
const jobService = require('../../client/services/job-service');

function testClientContractRouteDecisionExportsStayStable() {
  for (const key of [
    'API_ROUTES',
    'IMAGE_SOURCES',
    'cleanQuotedContent',
    'stripJsonFence',
    'isPlainTextChatInput',
    'isImagePromptExtractionInput',
    'isPromptWritingInput',
    'normalizeSelectedIndexes',
    'currentImageCount',
    'currentFileCount',
    'contextImageCandidates',
    'contextFileCandidates',
    'inferSourceFromContext',
    'defaultIndexesForSource',
    'selectedCandidatesForSource',
    'targetForEditSource',
    'imageRefTargetForSource',
    'referenceIdForSource',
  ]) {
    assert.ok(key in routeDecision, `missing routeDecision export: ${key}`);
  }
  assert.ok(routeDecision.API_ROUTES.has('chat'));
  assert.ok(routeDecision.API_ROUTES.has('image_edit'));
  assert.deepStrictEqual(routeDecision.normalizeSelectedIndexes([2, '2', 1, 0, 'bad', 3]), [2, 1, 3]);
}

function testClientContractRoutePayloadKeepsCompactShape() {
  const payload = routeService.buildRoutePayload({
    model: 'route-model',
    input: '总结这个文件',
    attachments: [{ id: 'file-1', name: 'a.txt', type: 'text/plain', size: 12, is_image: false, has_extracted_text: true }],
    context: {
      recent_messages: [{ role: 'user', content: '旧消息' }],
      image_candidates: [],
      file_candidates: [{ index: 1, source: 'history', file_id: 'old', name: 'old.txt' }],
      ignored_empty: [],
    },
    currentMode: 'chat',
    autoMode: true,
  });
  assert.strictEqual(payload.model, 'route-model');
  assert.strictEqual(payload.temperature, 0);
  assert.strictEqual(payload.messages.length, 2);
  assert.strictEqual(payload.messages[0].role, 'system');
  assert.strictEqual(payload.messages[1].role, 'user');
  const user = JSON.parse(payload.messages[1].content);
  assert.strictEqual(user.current_input, '总结这个文件');
  assert.ok(Array.isArray(user.attachments));
  assert.ok(Array.isArray(user.context.file_candidates));
  assert.ok(!('ignored_empty' in user.context));
  assert.ok(!/(reasoning|thinking|reasoning_effort|enable_thinking)/i.test(JSON.stringify(payload)));
}

function testClientContractRouteParsingPreservesClarificationShape() {
  const parsed = routeService.parseRouteResult(JSON.stringify({
    route: 'image_edit',
    need_clarification: true,
    reply_to_user: '请明确要处理第几张图片。',
    confidence: 0.7,
    reason: 'multiple candidates',
  }), null, { input: '改一下这张图', attachments: [], context: { image_candidates: [{ index: 1, source: 'history' }, { index: 2, source: 'history' }] } });
  assert.strictEqual(parsed.mode, 'chat');
  assert.strictEqual(parsed.needClarification, true);
  assert.strictEqual(parsed.clarificationQuestion, '请明确要处理第几张图片。');
  assert.strictEqual(parsed.intent, 'unknown');
  assert.strictEqual(parsed.operation.type, 'plain_chat');
}

function testClientContractServiceExportsStayStable() {
  for (const key of ['extractChatJobText', 'requestJson', 'parseSseLine']) {
    assert.strictEqual(typeof chatService[key], 'function', `missing chatService export: ${key}`);
  }
  for (const key of ['makeClientJobId', 'makeClientImageJobId', 'makeClientChatJobId', 'startChatJob', 'registerChatStreamJob', 'getJob', 'abortManagedJob', 'waitJobEvent', 'startImageGenerationJob']) {
    assert.strictEqual(typeof jobService[key], 'function', `missing jobService export: ${key}`);
  }
  assert.match(jobService.makeClientChatJobId(), /^chatjob-[a-z0-9]+-[a-z0-9]+$/);
  assert.match(jobService.makeClientImageJobId(), /^imgjob-[a-z0-9]+-[a-z0-9]+$/);
}

function testClientContractChatAndSseParsingShape() {
  assert.deepStrictEqual(chatService.extractChatJobText({ choices: [{ message: { content: '答复', reasoning_content: '推理' } }], metrics: { firstTokenMs: 12, durationMs: 34 } }), {
    content: '答复',
    reasoning: '推理',
    firstTokenMs: 12,
    durationMs: 34,
  });
  assert.deepStrictEqual(chatService.parseSseLine('data: [DONE]', value => value), { done: true });
  assert.deepStrictEqual(chatService.parseSseLine('data: {"delta":"abc"}', value => value.delta), { done: false, delta: 'abc' });
  assert.strictEqual(chatService.parseSseLine(': keepalive', value => value), null);
}

module.exports = [
  testClientContractRouteDecisionExportsStayStable,
  testClientContractRoutePayloadKeepsCompactShape,
  testClientContractRouteParsingPreservesClarificationShape,
  testClientContractServiceExportsStayStable,
  testClientContractChatAndSseParsingShape,
];

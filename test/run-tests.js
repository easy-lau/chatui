const assert = require('assert');
const fs = require('fs');
const path = require('path');

const routeContext = require('../client/core/image-route-context');
const routeService = require('../client/services/route-service');
const imageGeneration = require('../client/services/image-generation-service');
const imageService = require('../client/services/image-service');
const imageJobs = require('../server/jobs/image');
const serverConfig = require('../server/config');
const clarificationService = require('../client/services/clarification-service');
const sessionPersistence = require('../client/app/session-persistence');
const chatWorkflow = require('../client/app/chat-workflow');
const imageContextWorkflow = require('../client/app/image-context-workflow');
const messageWorkflow = require('../client/app/message-workflow');
const usageRanges = require('../server/usage/ranges');
const usageExportXlsx = require('../server/usage/export-xlsx');
const usageStatsFormat = require('../client/ui/usage-stats-format');
const usageStatsAuth = require('../client/ui/usage-stats-auth');
const { JobStore } = require('../server/jobs/store');
const { readBody } = require('../server/http/body');
const urlPolicy = require('../server/security/url-policy');
const extractApi = require('../server/extract');
const { ConcurrencyLimiter } = require('../server/concurrency');
const safeLog = require('../server/logging/safe-log');
const officeExtract = require('../server/extract/office');
const responsesStream = require('../server/proxy/responses-stream');
const appState = require('../client/app/state');
const sessionDisplay = require('../client/app/session-display');
const formatting = require('../client/app/formatting');
const markdownEngine = require('../client/app/markdown/markdown-engine');
const markdownSourceNormalizer = require('../client/app/markdown/source-normalizer');

function stripLargeDataUrlsFromText(text = '') {
  return String(text || '').replace(/data:[^\s"'<>`]+;base64,[A-Za-z0-9+/=\r\n]+/g, '[image-data-omitted]');
}

function testRouteContextIsCompactAndIndexed() {
  const imageContext = JSON.stringify({
    target: 'uploaded',
    mode: 'edit_image',
    updatedAt: 1781176791027,
    attachments: [{ id: 'att_logo', name: 'logo.png', type: 'image/png', size: 51586, src: 'indexeddb://logo' }],
  });
  const attachmentContext = JSON.stringify({
    prompt: '提取文字',
    content: '提取文字\n\n[image id=att_logo name=logo.png type=image/png size=51586]',
    attachments: [{ id: 'att_logo', name: 'logo.png', type: 'image/png', size: 51586, src: 'indexeddb://logo' }],
  });
  const messages = [{ role: 'user', content: '提取文字\n\n[image id=att_logo name=logo.png type=image/png size=51586]', rawText: '提取文字', imageContext, attachmentContext }];
  const ctx = routeContext.buildRouteContext({
    messages,
    latestUploadedImage: { prompt: '提取文字', count: 1, target: 'uploaded', updatedAt: 1781176791027 },
    latestImageReference: { target: 'uploaded', usePreviousImage: false, count: 1, selection: 'all', reason: 'latest-uploaded-image' },
    recentImageReferences: [],
    maxChars: 262144,
  });
  assert.strictEqual(ctx.image_candidates.length, 1);
  assert.deepStrictEqual(ctx.recent_image_references, []);
  assert.deepStrictEqual(ctx.recent_uploaded_image_references, []);
  assert.ok(!JSON.stringify(ctx).includes('data:image'));
  assert.ok(!JSON.stringify(ctx).includes('base64'));

  const payload = routeService.buildRoutePayload({
    model: 'deepseek-v4-pro',
    input: '提取文字',
    attachments: [{ name: 'logo.png', type: 'image/png', size: 51586, is_image: true }],
    context: ctx,
    currentMode: 'chat',
    autoMode: true,
  });
  const body = payload.messages[1].content;
  assert.strictEqual((body.match(/"candidates"/g) || []).length, 0);
  assert.strictEqual((body.match(/"image_candidates"/g) || []).length, 1);
  const parsedRouteUser = JSON.parse(body);
  assert.ok(!(parsedRouteUser.context?.recent_messages || []).some(item => item.role === 'user' && String(item.content || '').startsWith('提取文字')), 'route payload should not duplicate current_input in recent_messages');
  assert.ok(body.length < 1600, `route body too large: ${body.length}`);
  assert.ok(payload.messages[0].content.includes('"route":"chat|vision|image_generate|image_edit|unclear|unsafe"'));
  assert.ok(payload.messages[0].content.includes('image_source'));
  const minimalPayload = routeService.buildRoutePayload({ model: 'deepseek-v4-pro', input: '解释一下 JavaScript 里的 Promise 是什么。', attachments: [], context: {}, currentMode: 'chat', autoMode: true });
  assert.strictEqual(minimalPayload.messages[1].content, JSON.stringify({ current_input: '解释一下 JavaScript 里的 Promise 是什么。' }));
  assert.ok(minimalPayload.messages[0].content.length < 2600, `route system prompt too large: ${minimalPayload.messages[0].content.length}`);
}

function testImageGenerationPayloadDoesNotRewritePromptOrAutoParams() {
  const payload = imageGeneration.buildImageRequestPayload({ model: 'gpt-image-2', prompt: '画一只猫', size: 'auto', quality: 'auto', background: 'auto', format: 'auto' });
  assert.deepStrictEqual(payload, { model: 'gpt-image-2', prompt: '画一只猫' });
}

function testImageResultParsingSupportsMultipleImages() {
  const result = imageService.extractImageResult({ data: [{ url: 'https://a/1.png' }, { b64_json: 'BBBB' }] });
  assert.strictEqual(result.kind, 'image');
  assert.strictEqual(result.images.length, 2);
}

function testPendingClarificationMergesFollowupSupplements() {
  const messages = [
    { role: 'user', rawText: '把这张图改成红色背景' },
    { role: 'assistant', rawText: '请上传要修改的图片。' },
  ];
  const pending = clarificationService.findPendingFromHistory(messages);
  assert.ok(pending, 'should find pending clarification from history');
  assert.strictEqual(pending.kind, 'image_edit');

  const merged = clarificationService.mergePendingInput(pending, {
    promptText: '',
    attachments: [{ name: 'photo.png', type: 'image/png' }],
  });
  assert.strictEqual(merged.merged, true);
  assert.ok(merged.promptText.includes('把这张图改成红色背景'));
  assert.ok(merged.promptText.includes('用户上传了 1 个附件'));

  const second = clarificationService.mergePendingInput(merged.pending, {
    promptText: '背景用深红色，保留主体',
    attachments: [],
  });
  assert.ok(second.promptText.includes('补充1'));
  assert.ok(second.promptText.includes('本轮补充：背景用深红色，保留主体'));
  assert.strictEqual(second.pending.rounds, 3);
}

function testPendingClarificationCanMergeTextFileAndQuote() {
  const pending = clarificationService.createPendingClarification({
    messages: [
      { role: 'user', rawText: '总结这个文件' },
      { role: 'assistant', rawText: '请上传或引用要总结的文件。' },
    ],
    clarificationText: '请上传或引用要总结的文件。',
  });
  assert.ok(pending);
  assert.strictEqual(pending.kind, 'file_qa');
  const merged = clarificationService.mergePendingInput(pending, {
    promptText: '重点关注结论部分',
    attachments: [{ name: 'demo.txt', type: 'text/plain' }],
    quotedMessage: { role: 'user', content: '[附件消息]' },
    quoteText: '引用文件 demo.txt',
  });
  assert.ok(merged.promptText.includes('总结这个文件'));
  assert.ok(merged.promptText.includes('重点关注结论部分'));
  assert.ok(merged.promptText.includes('引用文件 demo.txt'));
}

function testPendingClarificationCarriesOriginalMultiImageContext() {
  const pending = clarificationService.createPendingClarification({
    messages: [
      { role: 'user', rawText: '把这张图改一下', attachmentContext: JSON.stringify({ attachments: [
        { id: 'img_1', name: '老板.png', type: 'image/png' },
        { id: 'img_2', name: '前端.png', type: 'image/png' },
        { id: 'img_3', name: '后端.png', type: 'image/png' },
      ] }) },
      { role: 'assistant', rawText: '您有三张上传的图片，请问您想编辑哪一张？请指定图片编号或描述。' },
    ],
    clarificationText: '您有三张上传的图片，请问您想编辑哪一张？请指定图片编号或描述。',
    sourceAttachmentContext: JSON.stringify({ attachments: [
      { id: 'img_1', name: '老板.png', type: 'image/png' },
      { id: 'img_2', name: '前端.png', type: 'image/png' },
      { id: 'img_3', name: '后端.png', type: 'image/png' },
    ] }),
  });
  assert.ok(pending);
  assert.strictEqual(pending.kind, 'image_edit');
  assert.ok(pending.sourceAttachmentContext.includes('老板.png'));
  assert.strictEqual(clarificationService.shouldApplyPending(pending, { promptText: '第一张', attachments: [] }), true);
  assert.strictEqual(clarificationService.shouldApplyPending(pending, { promptText: '今天天气怎么样', attachments: [] }), false);
  const merged = clarificationService.mergePendingInput(pending, {
    promptText: '第一张',
    attachments: [{ name: '老板.png', type: 'image/png' }, { name: '前端.png', type: 'image/png' }, { name: '后端.png', type: 'image/png' }],
  });
  assert.ok(merged.promptText.includes('把这张图改一下'));
  assert.ok(merged.promptText.includes('本轮补充：第一张'));
}

function testImageEditPromptFallbackAndValidation() {
  const payload = imageJobs.ensureImageEditPrompt({ model: 'gpt-image-2', prompt: '', editInstruction: '把背景改成红色' }, {});
  assert.strictEqual(payload.prompt, '把背景改成红色');

  const payloadFromBody = imageJobs.ensureImageEditPrompt({ model: 'gpt-image-2', prompt: '' }, { originalPrompt: '改成漫画风' });
  assert.strictEqual(payloadFromBody.prompt, '改成漫画风');

  const openaiPayload = imageJobs.buildOpenAiImageEditPayload(payload, [{ name: 'a.png', type: 'image/png', data: 'QUJDRA==' }]);
  assert.strictEqual(openaiPayload.prompt, '把背景改成红色');
  assert.strictEqual(openaiPayload.images.length, 1);
}

function testImageJobTargetsAndMultipartSanitization() {
  assert.strictEqual(imageJobs.imageJobTargetUrl('https://ingress.lfans.cn/v1', 'image', {}), 'https://ingress.lfans.cn/v1/images/generations');
  assert.strictEqual(imageJobs.imageJobTargetUrl('https://ingress.lfans.cn/v1', 'edit_image', {}), 'https://ingress.lfans.cn/v1/images/edits');

  const dataUrl = 'data:image/png;base64,' + 'A'.repeat(64);
  const editPayload = imageJobs.stripImageEditFileFields({ model: 'gpt-image-2', prompt: '改成黑白', n: 2, image: dataUrl, images: [{ data: 'xxx' }] });
  assert.ok(!('image' in editPayload));
  assert.ok(!('images' in editPayload));

  const openaiPayload = imageJobs.buildOpenAiImageEditPayload({ model: 'gpt-image-2', prompt: `改图 ${dataUrl}`, n: 2 }, [{ name: 'logo.png', type: 'image/png', data: 'QUJDRA==' }]);
  assert.ok(!('n' in openaiPayload));
  assert.ok(!String(openaiPayload.prompt).includes('data:image'));
  assert.strictEqual(openaiPayload.images.length, 1);

  const multipart = imageJobs.buildImageEditMultipartBody({ model: 'gpt-image-2', prompt: '改成黑白' }, [{ name: 'logo.png', type: 'image/png', data: 'QUJDRA==' }]);
  assert.ok(Buffer.isBuffer(multipart.body));
  assert.ok(multipart.headers['Content-Type'].includes('multipart/form-data; boundary='));
  assert.strictEqual(multipart.headers['Content-Length'], String(multipart.body.length));
  const boundary = multipart.headers['Content-Type'].match(/boundary=(.+)$/)?.[1];
  assert.ok(boundary, 'multipart boundary should be present');
  const multipartText = multipart.body.toString('latin1');
  assert.ok(multipartText.includes('name="prompt"'));
  assert.ok(multipartText.includes('name="image"; filename="logo.png"'));
  assert.ok(multipartText.endsWith(`--${boundary}--\r\n`));

  const multiImage = imageJobs.buildImageEditMultipartBody({ model: 'gpt-image-2', prompt: '合成' }, [
    { name: 'a.png', type: 'image/png', data: 'QUJDRA==' },
    { name: 'b.png', type: 'image/png', data: 'QUJDRA==' },
  ]);
  assert.strictEqual((multiImage.body.toString('latin1').match(/name="image"; filename=/g) || []).length, 2);
  assert.throws(() => imageJobs.buildImageEditMultipartBody({ model: 'gpt-image-2', prompt: '坏图' }, [{ name: 'bad.png', type: 'image/png', data: '!!!!' }]), /图片附件数据无效/);
  assert.ok(serverConfig.ALLOWED_PROXY_PATHS.some(re => re.test('/images/edits')));
}

function testStorageSanitizesEmbeddedImageContent() {
  const clean = sessionPersistence.sanitizeStoredMessage({
    role: 'user',
    content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
    imageContext: JSON.stringify({ attachments: [{ name: 'a.png', src: 'data:image/png;base64,BBBB' }] }),
  }, { stripLargeDataUrlsFromText });
  const serialized = JSON.stringify(clean);
  assert.ok(!serialized.includes('data:image'));
  assert.ok(serialized.includes('[image-data-omitted]') || !serialized.includes('AAAA'));
  const cleanWithDefaultStripper = sessionPersistence.sanitizeStoredMessage({
    role: 'user',
    content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,SMALL' } }],
  });
  assert.ok(!JSON.stringify(cleanWithDefaultStripper).includes('data:image'));
}

function testPersistedAttachmentPreviewSurvivesDataUrlStripping() {
  const html = '<div class="user-attachment-preview-grid"><img class="user-attachment-image" src="data:image/png;base64,' + 'A'.repeat(3000) + '" data-persisted-src="indexeddb://att-1" alt="a.png"></div>';
  const clean = sessionPersistence.sanitizeStoredDisplayItem({ role: 'user', html }, { stripLargeDataUrlsFromText });
  assert.ok(clean.html.includes('data-persisted-src="indexeddb://att-1"'), 'persisted IndexedDB image reference should survive sanitization');
  assert.ok(!clean.html.includes('data:image/png;base64'), 'large inline image payload should be stripped from stored HTML');
  assert.ok(!clean.html.includes('image-missing'), 'image should not be marked missing when persisted src remains');
}

function testFilePlaceholderSemanticsAndFileUnderstanding() {
  const payload = routeService.buildRoutePayload({
    model: 'route-model',
    input: '这是什么',
    attachments: [{ name: 'pg.sql', type: 'text/plain', size: 128, is_image: false, has_extracted_text: true }],
    context: { recent_messages: [{ role: 'user', content: '这是什么\n\n[file id=att_1 name=pg.sql type=text/plain size=128]' }], image_candidates: [] },
  });
  const system = payload.messages[0].content;
  const body = payload.messages[1].content;
  assert.ok(system.includes('metadata/placeholders'));
  assert.ok(system.includes('do not infer file/image contents'));
  assert.ok(system.includes('context.file_candidates'));
  assert.ok(body.includes('"is_image":false'));
  assert.ok(body.includes('"file_candidates"'));
  assert.ok(body.includes('"has_extracted_text":true'));
  assert.ok(!body.includes('CREATE TABLE users'));
  const submitSource = require('fs').readFileSync(require('path').join(__dirname, '../client/app/submit-workflow.js'), 'utf8');
  const appSource = require('fs').readFileSync(require('path').join(__dirname, '../app.js'), 'utf8');
  assert.ok(submitSource.includes('这是什么') && submitSource.includes('这个附件'));
  assert.ok(submitSource.includes('里面|其中|多少') && submitSource.includes('邮箱|邮件|地址'));
  assert.ok(appSource.includes('这是什么') && appSource.includes('这个附件'));
  assert.ok(appSource.includes('里面|其中|多少') && appSource.includes('邮箱|邮件|地址'));
}

function testQuotedFileAttachmentTextIsIncluded() {
  const workflow = chatWorkflow.createChatWorkflow({ state: {} });
  const attachmentContext = JSON.stringify({
    attachments: [{ id: 'att_doc', name: 'doc.txt', type: 'text/plain', text: '引用附件正文内容' }],
  });
  const messages = [{ role: 'user', content: '这是什么\n\n[file id=att_doc name=doc.txt type=text/plain size=12]', attachmentContext }];
  const base = workflow.normalizeQuotedBaseMessages(messages);
  assert.strictEqual(base.length, 1);
  assert.ok(base[0].content.includes('[引用附件：doc.txt]'));
  assert.ok(base[0].content.includes('引用附件正文内容'));
  assert.ok(base[0].content.includes('引用消息带有非图片文件附件'));
}

function testHistoryFileAttachmentTextIsIncludedInChatContext() {
  const workflow = chatWorkflow.createChatWorkflow({ state: {} });
  const attachmentContext = JSON.stringify({
    attachments: [{ id: 'att_doc', name: 'mail.txt', type: 'text/plain', text: '最后一个邮箱：boss@example.com' }],
  });
  const base = workflow.requestBaseMessagesForSend({}, [
    { role: 'user', content: '已发送附件\n\n[file id=att_doc name=mail.txt type=text/plain size=32]', rawText: '已发送附件', attachmentContext },
    { role: 'assistant', content: '请说明你的需求。' },
  ]);
  assert.strictEqual(base.length, 2);
  assert.ok(base[0].content.includes('[历史附件：mail.txt]'));
  assert.ok(base[0].content.includes('最后一个邮箱：boss@example.com'));
}

function testHistoryFileCandidatesRouteAsFileQa() {
  const context = routeContext.buildRouteContext({
    messages: [{
      role: 'user',
      content: '已发送附件\n\n[file id=att_doc name=mail.txt type=text/plain size=32]',
      attachmentContext: JSON.stringify({ attachments: [{ id: 'att_doc', name: 'mail.txt', type: 'text/plain', size: 32, text: '最后一个邮箱：boss@example.com' }] }),
    }],
  });
  assert.strictEqual(context.file_candidates.length, 1);
  assert.strictEqual(context.file_candidates[0].source, 'history');
  const parsed = routeService.parseRouteResult('{"route":"chat","need_file_input":false,"confidence":0.9}', routeContext.normalizeRoute, {
    input: '从文件中提取最后一个邮箱',
    attachments: [],
    context,
  });
  assert.strictEqual(parsed.mode, 'chat');
  assert.strictEqual(parsed.operation.type, 'file_qa');
  assert.strictEqual(parsed.operation.scope, 'history');
  assert.strictEqual(parsed.fileRefs[0].source, 'history');
}

function testUserAttachmentContextFallsBackToImageContextForRegenerate() {
  const imageContext = JSON.stringify({
    prompt: '把这张图改一下',
    mode: 'edit_image',
    target: 'uploaded',
    attachments: [{ id: 'img_1', name: '老板.png', type: 'image/png', src: 'indexeddb://boss' }],
  });
  const session = {
    messages: [{ role: 'user', rawText: '把这张图改一下', imageContext }],
    display: [],
  };
  const workflow = imageContextWorkflow.createImageContextWorkflow({ getActiveSession: () => session });
  const node = { dataset: { messageIndex: '0' }, __displayItem: null };
  const context = workflow.getUserAttachmentContextFromNode(node);
  assert.ok(context, 'should restore upload image context when attachmentContext is absent');
  assert.strictEqual(context.attachments[0].src, 'indexeddb://boss');
}

function testQuotedAssistantImageContextRestoresFromCanonicalMessage() {
  const imageContext = JSON.stringify({
    prompt: '画一只猫',
    mode: 'image',
    target: 'previous',
    attachments: [{ name: 'cat.png', type: 'image/png', src: 'indexeddb://cat', imageId: 'img_latest_1' }],
  });
  const session = {
    messages: [
      { role: 'user', content: '画一只猫' },
      { role: 'assistant', content: '[图片生成完成] 画一只猫', imageContext },
    ],
    display: [],
  };
  const workflow = imageContextWorkflow.createImageContextWorkflow({ getActiveSession: () => session });
  const node = { dataset: { responseIndex: '1' }, __displayItem: {}, querySelectorAll: () => [] };
  const restored = workflow.getAssistantImageContext(node);
  assert.ok(restored, 'assistant image context should restore from canonical message by responseIndex');
  assert.strictEqual(restored.attachments[0].src, 'indexeddb://cat');
}

function testExistingImageEditGateAllowsPreviousSelection() {
  const submitSource = fs.readFileSync(path.join(__dirname, '../client/app/submit-workflow.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.ok(submitSource.includes('canResolveExistingEditImage'), 'submit workflow must allow previous/uploaded image resolver before blocking edit');
  assert.ok(submitSource.includes('!!routeInfo.usePreviousImage') && submitSource.includes('routeInfo.target==="previous"'));
  assert.ok(appSource.includes('canResolveExistingEditImage'), 'regenerate/app workflow must allow previous/uploaded image resolver before blocking edit');
  assert.ok(appSource.includes('!!p.usePreviousImage') && appSource.includes('p.target==="previous"'));
}

function testLightweightIntentClassifierAdapters() {
  const unsafeApi = routeContext.normalizeRoute(routeService.apiRouteToExecutionRoute({
    route: 'unsafe', reply_to_user: '抱歉，这个请求我不能帮助处理。', confidence: 1, reason: 'route model unsafe',
  }, { input: '帮我盗取别人的账号密码', attachments: [], context: {} }), 'chat');
  assert.strictEqual(unsafeApi.mode, 'chat');
  assert.strictEqual(unsafeApi.needClarification, true);
  assert.ok(unsafeApi.clarificationQuestion.includes('不能帮助'));

  const currentImage = [{ name: 'room.png', type: 'image/png', is_image: true }];
  const currentContext = { image_candidates: [] };
  const editCurrent = routeService.parseRouteResult(JSON.stringify({
    route: 'image_edit',
    need_image_input: false,
    need_file_input: false,
    need_clarification: false,
    image_source: 'current',
    selected_indexes: [1],
    use_previous_image: false,
    instruction: '把背景换成海边，保持主体不变',
    reply_to_user: '',
    confidence: 0.95,
    reason: '修改当前上传图片',
  }), routeContext.normalizeRoute, { input: '把背景换成海边', attachments: currentImage, context: currentContext });
  assert.strictEqual(editCurrent.mode, 'edit_image');
  assert.strictEqual(editCurrent.operation.type, 'image_edit');
  assert.strictEqual(editCurrent.target, 'uploaded');
  assert.strictEqual(editCurrent.usePreviousImage, false);
  assert.deepStrictEqual(editCurrent.selectedIndexes, [1]);
  assert.strictEqual(editCurrent.editInstruction, '把背景换成海边，保持主体不变');

  const apiEditCurrent = routeService.parseRouteResult(JSON.stringify({
    route: 'image_edit',
    need_image_input: false,
    need_file_input: false,
    need_clarification: false,
    image_source: 'current',
    selected_indexes: [1],
    use_previous_image: false,
    instruction: '参考这个图做一个后端',
    reply_to_user: '',
    confidence: 0.95,
    reason: '改图接口',
  }), routeContext.normalizeRoute, { input: '参考这个图做一个后端', attachments: currentImage, context: currentContext });
  assert.strictEqual(apiEditCurrent.mode, 'edit_image');
  assert.strictEqual(apiEditCurrent.operation.type, 'image_edit');
  assert.strictEqual(apiEditCurrent.target, 'uploaded');
  assert.strictEqual(apiEditCurrent.editInstruction, '参考这个图做一个后端');

  const apiVisionCurrent = routeService.parseRouteResult(JSON.stringify({
    route: 'vision', image_source: 'current', selected_indexes: [1], confidence: 0.95,
  }), routeContext.normalizeRoute, { input: '提取图片文字', attachments: currentImage, context: currentContext });
  assert.strictEqual(apiVisionCurrent.mode, 'chat');
  assert.strictEqual(apiVisionCurrent.operation.type, 'image_qa');
  assert.strictEqual(apiVisionCurrent.target, 'none');

  const apiTextImage = routeService.parseRouteResult(JSON.stringify({
    route: 'image_generate', instruction: '画一只猫', confidence: 0.95,
  }), routeContext.normalizeRoute, { input: '画一只猫', attachments: [], context: {} });
  assert.strictEqual(apiTextImage.mode, 'image');
  assert.strictEqual(apiTextImage.operation.type, 'text_to_image');
  assert.strictEqual(apiTextImage.target, 'new');

  const apiRefImage = routeService.parseRouteResult(JSON.stringify({
    route: 'image_generate', image_source: 'current', selected_indexes: [1], instruction: '参考当前图片风格生成海报', confidence: 0.9,
  }), routeContext.normalizeRoute, { input: '参考这张图的风格生成一张海报', attachments: currentImage, context: currentContext });
  assert.strictEqual(apiRefImage.mode, 'image');
  assert.strictEqual(apiRefImage.operation.type, 'image_reference_gen');
  assert.strictEqual(apiRefImage.target, 'new');

  const quotedContext = { image_candidates: [{ index: 1, image_id: 'img_quote_1', reference_id: 'imgref_quote', target: 'previous', source: 'quoted' }] };
  const editQuoted = routeService.parseRouteResult(JSON.stringify({
    route: 'image_edit', image_source: 'quoted', selected_indexes: [1], instruction: '改成漫画风', confidence: 0.9,
  }), routeContext.normalizeRoute, { input: '改成漫画风', attachments: [], context: quotedContext });
  assert.strictEqual(editQuoted.mode, 'edit_image');
  assert.strictEqual(editQuoted.target, 'previous');
  assert.strictEqual(editQuoted.selectedReferenceId, 'imgref_quote');
  assert.deepStrictEqual(editQuoted.selectedImageIds, ['img_quote_1']);

  const historyContext = { image_candidates: [{ index: 1, image_id: 'img_imgref_latest_1', reference_id: 'imgref_latest', target: 'previous', source: 'history' }], latest_image_reference: { reference_id: 'imgref_latest', target: 'previous' } };
  const editHistory = routeService.parseRouteResult(JSON.stringify({
    route: 'image_edit', image_source: 'history', selected_indexes: [1], use_previous_image: true, instruction: '改成黑白', confidence: 0.9,
  }), routeContext.normalizeRoute, { input: '把上一张改成黑白', attachments: [], context: historyContext });
  assert.strictEqual(editHistory.mode, 'edit_image');
  assert.strictEqual(editHistory.target, 'previous');
  assert.strictEqual(editHistory.usePreviousImage, true);
  assert.strictEqual(editHistory.selectedReferenceId, 'imgref_latest');

  const refGen = routeService.parseRouteResult(JSON.stringify({
    route: 'image_generate', image_source: 'current', selected_indexes: [1], instruction: '参考当前图片风格生成海报', confidence: 0.9,
  }), routeContext.normalizeRoute, { input: '参考这张图的风格生成一张海报', attachments: currentImage, context: currentContext });
  assert.strictEqual(refGen.mode, 'image');
  assert.strictEqual(refGen.operation.type, 'image_reference_gen');
  assert.strictEqual(refGen.target, 'new');
  assert.strictEqual(refGen.intent, 'image_reference_gen');
  assert.deepStrictEqual(refGen.selectedIndexes, [1]);

  const promptFromImage = routeService.parseRouteResult(JSON.stringify({
    route: 'vision', image_source: 'current', selected_indexes: [1], confidence: 1,
  }), routeContext.normalizeRoute, { input: '根据这张图片生成提示词', attachments: currentImage, context: currentContext });
  assert.strictEqual(promptFromImage.mode, 'chat');
  assert.strictEqual(promptFromImage.operation.type, 'image_qa');
  assert.strictEqual(promptFromImage.target, 'none');
  assert.strictEqual(promptFromImage.intent, 'unknown');

  const multiAmbiguous = routeService.parseRouteResult(JSON.stringify({
    route: 'image_edit', image_source: 'current', selected_indexes: [], instruction: '改一下', confidence: 0.6,
  }), routeContext.normalizeRoute, { input: '把这张图改一下', attachments: [{ name: 'a.png', type: 'image/png', is_image: true }, { name: 'b.png', type: 'image/png', is_image: true }], context: { image_candidates: [] } });
  assert.strictEqual(multiAmbiguous.mode, 'chat');
  assert.strictEqual(multiAmbiguous.needClarification, true);
  assert.ok(multiAmbiguous.clarificationQuestion.includes('第几张'));
}

function testStructuredRouteDecisionCarriesRefs() {
  const imageRoute = routeContext.normalizeRoute({
    mode: 'edit_image',
    operation: { type: 'image_edit', scope: 'history', edit_instruction: '变成黑白色' },
    image_refs: [{ role: 'target', image_id: 'img_imgref_latest_1', reference_id: 'imgref_latest', index: 1, target: 'previous', source: 'history' }],
    edit_instruction: '变成黑白色',
    confidence: 0.92,
  }, 'chat');
  assert.strictEqual(imageRoute.mode, 'edit_image');
  assert.strictEqual(imageRoute.operation.type, 'image_edit');
  assert.strictEqual(imageRoute.imageRefs.length, 1);
  assert.deepStrictEqual(imageRoute.selectedIndexes, [1]);
  assert.deepStrictEqual(imageRoute.selectedImageIds, ['img_imgref_latest_1']);
  assert.strictEqual(imageRoute.selectedReferenceId, 'imgref_latest');
  assert.strictEqual(imageRoute.usePreviousImage, true);

  const fileRoute = routeContext.normalizeRoute({
    mode: 'chat',
    operation: { type: 'file_qa', scope: 'current' },
    file_refs: [{ role: 'source', file_id: 'att_1', index: 1, name: 'mail.txt', source: 'current' }],
    confidence: 0.9,
  }, 'chat');
  assert.strictEqual(fileRoute.mode, 'chat');
  assert.strictEqual(fileRoute.operation.type, 'file_qa');
  assert.strictEqual(fileRoute.fileRefs[0].file_id, 'att_1');
}

function testImagePromptExtractionStaysChatWithCurrentImage() {
  const parsed = routeService.parseRouteResult(JSON.stringify({
    mode: 'image',
    intent: 'image_reference_gen',
    operation: { type: 'image_reference_gen', scope: 'current', prompt: '根据图片生成提示词' },
    confidence: 0.9,
  }), routeContext.normalizeRoute, {
    input: '根据图片生成提示词',
    attachments: [{ name: 'room.png', type: 'image/png', is_image: true }],
    context: { image_candidates: [] },
  });
  assert.strictEqual(parsed.mode, 'chat');
  assert.strictEqual(parsed.operation.type, 'image_qa');
  assert.strictEqual(parsed.imageRefs.length, 1);
  assert.strictEqual(parsed.imageRefs[0].source, 'current');
  assert.strictEqual(parsed.imageRefs[0].target, 'uploaded');
  assert.deepStrictEqual(parsed.selectedIndexes, [1]);
}

function testImplicitImagePromptExtractionStaysChatWithCurrentImage() {
  assert.ok(routeService.isImplicitImagePromptExtractionInput('逆向生成提示词尽量详细'));
  const parsed = routeService.parseRouteResult(JSON.stringify({
    mode: 'edit_image',
    intent: 'image_edit',
    operation: { type: 'image_edit', scope: 'current', edit_instruction: '逆向生成提示词尽量详细' },
    confidence: 0.82,
  }), routeContext.normalizeRoute, {
    input: '逆向生成提示词尽量详细',
    attachments: [{ name: 'sunset.jpg', type: 'image/jpeg', is_image: true }],
    context: { image_candidates: [] },
  });
  assert.strictEqual(parsed.mode, 'chat');
  assert.strictEqual(parsed.operation.type, 'image_qa');
  assert.strictEqual(parsed.imageRefs.length, 1);
  assert.strictEqual(parsed.imageRefs[0].source, 'current');
  assert.strictEqual(parsed.imageRefs[0].target, 'uploaded');
}

function testNormalizeRouteKeepsExplicitImageQaChatDespiteImageIntent() {
  const parsed = routeContext.normalizeRoute({
    mode: 'chat',
    operation: { type: 'image_qa', scope: 'current', prompt: '逆向生成提示词要详细', edit_instruction: '' },
    image_refs: [{ role: 'reference', image_id: 'img_imgref_uploaded_3_1', reference_id: 'imgref_uploaded_3', index: 1, target: 'uploaded', source: 'current' }],
    file_refs: [],
    target: 'none',
    use_previous_image: false,
    selected_reference_id: 'imgref_uploaded_3',
    selected_indexes: [1],
    selected_image_ids: ['img_imgref_uploaded_3_1'],
    need_clarification: false,
    intent: 'image_reference_gen',
    contextual_image_prompt: '',
    tasks: ['根据用户上传图片进行视觉理解', '逆向生成详细图像提示词'],
    confidence: 0.95,
    evidence: '用户上传了一张图片并要求“逆向生成提示词要详细”，属于从图片反推/生成详细提示词，应进行图片理解而非生成新图。',
  }, 'chat');
  assert.strictEqual(parsed.mode, 'chat');
  assert.strictEqual(parsed.target, 'none');
  assert.strictEqual(parsed.operation.type, 'image_qa');
  assert.strictEqual(parsed.intent, 'unknown');
  assert.deepStrictEqual(parsed.selectedIndexes, [1]);
  assert.deepStrictEqual(parsed.selectedImageIds, ['img_imgref_uploaded_3_1']);
}

function testRouteOperationTypeDrivesCanonicalMode() {
  const imageQa = routeContext.normalizeRoute({
    mode: 'image',
    intent: 'image_reference_gen',
    operation: { type: 'image_qa', scope: 'current', prompt: '逆向生成提示词要详细' },
    image_refs: [{ image_id: 'img_imgref_uploaded_3_1', reference_id: 'imgref_uploaded_3', index: 1, target: 'uploaded', source: 'current' }],
    target: 'new',
  }, 'chat');
  assert.strictEqual(imageQa.mode, 'chat');
  assert.strictEqual(imageQa.intent, 'unknown');
  assert.strictEqual(imageQa.target, 'none');
  assert.strictEqual(imageQa.operation.type, 'image_qa');

  const imageEdit = routeContext.normalizeRoute({
    mode: 'chat',
    intent: 'unknown',
    operation: { type: 'image_edit', scope: 'current', edit_instruction: '把背景改成蓝色' },
    image_refs: [{ image_id: 'img_imgref_uploaded_1_1', reference_id: 'imgref_uploaded_1', index: 1, target: 'uploaded', source: 'current' }],
  }, 'chat');
  assert.strictEqual(imageEdit.mode, 'edit_image');
  assert.strictEqual(imageEdit.intent, 'image_edit');
  assert.strictEqual(imageEdit.operation.type, 'image_edit');
}

function testRoutePromptUsesEnglishRulesWithChineseEdgeCases() {
  const system = routeService.ROUTE_SYSTEM_PROMPT;
  assert.ok(system.includes('Return JSON only'));
  ['chat', 'vision', 'image_generate', 'image_edit', 'unclear', 'unsafe'].forEach(type => assert.ok(system.includes(type), `route protocol should define ${type}`));
  ['text_chat', 'file_qa', 'image_reference_generate', 'image_analyze', 'ocr', 'prompt_optimize', 'target_model', 'image_role', 'rewritten_prompt'].forEach(type => assert.ok(!system.includes(type), `route prompt should not expose legacy field/type ${type}`));
  assert.ok(system.includes('image_source'));
  assert.ok(system.includes('selected_indexes'));
  assert.ok(system.includes('use_previous_image'));
  assert.ok(system.includes('Input: current_input, attachments'));
  assert.ok(system.includes('Output exactly'));
  assert.ok(system.includes('Meanings: chat=text/file answer'));
  assert.ok(system.includes('do not infer file/image contents'));
  assert.ok(system.length < 2600, `route prompt should stay compact: ${system.length}`);
}

function testChatAnswerStreamingFlushesQuickly() {
  const source = fs.readFileSync(path.join(__dirname, '../client/app/chat-workflow.js'), 'utf8');
  assert.ok(source.includes('},{minIntervalMs:40}),S=createRealtimeRenderer'), 'answer stream renderer should flush faster than the old 140ms cadence');
  assert.ok(!source.includes('},{minIntervalMs:140}),S=createRealtimeRenderer'), 'answer stream renderer should not use the old 140ms cadence');
}

function testStreamingTailDoesNotRenderCursor() {
  const css = fs.readFileSync(path.join(__dirname, '../styles/flat-theme.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../client/app/markdown/browser-streaming-renderer.js'), 'utf8');
  const sanitizer = fs.readFileSync(path.join(__dirname, '../client/app/markdown/browser-sanitizer.js'), 'utf8');
  assert.ok(!renderer.includes('streaming-tail'));
  assert.ok(!renderer.includes('data-markdown-streaming-tail'));
  assert.ok(!sanitizer.includes('data-markdown-streaming-tail'));
  assert.ok(!css.includes('.streaming-tail'));
  assert.ok(!css.includes('@keyframes streaming-caret-neon'));
  assert.ok(!css.includes('animation: streaming-caret-neon'));
}


function testSessionTailFocusPreservesBottomGapDuringDynamicLayout() {
  const source = fs.readFileSync(path.join(__dirname, '../client/app/scroll-focus-workflow.js'), 'utf8');
  assert.ok(source.includes('function focusSessionTail') && source.includes('activateBottomScrollLock(options)'), 'tail focus should activate the bottom-lock implementation');
  assert.ok(source.includes('function activateBottomScrollLock') && source.includes('scrollMessagesToBottom') && source.includes('requestBottomScroll'), 'bottom lock should scroll to the real list bottom through a rAF-batched path');
  assert.ok(source.includes('function scheduleSessionTailFocusAfterLayout'), 'layout-settled tail focus scheduler should exist');
  assert.ok(source.includes('new ResizeObserver') && source.includes('requestBottomScroll({ reason: "resize-observer", beforePaint: true })'), 'ResizeObserver should keep the bottom locked before paint when async Markdown changes height');
  assert.ok(source.includes('function syncLockedBottomBeforePaint') && source.includes('heightChanged') && source.includes('writeThreshold: 0'), 'height changes should be compensated synchronously before the next paint to reduce visible jitter');
  assert.ok(source.includes('.markdown-mermaid-pending,svg,canvas'), 'layout observer should watch chart/svg/canvas height changes');
  assert.ok(source.includes('viewBox') && source.includes('data-mermaid-rendered'), 'mutation observer should catch chart render attribute changes');
  assert.ok(!/setTimeout\s*\(/.test(source), 'bottom lock should not depend on hard-coded setTimeout delays');
  assert.ok(source.includes('requestAnimationFrame') && source.includes('bottomLockRaf'), 'bottom scroll writes should still have a requestAnimationFrame final correction pass');
}

function testSessionSwitchFocusesBottom() {
  const source = fs.readFileSync(path.join(__dirname, '../client/app/session-ui-workflow.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../styles/flat-theme.css'), 'utf8');
  assert.ok(source.includes('switchSession(session.id)'), 'session tabs should use the normal v1.3.25 switchSession path instead of an extra override layer');
  assert.ok(!source.includes('switchSessionToBottom'), 'session-ui should not contain the later switch-bottom wrapper');
  const removedOverride = ['session', 'switch', 'override'].join('-') + '.js';
  assert.ok(!index.includes(removedOverride), 'the extra capture-phase session switch override should not be loaded');
  assert.ok(app.includes('scheduleSessionTailFocusAfterLayout') && app.includes('reason:"switch-bottom"'), 'renderActiveSession should still pin the latest tail after a switch');
  assert.ok(css.includes('scroll-behavior:auto!important;'), 'session switch should disable smooth scroll behavior');
}

function testLegacyWelcomeScreenIsRemoved() {
  const files = ['../index.html', '../app.js', '../styles.css', '../styles/flat-theme.css'];
  const legacyNeedles = [
    ['empty', 'welcome'].join('-'),
    ['welcome', 'title'].join('-'),
    ['welcome', 'sub'].join('-'),
    ['welcome', 'note'].join('-'),
    ['render', 'Empty', 'Welcome'].join(''),
    String.fromCodePoint(26497, 31616, 32842, 22825, 24037, 20855),
    ['ChatUI', String.fromCodePoint(26497, 31616)].join(''),
    String.fromCodePoint(22885, 21746, 65, 73),
    String.fromCodePoint(20154, 20026, 32534, 30721, 37327),
    String.fromCodePoint(19987, 27880, 23545, 35805),
    String.fromCodePoint(28789, 24863, 29983, 22270),
  ];
  for (const rel of files) {
    const source = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    for (const needle of legacyNeedles) {
      assert.ok(!source.includes(needle), `legacy welcome residue should be removed from ${rel}: ${needle}`);
    }
  }
}

function testHistoryRenderLoadsNewestMessagesFirst() {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.ok(source.includes('function renderCanonicalMessagesNewestFirst'), 'history render should have a newest-first loader');
  assert.ok(source.includes('for(let a=i;a<n.length;a+=1)renderMessageFromCanonical(e,n[a],a)'), 'initial history render should render the latest tail first');
  assert.ok(source.includes('chooseHistoryTailStart'), 'initial history render should choose a bounded tail window instead of rendering all history');
  assert.ok(source.includes('requestAnimationFrame?requestAnimationFrame(()=>requestAnimationFrame(u)):u()') && source.includes('addEventListener("scroll",d,{passive:!0})'), 'older history listener should be attached only after initial bottom pin frames settle');
  assert.ok(source.includes('for(let t=r-1;t>=m;t-=1)prependRenderedCanonicalMessage(renderMessageFromCanonical(e,n[t],t))'), 'older history should be prepended backwards from the current tail start');
  assert.ok(source.includes('s.scrollTop=q+e'), 'prepended history should compensate scrollTop by the scrollHeight delta');
  assert.ok(source.includes('const c=()=>') && source.includes('s.innerHTML="",markMessagesSession(e)'), 'history tail render should self-repair if boot-time welcome rendering races it');
  assert.ok(source.includes('const q=t.role==="user"?t.messageIndex'), 'display cache matching should use canonical message/response indexes, not tail-window offsets');
  assert.ok(source.includes('renderCanonicalMessagesNewestFirst(t,state.messages),restorePendingDisplayItems'), 'loadChatHistory should use newest-first render instead of full chronological render');
  assert.ok(source.includes('dataset?.tailFirstHistory==="1")return'), 'canonical repair should not fight tail-first history rendering');
  assert.ok(source.includes('dataset?.historyBackfill==="1")return'), 'canonical repair should not fight in-progress reverse backfill');
  const perf = fs.readFileSync(path.join(__dirname, '../client/app/performance-workflow.js'), 'utf8');
  assert.ok(perf.includes('virtualMessages: false'), 'legacy virtualizer should be disabled for deterministic tail-first history rendering');
  const css = fs.readFileSync(path.join(__dirname, '../styles/flat-theme.css'), 'utf8');
  assert.ok(css.includes('min-height:0!important;') && css.includes('height:100%!important;') && css.includes('overflow-y:auto!important;'), 'messages container should be constrained as an internal scroller');
}

function testStreamingAllowsManualScroll() {
  const source = fs.readFileSync(path.join(__dirname, '../client/app/scroll-focus-workflow.js'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(__dirname, '../client/app/bootstrap-workflow.js'), 'utf8');
  assert.ok(source.includes('event?.type === "wheel"') && source.includes('event?.type === "touchstart"') && source.includes('event?.type === "pointerdown"'), 'wheel/touch/pointer gestures should be treated as manual scroll intent');
  assert.ok(source.includes('manualAutoFollowSuppressUntil') && source.includes('cancelBottomScrollFrame()'), 'upward manual intent should pause auto-follow immediately so wheel scrolling is not fought by layout corrections');
  assert.ok(source.includes('now() < state.programmaticScrollUntil'), 'programmatic scroll suppression window should exist');
  assert.ok(source.includes('manualIntent && event?.type === "scroll" && gap > threshold') && source.includes('releaseBottomScrollLock'), 'scroll events should release or restore the bottom lock by 24px distance');
  assert.ok(source.includes('state.streamFocusLocked = false') && source.includes('state.userScrollLocked = true'), 'manual scroll should release streaming follow and lock user position');
  assert.ok(bootstrap.includes('bindMessageScrollIntent') && bootstrap.includes('m.addEventListener(t,markManualMessageScroll') && bootstrap.includes('window.addEventListener(t,markManualMessageScroll'), 'message scroll intent must be bound to the scroll container and window gestures');
}

function testLargeMarkdownInitialRenderIsProgressive() {
  const message = fs.readFileSync(path.join(__dirname, '../client/app/message-workflow.js'), 'utf8');
  const perf = fs.readFileSync(path.join(__dirname, '../client/app/performance-workflow.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../styles/flat-theme.css'), 'utf8');
  assert.ok(message.includes('function addMessageProgressive'), 'message creation should use a progressive render-capable addMessage path');
  assert.ok(message.includes('renderMarkdownProgressively(node, String(rawText || ""), node.dataset.rawHash)'), 'large initial assistant Markdown should render progressively after DOM insertion');
  assert.ok(message.includes('function updatePlainMarkdownStream'), 'large streaming Markdown should have a lightweight plain-text append path');
  assert.ok(message.includes('chatStream && shouldProgressiveRenderMarkdown(rawValue)'), 'large streaming Markdown should bypass full Markdown rendering while tokens arrive');
  assert.ok(message.includes('dataset.markdownFinalMode = "progressive-final"'), 'large streaming Markdown finalization should switch to progressive final rendering');
  assert.ok(css.includes('.markdown-stream-plain') && css.includes('white-space:pre-wrap!important;'), 'plain streaming Markdown should be styled as readable pre-wrapped text');
  assert.ok(message.includes('addMessage: addMessageProgressive'), 'workflow should export the progressive addMessage implementation');
  assert.ok(!perf.includes("if (raw.length > 8000 || raw.split('\\n').length > 180) return true;"), 'large Markdown should not be forced into lazy placeholder rendering');
}

function testEnglishImagePromptExtractionStaysChatWithCurrentImage() {
  const parsed = routeService.parseRouteResult(JSON.stringify({
    mode: 'image',
    intent: 'image_reference_gen',
    operation: { type: 'image_reference_gen', scope: 'current', prompt: 'generate a prompt from this image' },
    confidence: 0.9,
  }), routeContext.normalizeRoute, {
    input: 'generate a prompt from this image',
    attachments: [{ name: 'room.png', type: 'image/png', is_image: true }],
    context: { image_candidates: [] },
  });
  assert.strictEqual(parsed.mode, 'chat');
  assert.strictEqual(parsed.operation.type, 'image_qa');
  assert.strictEqual(parsed.imageRefs.length, 1);
  assert.strictEqual(parsed.imageRefs[0].source, 'current');
}

function testImageOnlyAssistantMessageCanBeQuotedWithImageContext() {
  const state = { activeSessionId: 's1', quotedMessage: null };
  const node = {
    classList: { contains: name => name === 'assistant', add: () => {}, remove: () => {} },
    dataset: { responseIndex: '1', rawText: '[base64 image] [base64 image] 耗时：1m 29s' },
    __displayItem: {},
    querySelector: () => null,
    textContent: '',
  };
  const workflow = messageWorkflow.createMessageWorkflow({
    state,
    document: { querySelectorAll: () => [] },
    $: id => id === 'prompt' ? ({ focus: () => {} }) : null,
    getAssistantImageContext: () => ({
      prompt: '生成两张圆形图片',
      mode: 'image',
      target: 'previous',
      referenceId: 'imgref_latest',
      attachments: [
        { name: 'red.png', type: 'image/png', src: 'indexeddb://red', imageId: 'img_imgref_latest_1', referenceId: 'imgref_latest' },
        { name: 'yellow.png', type: 'image/png', src: 'indexeddb://yellow', imageId: 'img_imgref_latest_2', referenceId: 'imgref_latest' },
      ],
    }),
  });
  workflow.selectQuotedMessage(node);
  assert.ok(state.quotedMessage, 'image-only assistant message should be quoteable');
  assert.strictEqual(state.quotedMessage.content, '[图片消息]');
  const parsed = JSON.parse(state.quotedMessage.imageContext);
  assert.strictEqual(parsed.attachments.length, 2);
  assert.strictEqual(parsed.attachments[1].imageId, 'img_imgref_latest_2');
}

function testEmptyAssistantImageContextFallsBackToGeneratedThumbs() {
  const state = { activeSessionId: 's1', quotedMessage: null, sessions: [{ id: 's1', messages: [], display: [] }] };
  const emptyImageContext = JSON.stringify({ prompt: '生成两张图', mode: 'image', target: 'new', attachments: [] });
  const node = {
    classList: { contains: name => name === 'assistant', add: () => {}, remove: () => {} },
    dataset: { responseIndex: '1', rawText: '[base64 image] 耗时：1s', imageContext: emptyImageContext },
    __displayItem: { imageContext: emptyImageContext },
    querySelector: () => null,
    textContent: '',
  };
  const workflow = messageWorkflow.createMessageWorkflow({
    state,
    document: { querySelectorAll: () => [] },
    $: () => null,
    getAssistantImageContext: () => ({
      prompt: '生成两张图',
      mode: 'image',
      target: 'previous',
      referenceId: 'imgref_latest',
      attachments: [
        { name: 'one.png', type: 'image/png', src: 'indexeddb://one', imageId: 'img_imgref_latest_1', referenceId: 'imgref_latest' },
        { name: 'two.png', type: 'image/png', src: 'indexeddb://two', imageId: 'img_imgref_latest_2', referenceId: 'imgref_latest' },
      ],
    }),
  });
  const quote = workflow.resolveQuoteContextForNode(node);
  assert.strictEqual(quote.content, '[图片消息]');
  const parsed = JSON.parse(quote.imageContext);
  assert.strictEqual(parsed.attachments.length, 2);
  assert.strictEqual(parsed.attachments[1].imageId, 'img_imgref_latest_2');
}

function testQuoteResolverUsesCanonicalAndDisplayContext() {
  const imageContext = JSON.stringify({
    prompt: '生成两张图',
    mode: 'image',
    target: 'previous',
    referenceId: 'imgref_latest',
    attachments: [{ name: 'second.png', type: 'image/png', src: 'indexeddb://second', imageId: 'img_imgref_latest_2', referenceId: 'imgref_latest' }],
  });
  const attachmentContext = JSON.stringify({ attachments: [{ id: 'att_1', name: 'a.txt', type: 'text/plain', text: 'hello' }] });
  const state = {
    activeSessionId: 's1',
    quotedMessage: null,
    sessions: [{
      id: 's1',
      messages: [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: '[图片生成完成]', rawText: '[base64 image] RT 1s', imageContext },
      ],
      display: [{ id: 'd1', role: 'assistant', responseIndex: '1', rawText: '[base64 image] TTFT 1s', attachmentContext }],
    }],
  };
  const workflow = messageWorkflow.createMessageWorkflow({ state, document: { querySelectorAll: () => [] }, $: () => null });
  const node = { classList: { contains: name => name === 'assistant', add: () => {}, remove: () => {} }, dataset: { displayItemId: 'd1', responseIndex: '1' }, __displayItem: null, querySelector: () => null, textContent: '' };
  const quote = workflow.resolveQuoteContextForNode(node);
  assert.strictEqual(quote.content, '[图片消息]');
  assert.strictEqual(JSON.parse(quote.imageContext).attachments[0].imageId, 'img_imgref_latest_2');
  assert.strictEqual(JSON.parse(quote.attachmentContext).attachments[0].id, 'att_1');
}

function decodeXmlEntities(value = '') {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function inlineCellValues(sheetXml = '') {
  return [...String(sheetXml).matchAll(/<c[^>]*(?:t="inlineStr")?[^>]*>(?:<is><t>(.*?)<\/t><\/is>|<v>(.*?)<\/v>)<\/c>/g)]
    .map(match => decodeXmlEntities(match[1] ?? match[2] ?? ''));
}

async function testDepartmentExportWorkbookShape() {
  const workbook = await usageExportXlsx.buildDepartmentExportWorkbook(
    '今日排行',
    [{ department_id: 'dept-1', department_name: '研发部', total_tokens: 100, prompt_tokens: 60, completion_tokens: 40, prompt_cached_tokens: 20, completion_reasoning_tokens: 5 }],
    { 'dept-1': [{ username: '张三', total_tokens: 80, prompt_tokens: 50, completion_tokens: 30, prompt_cached_tokens: 10, completion_reasoning_tokens: 2 }] },
    { start_time: new Date('2026-06-12T00:00:00+08:00'), end_time: new Date('2026-06-12T13:00:05+08:00') }
  );
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(workbook);
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  assert.ok(workbookXml.includes('部门今日排行统计'));
  assert.ok(workbookXml.includes('研发部今日排行统计'));
  const sheet1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const values = inlineCellValues(sheet1);
  assert.strictEqual(values.slice(0, 9).join('|'), '序号|部门名称|开始时间|结束时间|总用量|输入|输出|缓存输入|推理输出');
  assert.strictEqual(values[9], '1');
  assert.strictEqual(values[10], '研发部');
  assert.strictEqual(values[11], '2026-06-12 00:00:00');
  assert.strictEqual(values[12], '2026-06-12 13:00:05');
  assert.ok(!values.includes('部门主键'));
  assert.ok(!values.includes('dept-1'));
}

function testUsageRangesAreCentralized() {
  assert.deepStrictEqual(usageRanges.PERSONAL_RANGES, ['today', 'yesterday', 'total']);
  assert.deepStrictEqual(usageRanges.DEPARTMENT_RANGES, ['today', 'yesterday', 'month', 'last_month', 'total']);
  assert.strictEqual(usageRanges.isPersonalRange('month'), false);
  assert.strictEqual(usageRanges.isDepartmentRange('month'), true);
  for (const range of usageRanges.DEPARTMENT_RANGES) {
    assert.ok(usageRanges.DEPARTMENT_RANGE_FILTERS[range], `missing department filter for ${range}`);
    assert.ok(usageRanges.DEPARTMENT_RANGE_BOUNDS_SQL[range], `missing department bounds sql for ${range}`);
    assert.ok(usageRanges.DEPARTMENT_RANGE_LABELS[range], `missing department label for ${range}`);
  }
}

function testUsageStatsFrontendHelpers() {
  assert.strictEqual(usageStatsFormat.formatTokens(1234567), '1.23M');
  assert.strictEqual(usageStatsFormat.formatPercent(12.3), '12.3%');
  assert.strictEqual(usageStatsFormat.cachePercent({ prompt_cached_tokens: 25, prompt_tokens: 100 }), 25);
  assert.strictEqual(usageStatsFormat.escapeHtml('<x>'), '&lt;x&gt;');
  assert.strictEqual(usageStatsAuth.shouldLoadRanking('abc'), true);
  assert.strictEqual(usageStatsAuth.shouldLoadRanking('  '), false);
  const store = new Map();
  const storage = { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
  storage.setItem(usageStatsAuth.CONFIG_KEY, JSON.stringify({ apiKey: 'key-from-storage' }));
  assert.strictEqual(usageStatsAuth.currentApiKey({ getElement: () => ({ value: '' }), storage }), 'key-from-storage');
  usageStatsAuth.setDepartmentPassword('dep-pass', storage);
  assert.strictEqual(usageStatsAuth.getDepartmentPassword(storage), 'dep-pass');
  usageStatsAuth.clearDepartmentPassword(storage);
  assert.strictEqual(usageStatsAuth.getDepartmentPassword(storage), '');
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

function testSessionPromptDraftPersistsPerSession() {
  const store = new Map();
  const storage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  };
  const state = { sessions: [], activeSessionId: '', models: [] };
  const sessionA = { ...appState.createSession('A', () => 1000, () => 0.111111), id: 'session-a', promptDraft: 'A 草稿' };
  const sessionB = { ...appState.createSession('B', () => 2000, () => 0.222222), id: 'session-b', promptDraft: 'B 草稿' };
  state.sessions = [sessionA, sessionB];
  state.activeSessionId = sessionA.id;
  const workflow = sessionDisplay.createSessionDisplayWorkflow({
    getState: () => state,
    getActiveSession: () => state.sessions.find(item => item.id === state.activeSessionId),
    createSession: appState.createSession,
    deriveSessionTitle: session => session.title || '新对话',
    sessionStorageKey: (key, sessionId = state.activeSessionId) => `${key}:${sessionId}`,
    readJsonStorage: (key, fallback) => { try { return JSON.parse(storage.getItem(key) || ''); } catch { return fallback; } },
    safeSetJsonStorage: (key, value) => { storage.setItem(key, JSON.stringify(value)); return value; },
    compactDisplayItems: items => items,
    compactAdjacentDuplicateMessages: messages => messages,
    sanitizeStoredDisplayItem: item => item,
    sanitizeStoredMessage: message => message,
    renderSessionList: () => {},
    makeDisplayItemId: () => 'display-id',
    localStorage: storage,
    constants: { SESSIONS_KEY: 'sessions', ACTIVE_SESSION_KEY: 'active' },
  });
  workflow.saveSessionsMeta();
  const meta = JSON.parse(storage.getItem('sessions'));
  assert.strictEqual(meta.find(item => item.id === 'session-a').promptDraft, 'A 草稿');
  assert.strictEqual(meta.find(item => item.id === 'session-b').promptDraft, 'B 草稿');

  state.sessions = [];
  state.activeSessionId = '';
  workflow.loadSessions();
  assert.strictEqual(state.sessions.find(item => item.id === 'session-a').promptDraft, 'A 草稿');
  assert.strictEqual(state.sessions.find(item => item.id === 'session-b').promptDraft, 'B 草稿');
}

function testLegacyDocSupportIsRoutedToWordExtractor() {
  assert.strictEqual(extractApi.fileKind('Mysql实用手册.doc', 'application/msword'), 'office');
  assert.strictEqual(require('../client/app/attachments-workflow').canExtractOfficeText({ name: 'Mysql实用手册.doc', type: 'application/msword' }), true);
  assert.strictEqual(typeof officeExtract.extractLegacyDocWithWordExtractor, 'function');
}

function testResponseMetricsTextIsUnified() {
  assert.strictEqual(formatting.responseMetricsText({ firstTokenMs: 37, durationMs: 5678 }), 'TTFT 37ms · RT 5.7s');
  assert.strictEqual(formatting.responseMetricsText({ firstTokenMs: 1234, durationMs: 5678 }), 'TTFT 1.2s · RT 5.7s');
  assert.strictEqual(formatting.responseMetricsText({ durationMs: 61000, includeFirstToken: false }), 'RT 1m 1s');
  const metrics = require('../client/services/chat-service').extractChatJobText({ metrics: { firstTokenMs: 100, durationMs: 220 }, choices: [{ message: { content: 'ok' } }] });
  assert.strictEqual(metrics.firstTokenMs, 100);
  assert.strictEqual(metrics.durationMs, 220);
}

function testResponsesDirectDoesNotRegisterManagedChatJob() {
  const source = fs.readFileSync(path.join(__dirname, '../client/app/chat-workflow.js'), 'utf8');
  assert.ok(source.includes('useResponsesDirect=shouldUseResponsesReasoning'), 'Responses path should be decided before chat-job allocation');
  assert.ok(source.includes('useManagedChatJob=!useResponsesDirect'), 'Responses direct stream must not use managed chat-job lifecycle');
  assert.ok(source.includes('let f=useManagedChatJob?(n.clientJobId||u?.jobId||makeClientChatJobId()):null'), 'chat job id should only exist for managed chat/completions stream');
  assert.ok(source.includes('if(useResponsesDirect){f&&(delete u.jobId,persistSessionDisplay(i),clearChatJob?.(i));const Q=async e=>streamChatCompletions'), 'Responses stream should use the direct stream branch');
  assert.ok(source.includes('N=useResponsesDirect'), 'fallback branch should keep the same transport family and avoid recomputing into another job path');
}

function testTtftStartsAtServerForwardStart() {
  const serverSource = fs.readFileSync(path.join(__dirname, '../server/jobs/chat.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.ok(serverSource.includes('job.serverStartAtMs = performance.now()'), 'managed chat job should record high precision server forward start');
  assert.ok(serverSource.includes('job.firstTokenMs = elapsedSince(job.serverStartAtMs)'), 'managed chat job first token should be measured from server forward start');
  assert.ok(appSource.includes('serverFirstTokenMs=a.firstTokenMs'), 'Responses direct stream should preserve server-side firstTokenMs from compact SSE');
  assert.ok(appSource.includes('serverDurationMs=a.durationMs'), 'Responses direct stream should preserve server-side durationMs from compact SSE');
}

function testResponsesCompactFtIsNeverZero() {
  const normalizer = responsesStream.createResponsesCompactStreamNormalizer({ now: (() => {
    const values = [1000, 1000, 1050];
    return () => values.shift() ?? 1000;
  })() });
  const out = normalizer.push('event: response.reasoning_summary_text.delta\ndata: {"delta":"hello"}\n\n');
  const payload = JSON.parse(out.match(/data: (.+)/)[1]);
  assert.strictEqual(payload.r, 'hello');
  assert.strictEqual(payload.ft, 1);
  const done = normalizer.end();
  const donePayload = JSON.parse(done.match(/data: (.+)/)[1]);
  assert.strictEqual(donePayload.done, 1);
  assert.strictEqual(donePayload.rt, 50);
}

function testFileUploadReturnsFocusToComposerSubmitPath() {
  const bootstrapSource = fs.readFileSync(path.join(__dirname, '../client/app/bootstrap-workflow.js'), 'utf8');
  const attachmentSource = fs.readFileSync(path.join(__dirname, '../client/app/attachments-workflow.js'), 'utf8');
  assert.ok(bootstrapSource.includes('e.target.value="",updateSendAvailability?.();const t=$("prompt"),s=$("sendBtn"),n=t&&!t.disabled?t:s,o=()=>n?.focus?.();(window.requestAnimationFrame||window.setTimeout).call(window,o,0),window.setTimeout.call(window,o,80)'), 'file input change should move focus away from file button/input to prompt or send button with browser-bound timers');
  assert.ok(attachmentSource.includes('root.requestAnimationFrame.call(root, focus)'), 'attachment workflow should call requestAnimationFrame with the window/root binding');
  assert.ok(attachmentSource.includes('function focusComposerSubmitTarget()'), 'attachment workflow should centralize post-upload focus restore');
  assert.ok(attachmentSource.includes('finishUploadProgressSoon();\n      focusComposerSubmitTarget();'), 'addFiles completion should restore focus to composer submit target');
}

function testImageBubblesAreShrinkWrapped() {
  const source = fs.readFileSync(path.join(__dirname, '../styles/flat-theme.css'), 'utf8');
  assert.ok(source.includes('.message .content:has(.user-attachment-preview-grid),') && source.includes('.message .content:has(.generated-image-grid){') && source.includes('width:fit-content!important;'), 'image message content should be shrink-wrapped instead of full-width');
  assert.ok(source.includes('.message.user .bubble:has(.user-attachment-preview-grid),') && source.includes('.message.assistant .bubble:has(.generated-image-grid),') && source.includes('.message.error .bubble:has(.generated-image-grid){'), 'image bubbles should be shrink-wrapped to the image grid');
  assert.ok(source.includes('width:fit-content!important;') && source.includes('max-width:100%!important;') && source.includes('min-width:0!important;'), 'image grids should use fit-content width with max-width guard');
}

function testMarkdownTablesShrinkToContent() {
  const source = fs.readFileSync(path.join(__dirname, '../styles/flat-theme.css'), 'utf8');
  assert.ok(source.includes('.markdown-body .table-wrapper') && source.includes('width:100%!important;') && source.includes('overflow-x:auto!important;'), 'table wrapper should fill the message width and scroll when needed');
  assert.ok(source.includes('.markdown-body table') && source.includes('width:max-content!important;') && source.includes('min-width:100%!important;'), 'tables should fill available width while allowing wider content to scroll');
}

function testMarkdownTableAlignmentUsesRendererSemantics() {
  const html = markdownEngine.renderMarkdown('| Left | Center | Right |\n|:---|:---:|---:|\n| a | b | c |');
  assert.ok(html.includes('class="md-align-left"'), 'left-aligned markdown table cells should keep semantic alignment class');
  assert.ok(html.includes('class="md-align-center"'), 'center-aligned markdown table cells should keep semantic alignment class');
  assert.ok(html.includes('class="md-align-right"'), 'right-aligned markdown table cells should keep semantic alignment class');
  assert.ok(!/text-align\s*:/i.test(html), 'renderer should not rely on inline text-align styles after normalization');
  const css = fs.readFileSync(path.join(__dirname, '../styles/flat-theme.css'), 'utf8');
  assert.ok(css.includes('.markdown-body th.md-align-center') && css.includes('text-align:center!important;'), 'theme should map md-align-center to centered cells');
  assert.ok(css.includes('.markdown-body th.md-align-right') && css.includes('text-align:right!important;'), 'theme should map md-align-right to right-aligned cells');
  assert.ok(css.indexOf('.markdown-body th.md-align-center') < css.indexOf('/* User actions belong under the user bubble'), 'markdown table alignment should live with the table theme rules, not as a late tail override');
  assert.ok(!css.includes('text-align:left!important;\n  vertical-align:top!important;'), 'theme must not force every markdown table cell to left alignment');
}

function testMarkdownDetailsPreserveOpenAttribute() {
  const browserSanitizer = fs.readFileSync(path.join(__dirname, '../client/app/markdown/browser-sanitizer.js'), 'utf8');
  const nodeSanitizer = fs.readFileSync(path.join(__dirname, '../client/app/markdown/sanitizer.js'), 'utf8');
  assert.ok(browserSanitizer.includes("'details', 'summary'") && browserSanitizer.includes("'open'"), 'browser sanitizer should preserve details/summary and open attribute');
  assert.ok(nodeSanitizer.includes("'details', 'summary'") && nodeSanitizer.includes("'open'"), 'node sanitizer should preserve details/summary and open attribute');
}

function testMarkdownDetailsUseNativeCollapsedSemantics() {
  const shorthand = markdownSourceNormalizer.normalizeMarkdownSource('::: details 点击展开详情\n这里是折叠内容。\n\n- 可以包含 **Markdown**\n:::');
  assert.ok(shorthand.includes('<details>') && shorthand.includes('<summary>点击展开详情</summary>') && shorthand.includes('</details>'), 'details container shorthand should normalize into native details/summary tags');
  const html = markdownEngine.renderMarkdown('<details>\n<summary>点击展开详情</summary>\n这里是折叠内容。\n\n- 可以包含 **Markdown**\n</details>');
  assert.ok(html.includes('<details>') && html.includes('<summary>点击展开详情</summary>'), 'renderer should preserve native details and summary');
  assert.ok(html.includes('<strong>Markdown</strong>'), 'markdown inside details should still render after normalization inserts the required blank line');
  const css = fs.readFileSync(path.join(__dirname, '../styles/flat-theme.css'), 'utf8');
  assert.ok(css.includes('.markdown-body details:not([open]) > :not(summary)') && css.includes('display:none!important;'), 'closed details should hide non-summary children with component semantics');
}

function testMermaidAutoRenderIsDefaultForFinalMarkdown() {
  const workflow = fs.readFileSync(path.join(__dirname, '../client/app/message-workflow.js'), 'utf8');
  const performance = fs.readFileSync(path.join(__dirname, '../client/app/performance-workflow.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.ok(workflow.includes('autoRenderMermaid: true'), 'message workflow should request Mermaid auto rendering for final assistant markdown');
  assert.ok(workflow.includes('forceMermaid: true'), 'final assistant markdown should render all Mermaid diagrams by default, not only visible ones');
  assert.ok(workflow.includes('autoRenderMermaid: !!phase.final') && workflow.includes('forceMermaid: !!phase.final'), 'streaming renderer should defer Mermaid during streaming and auto render all diagrams on final');
  assert.ok(performance.includes('autoRenderMermaid: true') && performance.includes('forceMermaid: true'), 'lazy markdown rendering should auto render Mermaid once materialized');
  assert.ok(app.includes('autoRenderMermaid:!0') && app.includes('forceMermaid:!0'), 'visible markdown rerender should keep Mermaid default rendering behavior');
  assert.ok(!workflow.includes('enhanceRenderedMarkdown(n,{skipMermaid:!0,allowResourceLoad:!0})'), 'final addMessage path must not hard-disable Mermaid rendering');
}

function testLargeMarkdownCompletionRefocusesTail() {
  const workflow = fs.readFileSync(path.join(__dirname, '../client/app/message-workflow.js'), 'utf8');
  const enhancer = fs.readFileSync(path.join(__dirname, '../client/app/markdown/enhancer.js'), 'utf8');
  assert.ok(workflow.includes('refocusTailAfterMarkdownLayout'), 'large progressive markdown completion should refocus the session tail');
  assert.ok(workflow.includes('await Promise.resolve(enhancePromise)') && workflow.includes('content.replaceChildren(...[...stageContent.childNodes])'), 'large markdown final rendering should complete offscreen before one visible replacement');
  assert.ok(workflow.includes('progressiveOffscreen') && workflow.includes('progressiveStage'), 'large markdown final rendering should use an offscreen stage instead of progressively mutating the visible bubble');
  assert.ok(workflow.includes('deps.focusSessionTail?.({ margin: 18, threshold: 12 })'), 'tail refocus should use the same visual bottom target as session switching');
  assert.ok(workflow.includes('shouldAutoRefocusTail') && workflow.includes('!deps.state?.userScrollLocked'), 'progressive markdown completion must not refocus the tail after the user scrolls up');
  assert.ok(!workflow.includes('deps.state.userScrollLocked = false'), 'progressive markdown completion must not forcibly clear the user scroll lock');
  assert.ok(!workflow.includes('[80, 220, 520, 1000, 1800, 3200].forEach'), 'progressive markdown completion must not use delayed forced tail refocus timers');
  assert.ok(!workflow.includes('content.append(...batch)'), 'progressive markdown completion must not append final HTML batches into the visible message content');
  assert.ok(enhancer.includes("chatui:markdown-layout-settled") && enhancer.includes("reason: 'mermaid-rendered'"), 'Mermaid rendering completion should emit a markdown layout settled event');
}

function testStreamingDownloadActionIsDisabled() {
  const css = fs.readFileSync(path.join(__dirname, '../styles/flat-theme.css'), 'utf8');
  assert.ok(css.includes('.message[data-streaming="1"] .download-answer-btn'), 'download button should be hidden while streaming');
  assert.ok(css.includes('pointer-events:none!important;'), 'streaming actions should not receive pointer events');
}

function testResumeStreamingDoesNotUseStatusTextAsOffset() {
  const source = fs.readFileSync(path.join(__dirname, '../client/app/job-resume-workflow.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.ok(source.includes('isChatStatusText(e)?"":e'), 'resume offsets should ignore transient status text');
  assert.ok(source.includes('r();try{const t=getConfig()'), 'resume should immediately paint a non-empty status instead of waiting blank');
  assert.ok(source.includes('if(!m.content&&!m.reasoning){try{const e=l(await getChatJob(s.id,{resumeOffsets:R()}))'), 'empty compact done events should refetch the final job snapshot');
  assert.ok(app.includes('resumeSessionJobs(t.id)}'), 'session render should always attempt to rebind or resume pending jobs after switch/render');
  assert.ok(app.includes('state.pageUnloading=!1;const t=loadImageJob'), 'resume should clear stale page-unloading state after refresh/pageshow');
  assert.ok(app.includes('if(s?.id){if(sessionHasCompletedAssistantForResponse(n,s.responseIndex))return clearChatJob(e);return void setTimeout(()=>resumeChatJob(e),0)}'), 'chat resume should be keyed by the stored job response index, not only by user/assistant counts');
  assert.ok(app.includes('pendingJob&&resumeSessionJobs(e);try{'), 'foreground refresh should resume pending jobs even when busy state was lost after reload');
}

function testChatJobIdIsPersistedBeforeRouteResolution() {
  const submit = fs.readFileSync(path.join(__dirname, '../client/app/submit-workflow.js'), 'utf8');
  const chat = fs.readFileSync(path.join(__dirname, '../client/app/chat-workflow.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const prepareIndex = submit.indexOf('const prepareManagedChatJobForLiveItem=()=>');
  const routeIndex = submit.indexOf('routeInfo=await getEffectiveRoute');
  assert.ok(prepareIndex >= 0 && routeIndex > prepareIndex, 'submit should prepare and persist a managed chat job id before route resolution can be interrupted by refresh');
  assert.ok(submit.includes('saveChatJob(sessionId,{id:preparedChatJobId,prompt:promptText,startedAt:Date.now(),displayItemId:liveItem.id||"",responseIndex,mode:"chat"})'), 'submit should immediately save the client chat job id with display item and response index');
  assert.ok(submit.includes('await sendChat(chatPrompt,chatAttachments,assistantNode,{sessionId,userAlreadyAdded:!0,liveItem,replaceAssistantIndex:replacement?.responseIndex,requestBaseMessages,quotedMessage,clientJobId:preparedChatJobId})'), 'sendChat should receive the pre-persisted job id instead of allocating a second id');
  assert.ok(chat.includes('let f=useManagedChatJob?(n.clientJobId||u?.jobId||makeClientChatJobId()):null'), 'chat workflow should reuse the pre-persisted job id and only allocate a fallback when absent');
  assert.ok(chat.includes('persistChatJobSnapshot') && chat.includes('deps.saveChatJobWithMedia(sessionId, { ...job, payload })'), 'chat workflow should enrich the same job record with payload once the final payload exists');
  assert.ok(app.includes('makeClientChatJobId,saveChatJob,clearChatJob,shouldPrepareManagedChatJob'), 'app bootstrap should inject the single chat job id lifecycle into submit workflow');
}

function testSessionDisplayUpdatesFinalClarificationHtml() {
  const source = fs.readFileSync(path.join(__dirname, '../client/app/session-display.js'), 'utf8');
  assert.ok(source.includes('if (options.deferPersist !== true) item.html ='), 'final display updates should refresh item html');
  assert.ok(!source.includes('options.deferPersist !== true && options.pending !== false'), 'final pending=false updates must not skip html refresh');
}

function testClarificationAssistantNodeKeepsStableDisplayIdentity() {
  const submit = fs.readFileSync(path.join(__dirname, '../client/app/submit-workflow.js'), 'utf8');
  const image = fs.readFileSync(path.join(__dirname, '../client/app/image-workflow.js'), 'utf8');
  assert.ok(submit.includes('assistantNode&&(assistantNode.__displayItem=liveItem,liveItem?.id&&(assistantNode.dataset.displayItemId=liveItem.id),assistantNode.dataset.responseIndex=String(responseIndex))'), 'assistant placeholders should persist displayItemId and responseIndex on the DOM node');
  assert.ok(submit.includes('updateMessage(assistantNode,e,{rawText:e,responseIndex})'), 'clarification final message should keep its responseIndex on the DOM node');
  assert.ok(image.includes('if((e&&s&&e!==s)||(t&&a&&t!==a))d=null;'), 'image workflow should reject stale loading nodes from a different display item/response');
}

function testOmittedAttachmentDataDoesNotRenderAsImageUrl() {
  const html = '<div><img src="[attachment-data-omitted]" data-persisted-src="[image-data-omitted]" alt="bad.png"></div>';
  const clean = sessionPersistence.sanitizeStoredDisplayItem({ role: 'user', html }, { stripLargeDataUrlsFromText });
  assert.ok(!clean.html.includes('src="[attachment-data-omitted]"'), 'sanitizer should remove omitted attachment placeholders from img src');
  assert.ok(!clean.html.includes('data-persisted-src="[image-data-omitted]"'), 'sanitizer should remove omitted attachment placeholders from persisted image src');
  assert.ok(!clean.html.includes('attachment-data-omitted') && !clean.html.includes('image-data-omitted'), 'omitted placeholders should not remain in image markup');
}

const tests = [
  testRouteContextIsCompactAndIndexed,
  testImageGenerationPayloadDoesNotRewritePromptOrAutoParams,
  testImageResultParsingSupportsMultipleImages,
  testImageJobTargetsAndMultipartSanitization,
  testPendingClarificationMergesFollowupSupplements,
  testPendingClarificationCanMergeTextFileAndQuote,
  testPendingClarificationCarriesOriginalMultiImageContext,
  testImageEditPromptFallbackAndValidation,
  testStorageSanitizesEmbeddedImageContent,
  testPersistedAttachmentPreviewSurvivesDataUrlStripping,
  testFilePlaceholderSemanticsAndFileUnderstanding,
  testQuotedFileAttachmentTextIsIncluded,
  testHistoryFileAttachmentTextIsIncludedInChatContext,
  testHistoryFileCandidatesRouteAsFileQa,
  testUserAttachmentContextFallsBackToImageContextForRegenerate,
  testQuotedAssistantImageContextRestoresFromCanonicalMessage,
  testLightweightIntentClassifierAdapters,
  testStructuredRouteDecisionCarriesRefs,
  testImagePromptExtractionStaysChatWithCurrentImage,
  testImplicitImagePromptExtractionStaysChatWithCurrentImage,
  testNormalizeRouteKeepsExplicitImageQaChatDespiteImageIntent,
  testRouteOperationTypeDrivesCanonicalMode,
  testRoutePromptUsesEnglishRulesWithChineseEdgeCases,
  testChatAnswerStreamingFlushesQuickly,
  testStreamingTailDoesNotRenderCursor,
  testSessionTailFocusPreservesBottomGapDuringDynamicLayout,
  testSessionSwitchFocusesBottom,
  testLegacyWelcomeScreenIsRemoved,
  testHistoryRenderLoadsNewestMessagesFirst,
  testStreamingAllowsManualScroll,
  testLargeMarkdownInitialRenderIsProgressive,
  testEnglishImagePromptExtractionStaysChatWithCurrentImage,
  testImageOnlyAssistantMessageCanBeQuotedWithImageContext,
  testEmptyAssistantImageContextFallsBackToGeneratedThumbs,
  testQuoteResolverUsesCanonicalAndDisplayContext,
  testDepartmentExportWorkbookShape,
  testUsageRangesAreCentralized,
  testUsageStatsFrontendHelpers,
  testServerHardeningHelpers,
  testReadBodyReturns413WithoutDestroyingConnection,
  testSessionPromptDraftPersistsPerSession,
  testLegacyDocSupportIsRoutedToWordExtractor,
  testResponseMetricsTextIsUnified,
  testResponsesDirectDoesNotRegisterManagedChatJob,
  testTtftStartsAtServerForwardStart,
  testResponsesCompactFtIsNeverZero,
  testFileUploadReturnsFocusToComposerSubmitPath,
  testImageBubblesAreShrinkWrapped,
  testMarkdownTablesShrinkToContent,
  testMarkdownTableAlignmentUsesRendererSemantics,
  testMarkdownDetailsPreserveOpenAttribute,
  testMarkdownDetailsUseNativeCollapsedSemantics,
  testMermaidAutoRenderIsDefaultForFinalMarkdown,
  testLargeMarkdownCompletionRefocusesTail,
  testStreamingDownloadActionIsDisabled,
  testResumeStreamingDoesNotUseStatusTextAsOffset,
  testChatJobIdIsPersistedBeforeRouteResolution,
  testSessionDisplayUpdatesFinalClarificationHtml,
  testClarificationAssistantNodeKeepsStableDisplayIdentity,
  testOmittedAttachmentDataDoesNotRenderAsImageUrl,
];

(async () => {
  for (const test of tests) {
    await test();
    console.log(`✓ ${test.name}`);
  }
  console.log(`All ${tests.length} tests passed.`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});

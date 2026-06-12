(function initChatUIRouteService(root) {
  'use strict';

const ROUTE_SYSTEM_PROMPT = "You are the ChatUI intent router. Return JSON only. Do not answer the user.\nYour only job is to classify the current turn into exactly one canonical action and return the references required by that action.\n\nDecision principle:\n1. First decide the canonical action from the user's requested RESULT, not from keywords alone.\n2. Then fill mode, operation.type, intent, target, refs, and prompt fields so they are mutually consistent.\n3. If fields would conflict, operation.type is the canonical action and all other fields must match it.\n\nRequired JSON schema:\n{\"mode\":\"chat|image|edit_image\",\"operation\":{\"type\":\"plain_chat|file_qa|image_qa|ocr|text_to_image|image_reference_gen|image_edit\",\"scope\":\"current|quoted|history|none\",\"prompt\":\"\",\"edit_instruction\":\"\"},\"image_refs\":[{\"role\":\"target|reference|source\",\"image_id\":\"\",\"reference_id\":\"\",\"index\":1,\"target\":\"uploaded|previous\",\"source\":\"current|quoted|history\"}],\"file_refs\":[{\"role\":\"source\",\"file_id\":\"\",\"index\":1,\"name\":\"\",\"source\":\"current|quoted\"}],\"target\":\"none|new|uploaded|previous\",\"use_previous_image\":false,\"selected_reference_id\":\"\",\"selected_indexes\":[],\"selected_image_ids\":[],\"need_clarification\":false,\"clarification_question\":\"\",\"intent\":\"text_to_image|image_edit|image_reference_gen|unknown\",\"edit_instruction\":\"\",\"contextual_image_prompt\":\"\",\"tasks\":[],\"confidence\":0,\"evidence\":\"\"}\n\nCanonical action table. Pick exactly one:\n\nA. plain_chat\n- Use when the user asks ordinary text/chat questions and no file/image understanding or image creation/editing is required.\n- Output: mode=chat, operation.type=plain_chat, intent=unknown, target=none, image_refs=[], file_refs=[].\n\nB. file_qa\n- Use when the user asks to read, summarize, count, translate, extract, analyze, or answer questions about attached/quoted files.\n- Files are selected only from attachments/context.file_candidates.\n- Output: mode=chat, operation.type=file_qa, intent=unknown, target=none, fill file_refs.\n- Chinese examples: 这个附件是什么；总结这个 PDF；文件里面有多少条；提取邮箱。\n\nC. image_qa\n- Use when the requested RESULT is text based on existing image(s): describe, analyze, compare, evaluate, identify, OCR-like visual understanding, extract elements, or write/reverse-engineer/generate a TEXT PROMPT from an image.\n- If an image is attached/selected/quoted and the user says “reverse prompt”, “generate prompt”, “write prompt”, “反推提示词”, “逆向生成提示词”, or “提示词尽量详细”, this is image_qa, even if the word image/图片 is omitted.\n- Output: mode=chat, operation.type=image_qa, intent=unknown, target=none, fill image_refs with role=source or reference.\n- Never use image_reference_gen for generating/writing/reversing/extracting a text prompt FROM an image.\n- Chinese examples that MUST be image_qa: 根据图片生成提示词；逆向生成提示词尽量详细；基于这张图写 prompt；反推提示词；提取图片提示词；看看这张图适合什么文案。\n- English examples that MUST be image_qa: generate a prompt from this image; reverse prompt from image; write a detailed prompt based on this picture.\n\nD. ocr\n- Use when the requested RESULT is text recognition/extraction from image(s).\n- Output: mode=chat, operation.type=ocr, intent=unknown, target=none, fill image_refs.\n\nE. text_to_image\n- Use only when the requested RESULT is a NEW image created from text and no existing image must be used as visual input.\n- Output: mode=image, operation.type=text_to_image, intent=text_to_image, target=new, image_refs=[], contextual_image_prompt=\"\".\n- Do not rewrite the user's prompt here.\n\nF. image_reference_gen\n- Use only when the requested RESULT is a NEW image and existing image(s) are used as visual reference/style/subject input.\n- Output: mode=image, operation.type=image_reference_gen, intent=image_reference_gen, target=new, fill image_refs with role=reference/source, fill contextual_image_prompt with reference description + current image creation request.\n- Valid examples: 参考这张图再生成一张海报；按这张图的风格画一张新图；use this image as style reference to generate a poster.\n- Invalid examples: 根据图片生成提示词；reverse prompt from this image. These are image_qa.\n\nG. image_edit\n- Use only when the requested RESULT is modifying existing image(s): remove/add/replace/change/enhance/upscale/recolor/crop/retouch.\n- Output: mode=edit_image, operation.type=image_edit, intent=image_edit, target=uploaded or previous, fill image_refs with role=target, put the modification in edit_instruction.\n\nReference selection rules:\n1. [file id=...] and [image id=...] are indexes only. You cannot see file contents or image pixels in this router call. Do not invent visual/file contents.\n2. Select images only from current image attachments and context.image_candidates. Uploaded images and assistant-generated images are both valid.\n3. Quoted-message context must use scope/source=quoted and only choose quoted candidates.\n4. If context.image_candidates is non-empty, do not claim there is no image.\n5. “第N张 / the Nth image” selects candidate index N.\n6. If multiple possible targets exist and the user did not specify which one, set need_clarification=true and ask one short clarification_question.\n\nField consistency rules:\n- mode=chat allows only operation.type plain_chat/file_qa/image_qa/ocr and intent=unknown.\n- mode=image allows only operation.type text_to_image/image_reference_gen and intent text_to_image/image_reference_gen.\n- mode=edit_image allows only operation.type image_edit and intent=image_edit.\n- target must be none for chat, new for image, uploaded/previous for edit_image.\n- Do not output size, quality, background, format, n, or image API parameters.\n- confidence should reflect routing certainty, not answer certainty.\n- evidence should briefly cite the rule used." ;

const imageRouteContext = root?.ChatUICoreImageRouteContext
  || root?.ChatUICore?.imageRouteContext
  || root?.window?.ChatUICoreImageRouteContext
  || root?.window?.ChatUICore?.imageRouteContext
  || (typeof require === 'function' ? require('../core/image-route-context') : {});

const UPLOADED_IMAGE_ROUTE_PROMPT = '';

function cleanQuotedContent(text = '') {
  return String(text || '')
    .replace(/\[base64 image\]/gi, '')
    .replace(/耗时：[^\n]+/g, '')
    .replace(/RT\s+[^\n]+/gi, '')
    .replace(/TTFT\s+[^\n]+/gi, '')
    .replace(/^\[图片(?:生成|编辑|修改)完成\]\s*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildQuotedImagePlaceholders(images = []) {
  return (images || [])
    .map((item, index) => `[quoted_image index=${index + 1} id=${item.imageId || item.image_id || ''} name=${item.name || ''}]`)
    .join('\n');
}

function buildQuotedRouteContent({ text = '', images = [] } = {}) {
  return [cleanQuotedContent(text), buildQuotedImagePlaceholders(images)].filter(Boolean).join('\n') || '[quoted_message]';
}

function stripJsonFence(text = '') {
  return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function isPlainTextChatInput(input = '', attachments = []) {
  const text = String(input || '').trim();
  if (!text || (attachments || []).some(item => item && item.is_image)) return false;
  if (/(画|绘制|生成|创建|做一张|出一张|来一张|生图|图片|图像|海报|头像|插画|漫画|logo|图标|配图|封面|\d+\s*张图|[一二两三四五六七八九十]+张图|多张图|几张图|render|draw|generate image|create image)/i.test(text)) return false;
  if (/(换|替换|改|修改|编辑|调整|优化|重做|修|去掉|删除|移除|加上|添加|加个|放大|缩小|变成|换个|换成|边框|水印|背景|颜色|字体|样式|清晰|高清|edit|change|remove|replace|add)/i.test(text)) return false;
  return true;
}

function isImagePromptExtractionInput(input = '') {
  return /(提取|总结|分析|拆解|反推|逆向|还原).*(图片|图|画面).*(提示词|prompt|Prompt)|(?:图片|图|画面).*(提取|总结|分析|拆解|反推|逆向|还原|生成|生图).*(提示词|prompt|Prompt)|(?:图片|图|画面).*(元素|要素).*(提示词|prompt|Prompt)|(?:根据|基于|参考|按照).*(图片|图|画面).*(提示词|prompt|Prompt)|(?:生成|生图).*(提示词|prompt|Prompt)|(?:prompt|Prompt).*(反推|逆向|还原|提取)|(?:generate|write|create|make|infer|extract|reverse[-\s]?engineer|reverse).*(?:prompt).*(?:from|based on|for).*(?:image|picture|photo)|(?:image|picture|photo).*(?:prompt).*(?:generate|write|create|infer|extract|reverse)/i.test(String(input || ''));
}

function isImplicitImagePromptExtractionInput(input = '') {
  return /(?:反推|逆向|还原|提取|拆解|分析|总结|生成|生图|写|整理).*(?:提示词|prompt|Prompt)|(?:提示词|prompt|Prompt).*(?:反推|逆向|还原|提取|拆解|分析|总结|生成|生图|详细|尽量详细)|(?:reverse[-\s]?engineer|reverse|infer|extract|write|generate|create|make).*(?:prompt)|(?:prompt).*(?:reverse|infer|extract|write|generate|create|detailed|detail)/i.test(String(input || ''));
}

function imagePromptExtractionRef({ imageCandidates = [], attachments = [], parsed = {} } = {}) {
  const normalizedRefs = Array.isArray(parsed.imageRefs) && parsed.imageRefs.length ? parsed.imageRefs : (Array.isArray(parsed.image_refs) ? parsed.image_refs : []);
  if (normalizedRefs.length) return normalizedRefs;
  const first = imageCandidates.length === 1 ? imageCandidates[0] : null;
  if (first) return [{ role: 'source', image_id: first.image_id || '', reference_id: first.reference_id || '', index: first.index || 1, target: first.target || 'previous', source: first.source || 'quoted' }];
  const currentImageIndex = (attachments || []).findIndex(item => item && item.is_image);
  if (currentImageIndex >= 0) return [{ role: 'source', image_id: '', reference_id: '', index: currentImageIndex + 1, target: 'uploaded', source: 'current' }];
  return [];
}

function parseRouteResult(text = '', normalizeRoute, options = {}) {
  const value = String(text || '').trim();
  if (!value) return null;
  const normalize = normalizeRoute || imageRouteContext.normalizeRoute;
  if (typeof normalize !== 'function') throw new TypeError('normalizeRoute is required');
  try {
    const parsed = normalize(JSON.parse(stripJsonFence(value)));
    const imageCandidates = Array.isArray(options.context?.image_candidates) ? options.context.image_candidates : [];
    const attachments = options.attachments || [];
    const hasImageContext = imageCandidates.length > 0 || attachments.some(item => item && item.is_image);
    if (hasImageContext && (isImagePromptExtractionInput(options.input) || isImplicitImagePromptExtractionInput(options.input)) && parsed.mode !== 'chat') {
      const first = imageCandidates.length === 1 ? imageCandidates[0] : null;
      const refs = imagePromptExtractionRef({ imageCandidates, attachments, parsed });
      const selectedIndexes = refs.map(ref => Number(ref.index)).filter(index => Number.isInteger(index) && index >= 1);
      const selectedImageIds = refs.map(ref => ref.image_id || ref.imageId).filter(Boolean);
      return normalize({
        ...parsed,
        mode: 'chat',
        operation: { ...(parsed.operation || {}), type: 'image_qa', scope: first?.source || refs[0]?.source || parsed.operation?.scope || 'current' },
        target: first?.target || parsed.target || 'previous',
        use_previous_image: first?.target === 'previous' || parsed.usePreviousImage || parsed.use_previous_image || false,
        image_refs: refs,
        selected_indexes: parsed.selectedIndexes?.length ? parsed.selectedIndexes : parsed.selected_indexes || selectedIndexes,
        selected_image_ids: parsed.selectedImageIds?.length ? parsed.selectedImageIds : parsed.selected_image_ids || selectedImageIds,
        intent: 'unknown',
        evidence: '根据图片提取/反推生成提示词属于图片理解，不是直接生图',
      }, 'chat');
    }
    if (isPlainTextChatInput(options.input, options.attachments)) {
      const selectedReferenceId = String(parsed.selectedReferenceId || '');
      const hasExplicitReference = !!selectedReferenceId && selectedReferenceId !== 'imgref_latest';
      const hasSelectedImage = !!(parsed.selectedImageIds?.length || parsed.selectedIndexes?.length || hasExplicitReference);
      if (parsed.mode === 'image' || (parsed.mode === 'edit_image' && !hasSelectedImage)) {
        return normalize({ mode: 'chat', target: 'none', use_previous_image: false, intent: 'unknown', confidence: 1, evidence: '普通文本输入，没有明确生图或可定位修图意图，强制走聊天' }, 'chat');
      }
    }
    return parsed;
  } catch { return null; }
}

function buildFileCandidatesFromAttachments(attachments = []) {
  return (attachments || [])
    .filter(item => item && !item.is_image)
    .map((item, index) => ({
      index: index + 1,
      file_id: item.file_id || item.id || item.attachmentId || item.attachment_id || '',
      name: item.name || 'attachment',
      type: item.type || '',
      size: Number(item.size) || 0,
      has_extracted_text: !!item.has_extracted_text,
      unsupported_reason: item.unsupported_reason || '',
    }));
}

function compactRoutePayloadContext(context = {}, input = '', attachments = []) {
  const next = context && typeof context === 'object' ? { ...context } : {};
  const currentFiles = buildFileCandidatesFromAttachments(attachments);
  if (currentFiles.length) next.file_candidates = currentFiles;
  else if (!Array.isArray(next.file_candidates)) next.file_candidates = [];
  const current = String(input || '').trim();
  const messages = Array.isArray(next.recent_messages) ? [...next.recent_messages] : [];
  if (current && messages.length) {
    const last = messages[messages.length - 1];
    const content = String(last?.content || '').trim();
    const duplicateCurrent = last?.role === 'user' && (content === current || content.startsWith(`${current}\n\n[image `) || content.startsWith(`${current}\n\n[file `));
    if (duplicateCurrent) messages.pop();
  }
  next.recent_messages = messages;
  return next;
}

function buildRoutePayload({ model, input, attachments = [], context = {}, currentMode = 'chat', autoMode = true, systemPrompt = ROUTE_SYSTEM_PROMPT } = {}) {
  const routeContext = compactRoutePayloadContext(context, input, attachments);
  return {
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt + UPLOADED_IMAGE_ROUTE_PROMPT },
      { role: 'user', content: JSON.stringify({ current_input: input, current_mode: currentMode, auto_mode: autoMode, attachments, context: routeContext }, null, 2) },
    ],
  };
}

function extractRouteText(response = {}) {
  return response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content || response && response.output_text || '';
}

const api = Object.freeze({
  ROUTE_SYSTEM_PROMPT,
  UPLOADED_IMAGE_ROUTE_PROMPT,
  cleanQuotedContent,
  buildQuotedImagePlaceholders,
  buildQuotedRouteContent,
  stripJsonFence,
  isPlainTextChatInput,
  isImagePromptExtractionInput,
  isImplicitImagePromptExtractionInput,
  parseRouteResult,
  buildFileCandidatesFromAttachments,
  compactRoutePayloadContext,
  buildRoutePayload,
  extractRouteText,
});

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.ChatUIRouteService = api;
if (root?.window) root.window.ChatUIRouteService = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

(function initChatUIFeaturesMessagesDomain(root) {
  'use strict';

  function messageRoleLabel(role = '') {
    return role === 'user' ? '我' : role === 'assistant' ? 'AI' : '消息';
  }

  function messageRoleFromNode(node) {
    return node?.classList?.contains('assistant') ? 'assistant' : node?.classList?.contains('user') ? 'user' : 'error';
  }

  function normalizeQuoteText(text = '', limit = 1200) {
    return String(text || '')
      .replace(/\[base64 image\]/gi, '')
      .replace(/耗时：[^\n]+/g, '')
      .replace(/RT\s+[^\n]+/gi, '')
      .replace(/TTFT\s+[^\n]+/gi, '')
      .replace(/^\[图片(?:生成|编辑|修改)完成\]\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
  }

  function escapeHtmlLocal(value = '') {
    return String(value ?? '').replace(/[&<>"'`]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[ch]));
  }

  function readQuoteContext(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      try { return readQuoteContext(JSON.parse(value)); } catch { return null; }
    }
    if (!value || typeof value !== 'object') return null;
    const hasImageContext = !!(value.imageContext || value.image_context);
    const content = normalizeQuoteText(value.content ?? value.rawText ?? (hasImageContext ? '[图片消息]' : ''), 1200);
    if (!content && !hasImageContext) return null;
    const quote = { role: value.role === 'assistant' ? 'assistant' : 'user', content: content || '[图片消息]' };
    ['sessionId', 'displayItemId', 'messageIndex', 'responseIndex', 'imageContext', 'attachmentContext'].forEach(key => {
      const altKey = key === 'imageContext' ? 'image_context' : key === 'attachmentContext' ? 'attachment_context' : key;
      const raw = value[key] ?? value[altKey];
      if (raw !== undefined && raw !== null && raw !== '') quote[key] = typeof raw === 'string' ? raw : JSON.stringify(raw);
    });
    return quote;
  }

  function quoteContextJson(value) {
    const quote = readQuoteContext(value);
    return quote ? JSON.stringify(quote) : '';
  }

  const api = Object.freeze({
    messageRoleLabel,
    messageRoleFromNode,
    normalizeQuoteText,
    escapeHtmlLocal,
    readQuoteContext,
    quoteContextJson,
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatUIFeaturesMessagesDomain = api;
  if (root?.window) root.window.ChatUIFeaturesMessagesDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

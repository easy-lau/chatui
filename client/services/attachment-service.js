(function initChatUIAttachmentService(global) {
  'use strict';

  async function defaultParseResponseJson(response) {
    const text = await response.text();
    try { return text ? JSON.parse(text) : null; } catch { return { raw: text }; }
  }

  function defaultNormalizeError(error, payload) {
    return payload?.error?.message || payload?.message || error?.message || '请求失败';
  }

  async function extractFileText(options = {}) {
    const item = options.item || options.attachment || {};
    const filename = options.filename ?? item.name;
    const type = options.type ?? item.type;
    const dataUrl = options.dataUrl ?? item.dataUrl;
    if (!dataUrl) return '';

    const fetchImpl = options.fetchImpl || global.fetch?.bind(global);
    if (!fetchImpl) throw new Error('当前环境不支持 fetch');
    const parseResponseJson = options.parseResponseJson || defaultParseResponseJson;
    const normalizeError = options.normalizeError || defaultNormalizeError;

    const response = await fetchImpl('/api/extract-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, type, dataUrl }),
    });
    const payload = await parseResponseJson(response);
    if (!response.ok) throw new Error(normalizeError(null, payload));
    return String(payload?.text || '').trim();
  }

  const api = Object.freeze({ extractFileText });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.ChatUIAttachmentService = api;
  if (global?.window) global.window.ChatUIAttachmentService = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

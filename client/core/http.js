(function initChatUICoreHttp(root) {
  'use strict';

  function normalizeUpstreamErrorMessage(message = '') {
    const text = String(message || '');
    if (/circuit breaker|skip candidate|raw request middleware/i.test(text)) {
      return '上游接口暂时不可用：请求被上游熔断或候选通道跳过，请稍后重试或检查 Endpoint 服务状态';
    }
    if (/The image data you provided does not represent a valid image/i.test(text)) {
      return '图片数据无效：请重新上传有效的 PNG/JPG 图片后再试';
    }
    return text;
  }

  function normalizeError(error, payload) {
    const message = payload?.error?.message
      ? payload.error.message
      : payload?.error?.code
        ? payload.error.code
        : payload?.message
          ? payload.message
          : payload?.raw
            ? payload.raw
            : error?.message || '请求失败';
    return normalizeUpstreamErrorMessage(message);
  }

  function toProxyUrl(url, baseUrl) {
    return String(url || '').startsWith(baseUrl) ? `/api${String(url || '').slice(String(baseUrl).length)}` : url;
  }

  async function parseResponseJson(response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return { raw: text };
    }
  }

  const api = Object.freeze({ normalizeError, normalizeUpstreamErrorMessage, toProxyUrl, parseResponseJson });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatUICoreHttp = api;
  if (root?.window) root.window.ChatUICoreHttp = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

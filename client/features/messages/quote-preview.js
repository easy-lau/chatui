(function initChatUIFeaturesMessagesQuotePreview(root) {
  'use strict';

  function createQuotePreview(deps = {}) {
    const readQuoteContext = deps.readQuoteContext || root.ChatUIFeaturesMessagesDomain?.readQuoteContext || (() => null);
    const normalizeQuoteText = deps.normalizeQuoteText || root.ChatUIFeaturesMessagesDomain?.normalizeQuoteText || ((text = '', limit = 1200) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit));
    const escapeHtml = deps.escapeHtml || root.ChatUIFeaturesMessagesDomain?.escapeHtmlLocal || (value => String(value ?? '').replace(/[&<>"'`]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[ch])));

    function renderSentQuotePreview(value) {
      const quote = readQuoteContext(value);
      if (!quote) return '';
      const context = escapeHtml(JSON.stringify(quote));
      const text = escapeHtml(normalizeQuoteText(quote.content, 48));
      return `<button class="sent-quote-preview" type="button" data-quote-context="${context}" title="jump to quoted message"><span class="sent-quote-label">&#24341;&#29992;</span><span class="sent-quote-text">${text}</span></button>`;
    }

    function withSentQuotePreview(html = '', quoteContext = '') {
      const preview = renderSentQuotePreview(quoteContext);
      if (!preview || /class=["'][^"']*sent-quote-preview/.test(String(html || ''))) return String(html || '');
      return `${preview}${String(html || '')}`;
    }

    return Object.freeze({ renderSentQuotePreview, withSentQuotePreview });
  }

  const api = Object.freeze({ createQuotePreview });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatUIFeaturesMessagesQuotePreview = api;
  if (root?.window) root.window.ChatUIFeaturesMessagesQuotePreview = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

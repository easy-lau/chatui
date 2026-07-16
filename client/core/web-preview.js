(function initChatUICoreWebPreview(root) {
  'use strict';

  const MAX_PREVIEW_SOURCE_LENGTH = 1_500_000;
  const HTML_FENCE_PATTERN = /(^|\n)\s*```(?:html|htm|xhtml)\s*\n([\s\S]*?)\n\s*```/gi;
  const DOCUMENT_PATTERN = /<!doctype\s+html\b[\s\S]*?<\/html\s*>|<html\b[^>]*>[\s\S]*?<\/html\s*>/gi;
  function normalizeSource(value = '') {
    return String(value || '').replace(/\r\n?/g, '\n').replace(/\0/g, '').trim();
  }

  function looksLikeWebDocument(value = '') {
    const source = normalizeSource(value);
    if (!source || source.length > MAX_PREVIEW_SOURCE_LENGTH) return false;
    return /<!doctype\s+html\b/i.test(source)
      || (/<html\b[^>]*>/i.test(source) && /<\/(?:html|body)\s*>/i.test(source));
  }

  function previewTitle(source = '', fallback = '\u7f51\u9875\u9884\u89c8') {
    const match = String(source || '').match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
    const title = match?.[1]
      ? match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
    return title.slice(0, 120) || fallback;
  }

  function uniqueCandidates(candidates = []) {
    const seen = new Set();
    return candidates.filter(candidate => {
      const source = normalizeSource(candidate?.source);
      if (!source || seen.has(source)) return false;
      seen.add(source);
      candidate.source = source;
      candidate.title = candidate.title || previewTitle(source);
      return true;
    });
  }

  function extractWebPreviewCandidates(markdown = '') {
    const source = normalizeSource(markdown);
    if (!source || source.length > MAX_PREVIEW_SOURCE_LENGTH) return [];
    const candidates = [];
    let match;
    HTML_FENCE_PATTERN.lastIndex = 0;
    while ((match = HTML_FENCE_PATTERN.exec(source))) {
      const documentSource = normalizeSource(match[2]);
      if (looksLikeWebDocument(documentSource)) candidates.push({ source: documentSource, origin: 'fence' });
    }
    DOCUMENT_PATTERN.lastIndex = 0;
    while ((match = DOCUMENT_PATTERN.exec(source))) {
      const documentSource = normalizeSource(match[0]);
      if (looksLikeWebDocument(documentSource)) candidates.push({ source: documentSource, origin: 'document' });
    }
    return uniqueCandidates(candidates).map((candidate, index) => ({
      ...candidate,
      id: `web-preview-${index + 1}`,
      title: previewTitle(candidate.source, `\u7f51\u9875\u9884\u89c8 ${index + 1}`),
    }));
  }

  // Candidates are complete documents. Keep their content intact so scripts, forms, and
  // linked resources work inside the isolated preview iframe.
  function buildPreviewDocument(source = '') {
    return normalizeSource(source);
  }


  const api = Object.freeze({
    MAX_PREVIEW_SOURCE_LENGTH,
    normalizeSource,
    looksLikeWebDocument,
    previewTitle,
    extractWebPreviewCandidates,
    buildPreviewDocument,
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatUICoreWebPreview = api;
  if (root?.window) root.window.ChatUICoreWebPreview = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

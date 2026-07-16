(function initChatUICoreReasoning(root) {
  'use strict';

  function normalizeReasoningText(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value
        .map(item => normalizeReasoningText(item?.text || item?.content || item?.summary || item?.summary_text || item?.reasoning || item?.reasoning_content || item?.output_text || item?.delta || item))
        .filter(Boolean)
        .join('\n');
    }
    if (typeof value === 'object') {
      return normalizeReasoningText(
        value.text || value.content || value.summary || value.summary_text || value.reasoning || value.reasoning_content || value.output_text || value.delta || ''
      );
    }
    return String(value || '');
  }

  function normalizeContentText(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value
        .map(item => normalizeContentText(item?.text || item?.content || item?.output_text || item?.message || item?.delta || item))
        .filter(Boolean)
        .join('');
    }
    if (typeof value === 'object') {
      const output = Array.isArray(value.output) ? value.output.filter(item => !/reason/i.test(String(item?.type || item?.role || ''))) : '';
      return normalizeContentText(value.text || value.content || value.output_text || value.message || value.delta || value.response || output || '');
    }
    return String(value || '');
  }

  function extractStreamDelta(event) {
    const choice = event?.choices?.[0];
    const delta = choice?.delta || {};
    const message = choice?.message || {};
    const reasoning = normalizeReasoningText(
      delta.reasoning_content || delta.reasoning || delta.delta ||
      message.reasoning_content || message.reasoning || message.delta ||
      event?.reasoning_content || event?.reasoning || event?.reasoning_delta || ''
    );
    let content = normalizeContentText(
      delta.content || delta.text || delta.output_text || message.content || message.text || message.output_text || event?.output_text ||
      (typeof event?.delta === 'string' ? event.delta : '') || event?.content || event?.text || ''
    );
    if (!content && Array.isArray(event?.output)) {
      content = event.output.filter(item => !/reason/i.test(String(item?.type || item?.role || ''))).map(item => normalizeContentText(item?.content || item?.text || item?.output_text || '')).join('');
    }
    const outputReasoning = !reasoning && Array.isArray(event?.output)
      ? normalizeReasoningText(event.output.filter(item => /reason/i.test(String(item?.type || item?.role || '')) || item?.summary || item?.summary_text || item?.reasoning))
      : '';
    return { content, reasoning: reasoning || outputReasoning };
  }

  function extractResponsesStreamDelta(event) {
    if (event && typeof event === 'object' && ('d' in event || 'r' in event)) {
      return { content: normalizeContentText(event.d || ''), reasoning: normalizeReasoningText(event.r || '') };
    }
    const type = String(event?.type || '');
    if (/\.done$/i.test(type) || type === 'response.completed') return { content: '', reasoning: '' };
    const isReasoning = /reasoning/i.test(type);
    const isSummary = /summary/i.test(type);
    const content = normalizeContentText((!isReasoning ? event?.delta : '') || (!isReasoning ? event?.text : '') || (!isReasoning ? event?.output_text_delta : '') || (!isReasoning ? event?.response?.output_text?.delta : '') || '');
    const reasoningDelta = isReasoning && isSummary ? (event?.delta || event?.text || event?.content || event?.output_text || '') : '';
    const reasoning = normalizeReasoningText(event?.summary_text_delta || event?.reasoning_summary_text_delta || event?.delta_text || event?.summary_text || event?.reasoning_summary_text || event?.summary || event?.reasoning_summary || reasoningDelta || '');
    return { content, reasoning };
  }

  const api = Object.freeze({ normalizeReasoningText, normalizeContentText, extractStreamDelta, extractResponsesStreamDelta });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatUICoreReasoning = api;
  if (root?.window) root.window.ChatUICoreReasoning = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

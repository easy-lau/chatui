(function initChatUIScrollMetrics(root) {
  'use strict';

  function normalizeThreshold(value, fallback = 0) {
    return Number.isFinite(value) ? Math.max(0, value) : Math.max(0, fallback);
  }

  function distanceToBottom(scroller) {
    if (!scroller) return 0;
    return Math.max(0, scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight);
  }

  function isNearBottom(scroller, threshold = 0) {
    return distanceToBottom(scroller) <= normalizeThreshold(threshold, 0);
  }

  function nextScrollTopForBottom(scroller) {
    if (!scroller) return 0;
    return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }

  function clampScrollTop(value, scrollerOrMax = 0) {
    const max = typeof scrollerOrMax === 'number' ? Math.max(0, scrollerOrMax) : nextScrollTopForBottom(scrollerOrMax);
    return Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
  }

  function shouldRespectManualScroll(options = {}) {
    const gap = Number.isFinite(options.gap) ? options.gap : 0;
    const threshold = normalizeThreshold(options.threshold, 0);
    const manualIntent = options.manualIntent === true;
    const eventType = options.eventType || options.event?.type;
    return !!(manualIntent && eventType === 'scroll' && gap > threshold);
  }

  const api = Object.freeze({
    normalizeThreshold,
    distanceToBottom,
    isNearBottom,
    nextScrollTopForBottom,
    clampScrollTop,
    shouldRespectManualScroll,
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatUIScrollMetrics = api;
  if (root?.window) root.window.ChatUIScrollMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

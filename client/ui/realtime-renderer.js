(function initChatUIRealtimeRenderer(root) {
  'use strict';

function createRealtimeRenderer(render, options = {}) {
  const configuredDefaultMs = Number(root.CHATUI_MIN_STREAM_RENDER_INTERVAL_MS);
  const defaultIntervalMs = Number.isFinite(configuredDefaultMs) && configuredDefaultMs > 0 ? configuredDefaultMs : 80;
  const requestedIntervalMs = Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : defaultIntervalMs;
  const minIntervalMs = Math.max(16, requestedIntervalMs);
  let value = '';
  let pendingValue = '';
  let timer = null;
  let frame = null;
  let frameIsTimer = false;
  let lastRenderAt = 0;
  let cancelled = false;
  let finalized = false;

  const clearFrame = () => {
    if (frame != null) {
      if (frameIsTimer) clearTimeout(frame);
      else if (typeof root.cancelAnimationFrame === 'function') root.cancelAnimationFrame(frame);
    }
    frame = null;
    frameIsTimer = false;
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const clearScheduled = () => {
    clearTimer();
    clearFrame();
  };

  const renderNow = next => {
    if (cancelled || finalized) return false;
    const normalized = String(next || '');
    value = normalized;
    pendingValue = normalized;
    lastRenderAt = Date.now();
    render(value);
    return true;
  };

  const scheduleFrameRender = () => {
    if (frame != null) return;
    const run = () => { frame = null; renderNow(pendingValue); };
    frameIsTimer = typeof root.requestAnimationFrame !== 'function';
    frame = frameIsTimer ? setTimeout(run, 0) : root.requestAnimationFrame(run);
  };

  const flushValue = next => {
    if (cancelled || finalized) return false;
    clearScheduled();
    return renderNow(next === undefined ? pendingValue : next);
  };

  return {
    set(next) {
      if (cancelled || finalized) return;
      const normalized = String(next || '');
      if (normalized === pendingValue) return;
      pendingValue = normalized;
      if (frame != null) return;
      const elapsed = Date.now() - lastRenderAt;
      if (elapsed >= minIntervalMs) {
        clearTimer();
        scheduleFrameRender();
        return;
      }
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        scheduleFrameRender();
      }, Math.max(0, minIntervalMs - elapsed));
    },
    flush(next) {
      return flushValue(next);
    },
    final(next) {
      const rendered = flushValue(next);
      clearScheduled();
      finalized = true;
      return rendered;
    },
    cancel() {
      clearScheduled();
      cancelled = true;
      value = '';
      pendingValue = '';
    },
    hasTimer() {
      return !!timer || frame != null;
    },
  };
}

const createStreamingRenderer = root?.ChatUIAppMarkdownStreamingRenderer?.createStreamingRenderer
  || root?.window?.ChatUIAppMarkdownStreamingRenderer?.createStreamingRenderer
  || root?.ChatUIApp?.markdown?.createStreamingRenderer
  || root?.window?.ChatUIApp?.markdown?.createStreamingRenderer
  || (typeof require === 'function' ? require('../app/markdown/streaming-renderer').createStreamingRenderer : undefined);

const api = Object.freeze({ createRealtimeRenderer, createStreamingRenderer });

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.ChatUIRealtimeRenderer = api;
if (root?.window) root.window.ChatUIRealtimeRenderer = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

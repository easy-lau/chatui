(function initChatUIConfigFeatureFlags(root) {
  'use strict';

  const featureFlags = Object.freeze({
    virtualMessages: false,
    progressiveLargeMarkdown: true,
    offscreenMarkdownFinalRender: true,
    managedChatJobResume: true,
    bottomScrollLock: true,
  });

  const api = Object.freeze({ featureFlags });

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatUIConfig = Object.freeze({ ...(root.ChatUIConfig || {}), featureFlags });
  if (root?.window) root.window.ChatUIConfig = root.ChatUIConfig;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

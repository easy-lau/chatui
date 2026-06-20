(function initChatUICoreContextBudget(root) {
  'use strict';

  function loadSharedContextBudget() {
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      return require('../../shared/config/context-budget');
    }
    if (!root) return null;
    return root.ChatUISharedContextBudget || (root.window && root.window.ChatUISharedContextBudget) || null;
  }

  const api = loadSharedContextBudget();
  if (!api) throw new Error('ChatUISharedContextBudget must be loaded before ChatUICoreContextBudget');

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatUICoreContextBudget = api;
  if (root && root.window) root.window.ChatUICoreContextBudget = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

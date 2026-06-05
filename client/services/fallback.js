(function initChatUIServicesFallbackAlias(global) {
  'use strict';

  const root = global.globalThis || global;
  const browser = root.window || global.window || global;
  const composition = browser.ChatUIServicesComposition || root.ChatUIServicesComposition || null;
  if (composition) {
    if (typeof window !== 'undefined') window.ChatUIServicesFallback = composition;
    else global.ChatUIServicesFallback = composition;
  }
})(typeof window !== 'undefined' ? window : globalThis);

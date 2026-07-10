(function initChatUIPreflightGuards(root) {
  'use strict';

  function isImageAttachment(item) {
    return String(item?.type || item?.mime || item?.file?.type || '').startsWith('image/');
  }

  function attachmentCounts(attachments = [], isImageFile = isImageAttachment) {
    const list = Array.isArray(attachments) ? attachments : [];
    const imageCount = list.filter(item => isImageFile(item)).length;
    return { imageCount, fileCount: list.length - imageCount };
  }

  // Preflight 只处理不需要理解用户语义的确定性条件。
  // 意图分类、澄清、工具选择和参数组装全部交给 AI 路由模型。
  function buildPreflightDecision({ input = '', attachments = [], config = {} } = {}) {
    const hasInput = Boolean(String(input || '').trim());
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    const reply = (message, metaText, code) => ({ action: 'reply', message, metaText, code });
    if (!hasInput && !hasAttachments) return reply('请输入消息或添加附件。', '缺少输入', 'missing_input');
    if (!String(config.baseUrl || '').trim()) return reply('请先在设置里填写 Endpoint Base URL。', '配置缺失', 'missing_base_url');
    if (!String(config.routeModel || config.chatModel || '').trim()) return reply('请先在设置里选择路由模型或聊天模型。', '配置缺失', 'missing_route_model');
    return null;
  }

  const api = { buildPreflightDecision, attachmentCounts };
  if (root) root.ChatUICorePreflightGuards = api;
  if (root?.window) root.window.ChatUICorePreflightGuards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

function formatElapsed(ms) {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function firstTokenTimeText(ms) {
  return Number.isFinite(ms) ? `TTFT ${formatElapsed(ms)}` : '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, '&#10;');
}

function renderStreamingText(value) {
  return `<p>${escapeHtml(value).replace(/\n/g, '<br>')}</p>`;
}

function pendingFeedbackHtml(value) {
  return `<div class="pending-feedback"><span class="pending-orb" aria-hidden="true"></span><span class="pending-text">${escapeHtml(value)}</span><span class="pending-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>`;
}

function isChatStatusText(value = '') {
  return /正在处理|正在思考|正在恢复聊天任务|恢复任务不存在|已停止恢复|已收到|请稍等|已等待/.test(String(value || ''));
}

module.exports = {
  formatElapsed,
  firstTokenTimeText,
  escapeHtml,
  escapeAttr,
  renderStreamingText,
  pendingFeedbackHtml,
  isChatStatusText,
};

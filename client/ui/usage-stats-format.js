(() => {
  const escapeHtml = (typeof window !== 'undefined' && (window.ChatUIAppFormatting || window.ChatUIApp?.formatting || {}).escapeHtml) || (value => String(value ?? '').replace(/[&<>"'`]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[ch])));

  function trimUnit(value) {
    return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1).replace(/\.0$/, '') : value.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
  }

  function formatTokens(value) {
    const number = Number(value) || 0;
    if (Math.abs(number) >= 1000000000) return `${trimUnit(number / 1000000000)}B`;
    if (Math.abs(number) >= 1000000) return `${trimUnit(number / 1000000)}M`;
    return new Intl.NumberFormat('zh-CN').format(number);
  }

  function fullNumber(value) {
    return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
  }

  function tokenPercent(part, total) {
    const totalTokens = Number(total) || 0;
    const partTokens = Number(part) || 0;
    if (totalTokens <= 0 || partTokens <= 0) return 0;
    return Math.max(0, Math.min(100, partTokens / totalTokens * 100));
  }

  function cachePercent(row = {}) {
    return tokenPercent(row?.prompt_cached_tokens, row?.prompt_tokens);
  }

  function reasoningPercent(row = {}) {
    return tokenPercent(row?.completion_reasoning_tokens, row?.completion_tokens);
  }

  function formatPercent(value) {
    const number = Number(value) || 0;
    return `${number >= 10 ? number.toFixed(1) : number.toFixed(2)}`.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1') + '%';
  }

  function formatMetricValue(value, type) {
    return type === 'percent' ? formatPercent(value) : formatTokens(value);
  }

  function fullMetricValue(value, type) {
    return type === 'percent' ? formatPercent(value) : fullNumber(value);
  }

  const api = { escapeHtml, formatTokens, trimUnit, fullNumber, tokenPercent, cachePercent, reasoningPercent, formatPercent, formatMetricValue, fullMetricValue };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ChatUIUsageStatsFormat = api;
})();

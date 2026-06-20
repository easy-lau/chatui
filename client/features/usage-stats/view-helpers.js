(() => {
  const DEFAULT_RANKING_TABS = [
    ['today', '今日排行'],
    ['yesterday', '昨日排行'],
    ['total', '总排行'],
  ];
  const DEFAULT_DEPARTMENT_TABS = [
    ['today', '今日排行'],
    ['yesterday', '昨日排行'],
    ['month', '本月排行'],
    ['last_month', '上月排行'],
    ['total', '总排行'],
  ];

  function resolveDefaultFormat() {
    if (typeof window !== 'undefined' && window.ChatUIUsageStatsFormat) return window.ChatUIUsageStatsFormat;
    if (typeof require === 'function') return require('../../ui/usage-stats-format');
    return {};
  }

  function createUsageStatsViewHelpers(format = {}, options = {}) {
    const RANKING_TABS = options.rankingTabs || DEFAULT_RANKING_TABS;
    const DEPARTMENT_TABS = options.departmentTabs || DEFAULT_DEPARTMENT_TABS;
    const {
      formatMetricValue = value => String(value ?? ''),
      fullMetricValue = value => String(value ?? ''),
      cachePercent = () => 0,
      reasoningPercent = () => 0,
    } = format;

    function tokenColumns(row) {
      return [
        ['总用量', row?.total_tokens],
        ['输入', row?.prompt_tokens],
        ['输出', row?.completion_tokens],
        ['缓存输入', cachePercent(row), 'percent'],
        ['推理输出', reasoningPercent(row), 'percent'],
      ];
    }

    function rawTokenColumns(row) {
      return [
        ['总用量', row?.total_tokens],
        ['输入', row?.prompt_tokens],
        ['输出', row?.completion_tokens],
        ['缓存输入', row?.prompt_cached_tokens],
        ['推理输出', row?.completion_reasoning_tokens],
      ];
    }

    function rangeLabel(range) {
      if (range === 'total') return '所有时间';
      if (range === 'month') return '本月';
      if (range === 'last_month') return '上月';
      return [...RANKING_TABS, ...DEPARTMENT_TABS].find(([key]) => key === range)?.[1]?.replace('排行', '') || '今日';
    }

    function tabLabel(range, mode = 'personal') {
      return (mode === 'department' ? DEPARTMENT_TABS : RANKING_TABS).find(([key]) => key === range)?.[1] || '排行';
    }

    function renderTokenBadges(row, options = {}) {
      const columns = options.raw ? rawTokenColumns(row) : tokenColumns(row);
      return columns.map(([label, value, type], index) => `
      <span class="usage-token-badge usage-token-badge-${index}" title="${fullMetricValue(value, type)}">
        <em>${label}</em>
        <strong>${formatMetricValue(value, type)}</strong>
      </span>`).join('');
    }

    function renderRankIcon(rank) {
      if (rank === 1) return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10l-1.2 6.6A4.8 4.8 0 0 1 12 14a4.8 4.8 0 0 1-3.8-3.4L7 4Z"/><path d="M8.5 5.8H4.8c.2 3.4 1.7 5.2 4.4 5.7"/><path d="M15.5 5.8h3.7c-.2 3.4-1.7 5.2-4.4 5.7"/><path d="M10.4 14h3.2v3.2h-3.2z"/><path d="M7.8 20h8.4"/></svg>';
      if (rank === 2) return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 14.7 8l5.3 1-3.7 3.9.7 5.4-5-2.3-5 2.3.7-5.4L4 9l5.3-1L12 3.2Z"/><path d="M9.7 10.4a2.3 2.3 0 1 1 4.6 0c0 1.7-2.1 2.4-4.4 4.3h4.7"/></svg>';
      if (rank === 3) return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.8h11l-1.1 7.4a4.5 4.5 0 0 1-8.8 0L6.5 4.8Z"/><path d="M9.3 10.2h3a1.7 1.7 0 0 1 0 3.4H9.4"/><path d="M12 13.6a1.7 1.7 0 1 1 0 3.4H9.2"/><path d="M10 18.6h4"/></svg>';
      return `<span>${rank}</span>`;
    }

    function renderRankIndex(index) {
      const rank = index + 1;
      if (rank <= 3) return `<div class="usage-rank-index usage-rank-medal usage-rank-medal-${rank}" aria-label="第 ${rank} 名"><span class="usage-rank-num">${rank}</span>${renderRankIcon(rank)}</div>`;
      return `<div class="usage-rank-index">${renderRankIcon(rank)}</div>`;
    }

    function modeToggleIcon(mode = 'personal') {
      if (mode === 'department') {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>';
      }
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/><path d="M9 10h.01"/><path d="M15 10h.01"/></svg>';
    }

    return {
      RANKING_TABS,
      DEPARTMENT_TABS,
      tokenColumns,
      rawTokenColumns,
      rangeLabel,
      tabLabel,
      renderTokenBadges,
      renderRankIcon,
      renderRankIndex,
      modeToggleIcon,
    };
  }

  const api = {
    DEFAULT_RANKING_TABS,
    DEFAULT_DEPARTMENT_TABS,
    createUsageStatsViewHelpers,
    ...createUsageStatsViewHelpers(resolveDefaultFormat()),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ChatUIUsageStatsViewHelpers = api;
})();

const PERSONAL_RANGES = Object.freeze(['today', 'yesterday', 'total']);
const DEPARTMENT_RANGES = Object.freeze(['today', 'yesterday', 'month', 'last_month', 'total']);

const RANGE_FILTERS = Object.freeze({
  today: `ul.created_at >= CURRENT_DATE::timestamptz AND ul.created_at <= NOW()`,
  yesterday: `ul.created_at >= (CURRENT_DATE - INTERVAL '1 day')::timestamptz AND ul.created_at < CURRENT_DATE::timestamptz`,
  total: `TRUE`,
});

const DEPARTMENT_RANGE_FILTERS = Object.freeze({
  today: `ul.created_at >= CURRENT_DATE::timestamptz AND ul.created_at <= NOW()`,
  yesterday: `ul.created_at >= (CURRENT_DATE - INTERVAL '1 day')::timestamptz AND ul.created_at < CURRENT_DATE::timestamptz`,
  month: `ul.created_at >= date_trunc('month', NOW()) AND ul.created_at <= NOW()`,
  last_month: `ul.created_at >= date_trunc('month', NOW()) - INTERVAL '1 month' AND ul.created_at < date_trunc('month', NOW())`,
  total: `TRUE`,
});

const DEPARTMENT_RANGE_BOUNDS_SQL = Object.freeze({
  today: `SELECT CURRENT_DATE::timestamptz AS start_time, NOW() AS end_time`,
  yesterday: `SELECT (CURRENT_DATE - INTERVAL '1 day')::timestamptz AS start_time, CURRENT_DATE::timestamptz AS end_time`,
  month: `SELECT date_trunc('month', NOW()) AS start_time, NOW() AS end_time`,
  last_month: `SELECT date_trunc('month', NOW()) - INTERVAL '1 month' AS start_time, date_trunc('month', NOW()) AS end_time`,
  total: `SELECT MIN(created_at) AS start_time, NOW() AS end_time FROM usage_logs`,
});

const DEPARTMENT_RANGE_LABELS = Object.freeze({
  today: '今日排行',
  yesterday: '昨日排行',
  month: '本月排行',
  last_month: '上月排行',
  total: '总排行',
});

function isPersonalRange(range) {
  return PERSONAL_RANGES.includes(range);
}

function isDepartmentRange(range) {
  return DEPARTMENT_RANGES.includes(range);
}

module.exports = {
  PERSONAL_RANGES,
  DEPARTMENT_RANGES,
  RANGE_FILTERS,
  DEPARTMENT_RANGE_FILTERS,
  DEPARTMENT_RANGE_BOUNDS_SQL,
  DEPARTMENT_RANGE_LABELS,
  isPersonalRange,
  isDepartmentRange,
};

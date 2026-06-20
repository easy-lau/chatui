const { buildDepartmentExportWorkbook } = require('../usage/export-xlsx');
const { DEPARTMENT_RANGE_LABELS } = require('../usage/ranges');

async function getRanking(usageStats, range) {
  return usageStats.getRanking(range);
}

async function getPersonalRange(usageStats, apiKey, range) {
  return usageStats.getPersonalRange(apiKey, range);
}

async function getDepartmentRanking(usageStats, range) {
  return usageStats.getDepartmentRanking(range);
}

async function getDepartmentUsers(usageStats, departmentId, range) {
  return usageStats.getDepartmentUsers(departmentId, range);
}

async function getDepartmentExportWorkbook(usageStats, range) {
  const departments = await usageStats.getDepartmentRanking(range);
  const entries = await Promise.all(departments.map(async row => [row.department_id, await usageStats.getDepartmentUsers(row.department_id, range)]));
  const usersByDepartment = Object.fromEntries(entries);
  const rangeBounds = await usageStats.getDepartmentRangeBounds(range);
  return buildDepartmentExportWorkbook(DEPARTMENT_RANGE_LABELS[range] || '排行', departments, usersByDepartment, rangeBounds);
}

module.exports = {
  getDepartmentExportWorkbook,
  getDepartmentRanking,
  getDepartmentUsers,
  getPersonalRange,
  getRanking,
};

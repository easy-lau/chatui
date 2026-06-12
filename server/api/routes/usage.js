const { readBody, parseJson } = require('../../http/body');
const JSZip = require('jszip');

const RANGES = new Set(['today', 'yesterday', 'total']);
const DEPARTMENT_RANGES = new Set(['today', 'yesterday', 'month', 'last_month', 'total']);
const USAGE_REFRESH_LIMIT = 6;
const USAGE_REFRESH_WINDOW_MS = 60 * 1000;
const usageRefreshBuckets = new Map();

function getClientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function checkUsageRefreshLimit(req, name) {
  const key = `${name}:${getClientKey(req)}`;
  const now = Date.now();
  let bucket = usageRefreshBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + USAGE_REFRESH_WINDOW_MS };
    usageRefreshBuckets.set(key, bucket);
  }
  if (bucket.count >= USAGE_REFRESH_LIMIT) {
    return { allowed: false, resetMs: Math.max(0, bucket.resetAt - now) };
  }
  bucket.count += 1;
  return { allowed: true, remaining: Math.max(0, USAGE_REFRESH_LIMIT - bucket.count), resetMs: Math.max(0, bucket.resetAt - now) };
}

function usageRateLimitHeaders(result = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'X-RateLimit-Limit': String(USAGE_REFRESH_LIMIT),
    'X-RateLimit-Remaining': String(result.remaining || 0),
    'Retry-After': String(Math.max(1, Math.ceil(Number(result.resetMs || 0) / 1000))),
  };
}

function unavailablePayload() {
  return {
    available: false,
    reason: 'PostgreSQL 未配置，使用统计功能未启用',
    ranking: [],
    personal: null,
  };
}

function departmentUnavailablePayload(reason = '部门统计密码未配置，部门统计功能未启用') {
  return {
    available: false,
    reason,
    ranking: [],
  };
}

function rangeFromUrl(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  const range = String(url.searchParams.get('range') || 'today').trim();
  return RANGES.has(range) ? range : null;
}

function departmentPassword() {
  return String(process.env.USAGE_DEPARTMENT_PASSWORD || process.env.USAGE_STATS_DEPARTMENT_PASSWORD || '').trim();
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return require('crypto').timingSafeEqual(left, right);
}

function isDepartmentPasswordValid(password) {
  const expected = departmentPassword();
  return Boolean(expected) && constantTimeEquals(password, expected);
}

async function readJsonBody(req, res, sendJson) {
  try {
    return parseJson(await readBody(req));
  } catch (err) {
    sendJson(res, 400, { error: { message: err.message || '请求体不是有效 JSON' } }, { 'Access-Control-Allow-Origin': '*' });
    return null;
  }
}

function validateDepartmentAccess(body, res, sendJson) {
  if (!departmentPassword()) {
    sendJson(res, 200, departmentUnavailablePayload(), { 'Access-Control-Allow-Origin': '*' });
    return false;
  }
  const password = String(body?.password || body?.departmentPassword || '').trim();
  if (!isDepartmentPasswordValid(password)) {
    sendJson(res, 403, { available: true, authorized: false, error: { message: '密码错误，无权限访问' } }, { 'Access-Control-Allow-Origin': '*' });
    return false;
  }
  return true;
}

function safeXml(value) {
  return String(value ?? '').replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));
}

function safeSheetName(value) {
  const cleaned = String(value || '统计').replace(/[\\/?*\[\]:]/g, '').slice(0, 31);
  return cleaned || '统计';
}

function formatDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function uniqueSheetNames(names = []) {
  const used = new Map();
  return names.map(name => {
    const base = safeSheetName(name);
    const count = (used.get(base) || 0) + 1;
    used.set(base, count);
    if (count === 1) return base;
    const suffix = `_${count}`;
    return `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
  });
}

function columnName(index) {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
}

function xlsxCell(value, columnIndex, rowIndex) {
  const ref = `${columnName(columnIndex)}${rowIndex}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${safeXml(value)}</t></is></c>`;
}

function xlsxWorksheet(headers, rows) {
  const allRows = [headers, ...rows];
  const rowXml = allRows.map((row, rowIndex) => {
    const excelRow = rowIndex + 1;
    return `<row r="${excelRow}">${row.map((value, columnIndex) => xlsxCell(value, columnIndex, excelRow)).join('')}</row>`;
  }).join('');
  const columnCount = Math.max(headers.length, ...rows.map(row => row.length));
  const dimension = columnCount > 0 ? `A1:${columnName(columnCount - 1)}${Math.max(1, allRows.length)}` : 'A1';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="${dimension}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

async function buildDepartmentExportWorkbook(rangeLabel, departments = [], usersByDepartment = {}, rangeBounds = {}) {
  const startTime = formatDateTime(rangeBounds.start_time);
  const endTime = formatDateTime(rangeBounds.end_time);
  const headers = ['序号', '部门名称', '开始时间', '结束时间', '总用量', '输入', '输出', '缓存输入', '推理输出'];
  const userHeaders = ['序号', '用户名称', '开始时间', '结束时间', '总用量', '输入', '输出', '缓存输入', '推理输出'];
  const departmentRows = departments.map((row, index) => [index + 1, row.department_name, startTime, endTime, row.total_tokens, row.prompt_tokens, row.completion_tokens, row.prompt_cached_tokens, row.completion_reasoning_tokens]);
  const sheetDefs = [{ name: `部门${rangeLabel}统计`, headers, rows: departmentRows }];
  departments.forEach(row => {
    const userRows = (usersByDepartment[row.department_id] || []).map((user, index) => [index + 1, user.username, startTime, endTime, user.total_tokens, user.prompt_tokens, user.completion_tokens, user.prompt_cached_tokens, user.completion_reasoning_tokens]);
    sheetDefs.push({ name: `${row.department_name || row.department_id}${rangeLabel}统计`, headers: userHeaders, rows: userRows });
  });
  const sheetNames = uniqueSheetNames(sheetDefs.map(sheet => sheet.name));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetDefs.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n  ')}
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetNames.map((name, index) => `<sheet name="${safeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetDefs.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('\n  ')}
</Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);
  sheetDefs.forEach((sheet, index) => {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, xlsxWorksheet(sheet.headers, sheet.rows));
  });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function createUsageRoutes({ sendJson, sendMethodNotAllowed, usageStats, send }) {
  async function routeRankings(req, res) {
    if (req.method !== 'GET') return sendMethodNotAllowed(res);
    const limitResult = checkUsageRefreshLimit(req, 'rankings');
    if (!limitResult.allowed) {
      return sendJson(res, 200, {
        available: true,
        limited: true,
        message: '请不要频繁刷新，请一分钟后重试',
        ranking: [],
      }, usageRateLimitHeaders(limitResult));
    }
    if (!usageStats) return sendJson(res, 200, unavailablePayload(), { 'Access-Control-Allow-Origin': '*' });
    const range = rangeFromUrl(req);
    if (!range) return sendJson(res, 400, { error: { message: '不支持的排行范围' } }, { 'Access-Control-Allow-Origin': '*' });
    try {
      const ranking = await usageStats.getRanking(range);
      return sendJson(res, 200, { available: true, range, ranking }, { 'Access-Control-Allow-Origin': '*' });
    } catch (err) {
      console.error('[usage] rankings query failed:', err);
      return sendJson(res, 500, { error: { message: '查询使用排行榜失败' } }, { 'Access-Control-Allow-Origin': '*' });
    }
  }

  async function routePersonal(req, res) {
    if (req.method !== 'POST') return sendMethodNotAllowed(res);
    const body = await readJsonBody(req, res, sendJson);
    if (!body) return;
    const apiKey = String(body?.api_key || body?.apiKey || '').trim();
    if (!apiKey) return sendJson(res, 400, { error: { message: '缺少 api_key' } }, { 'Access-Control-Allow-Origin': '*' });
    const range = String(body?.range || 'today').trim();
    if (!RANGES.has(range)) return sendJson(res, 400, { error: { message: '不支持的统计范围' } }, { 'Access-Control-Allow-Origin': '*' });
    const limitResult = checkUsageRefreshLimit(req, 'personal');
    if (!limitResult.allowed) {
      return sendJson(res, 200, {
        available: true,
        limited: true,
        message: '请不要频繁刷新，请一分钟后重试',
        personal: null,
      }, usageRateLimitHeaders(limitResult));
    }
    if (!usageStats) return sendJson(res, 200, unavailablePayload(), { 'Access-Control-Allow-Origin': '*' });
    try {
      const personal = await usageStats.getPersonalRange(apiKey, range);
      return sendJson(res, 200, { available: true, range, personal }, { 'Access-Control-Allow-Origin': '*' });
    } catch (err) {
      console.error('[usage] personal query failed:', err);
      return sendJson(res, 500, { error: { message: '查询个人使用统计失败' } }, { 'Access-Control-Allow-Origin': '*' });
    }
  }

  async function routeDepartmentVerify(req, res) {
    if (req.method !== 'POST') return sendMethodNotAllowed(res);
    const body = await readJsonBody(req, res, sendJson);
    if (!body) return;
    if (!departmentPassword()) return sendJson(res, 200, departmentUnavailablePayload(), { 'Access-Control-Allow-Origin': '*' });
    if (!isDepartmentPasswordValid(String(body?.password || '').trim())) {
      return sendJson(res, 403, { available: true, authorized: false, error: { message: '密码错误，无权限访问' } }, { 'Access-Control-Allow-Origin': '*' });
    }
    return sendJson(res, 200, { available: true, authorized: true }, { 'Access-Control-Allow-Origin': '*' });
  }

  async function routeDepartmentRankings(req, res) {
    if (req.method !== 'POST') return sendMethodNotAllowed(res);
    const body = await readJsonBody(req, res, sendJson);
    if (!body) return;
    if (!validateDepartmentAccess(body, res, sendJson)) return;
    if (!usageStats) return sendJson(res, 200, departmentUnavailablePayload('PostgreSQL 未配置，部门统计功能未启用'), { 'Access-Control-Allow-Origin': '*' });
    const range = String(body?.range || 'today').trim();
    if (!DEPARTMENT_RANGES.has(range)) return sendJson(res, 400, { error: { message: '不支持的部门统计范围' } }, { 'Access-Control-Allow-Origin': '*' });
    try {
      const ranking = await usageStats.getDepartmentRanking(range);
      return sendJson(res, 200, { available: true, range, ranking }, { 'Access-Control-Allow-Origin': '*' });
    } catch (err) {
      console.error('[usage] department rankings query failed:', err);
      return sendJson(res, 500, { error: { message: '查询部门统计失败' } }, { 'Access-Control-Allow-Origin': '*' });
    }
  }

  async function routeDepartmentUsers(req, res) {
    if (req.method !== 'POST') return sendMethodNotAllowed(res);
    const body = await readJsonBody(req, res, sendJson);
    if (!body) return;
    if (!validateDepartmentAccess(body, res, sendJson)) return;
    if (!usageStats) return sendJson(res, 200, departmentUnavailablePayload('PostgreSQL 未配置，部门统计功能未启用'), { 'Access-Control-Allow-Origin': '*' });
    const range = String(body?.range || 'today').trim();
    const departmentId = String(body?.department_id || body?.departmentId || '').trim();
    if (!DEPARTMENT_RANGES.has(range)) return sendJson(res, 400, { error: { message: '不支持的部门统计范围' } }, { 'Access-Control-Allow-Origin': '*' });
    if (!departmentId) return sendJson(res, 400, { error: { message: '缺少部门主键' } }, { 'Access-Control-Allow-Origin': '*' });
    try {
      const users = await usageStats.getDepartmentUsers(departmentId, range);
      return sendJson(res, 200, { available: true, range, department_id: departmentId, users }, { 'Access-Control-Allow-Origin': '*' });
    } catch (err) {
      console.error('[usage] department users query failed:', err);
      return sendJson(res, 500, { error: { message: '查询部门用户统计失败' } }, { 'Access-Control-Allow-Origin': '*' });
    }
  }

  async function routeDepartmentExport(req, res) {
    if (req.method !== 'POST') return sendMethodNotAllowed(res);
    const body = await readJsonBody(req, res, sendJson);
    if (!body) return;
    if (!validateDepartmentAccess(body, res, sendJson)) return;
    if (!usageStats) return sendJson(res, 200, departmentUnavailablePayload('PostgreSQL 未配置，部门统计功能未启用'), { 'Access-Control-Allow-Origin': '*' });
    const range = String(body?.range || 'today').trim();
    if (!DEPARTMENT_RANGES.has(range)) return sendJson(res, 400, { error: { message: '不支持的部门统计范围' } }, { 'Access-Control-Allow-Origin': '*' });
    try {
      const departments = await usageStats.getDepartmentRanking(range);
      const entries = await Promise.all(departments.map(async row => [row.department_id, await usageStats.getDepartmentUsers(row.department_id, range)]));
      const usersByDepartment = Object.fromEntries(entries);
      const rangeBounds = await usageStats.getDepartmentRangeBounds(range);
      const labels = { today: '今日排行', yesterday: '昨日排行', month: '本月排行', last_month: '上月排行', total: '总排行' };
      const workbook = await buildDepartmentExportWorkbook(labels[range] || '排行', departments, usersByDepartment, rangeBounds);
      if (typeof send === 'function') {
        return send(res, 200, workbook, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="department-usage-${range}.xlsx"`,
        });
      }
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="department-usage-${range}.xlsx"`,
      });
      return res.end(workbook);
    } catch (err) {
      console.error('[usage] department export failed:', err);
      return sendJson(res, 500, { error: { message: '导出部门统计失败' } }, { 'Access-Control-Allow-Origin': '*' });
    }
  }

  function routeUsage(req, res) {
    const pathname = String(req.url || '').split('?')[0];
    if (pathname === '/api/usage/rankings') return routeRankings(req, res);
    if (pathname === '/api/usage/personal') return routePersonal(req, res);
    if (pathname === '/api/usage/department/verify') return routeDepartmentVerify(req, res);
    if (pathname === '/api/usage/department/rankings') return routeDepartmentRankings(req, res);
    if (pathname === '/api/usage/department/users') return routeDepartmentUsers(req, res);
    if (pathname === '/api/usage/department/export') return routeDepartmentExport(req, res);
    return sendJson(res, 404, { error: { message: '未找到使用统计接口' } }, { 'Access-Control-Allow-Origin': '*' });
  }

  return { routeUsage };
}

module.exports = { createUsageRoutes, buildDepartmentExportWorkbook, isDepartmentPasswordValid };

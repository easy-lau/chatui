const { sendJson } = require('../http/response');
const { readBody, parseJson } = require('../http/body');
const { normalizeExtraHeaders } = require('../proxy/headers');
const { normalizeBaseUrl } = require('../security/url-policy');
const { getJobIdFromUrl, publicJob, createJobEvents } = require('./events');

function makeJobId(value = '') {
  const supplied = String(value || '').trim();
  if (/^(imgjob|chatjob)-[a-z0-9-]{8,80}$/i.test(supplied)) return supplied;
  return `imgjob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function extractProxyRequest(req, res) {
  let body;
  try {
    body = parseJson(await readBody(req));
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: { message: err.message || String(err), code: err.code || 'INVALID_REQUEST_BODY' } });
    return null;
  }
  const baseUrl = normalizeBaseUrl(body.baseUrl);
  const apiKey = String(body.apiKey || '').trim();
  const extraHeaders = normalizeExtraHeaders(body.headers || body.extraHeaders);
  if (!baseUrl) {
    sendJson(res, 400, { error: { message: '缺少或非法 baseUrl', code: 'INVALID_BASE_URL' } });
    return null;
  }
  return { body, baseUrl, apiKey, extraHeaders };
}

function createUpstreamFetch(url, { method, headers, body, job, upstreamTimeoutMs }) {
  const controller = new AbortController();
  if (job) job.controller = controller;
  const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  const response = fetch(url, { method, headers, body, signal: controller.signal });
  return { response, controller, timer };
}

function safeParseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function respondJobError(res, err) {
  sendJson(res, err.statusCode || 500, { error: { message: err.message || String(err) } });
}

function findJobOr404(store, id, res) {
  const job = store.get(id);
  if (!job) sendJson(res, 404, { error: { message: '任务不存在或服务已重启' } });
  return job;
}

module.exports = { makeJobId, getJobIdFromUrl, publicJob, createJobEvents, extractProxyRequest, createUpstreamFetch, safeParseJson, respondJobError, findJobOr404 };

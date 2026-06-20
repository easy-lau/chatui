const assert = require('assert');

const { createApp } = require('../../server/app');
const { createUsageRoutes } = require('../../server/api/routes/usage');
const { sendJson, sendMethodNotAllowed } = require('../../server/http/response');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
  });
}

async function request(baseUrl, path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, { redirect: 'manual', ...options });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { res, text, json };
}

async function withServer(run) {
  const { server } = createApp();
  const baseUrl = await listen(server);
  try {
    await run(baseUrl);
  } finally {
    await close(server);
  }
}

function assertCorsJson(response) {
  assert.strictEqual(response.res.headers.get('access-control-allow-origin'), '*');
  assert.match(response.res.headers.get('content-type') || '', /application\/json/);
}

function assertJson(response) {
  assert.match(response.res.headers.get('content-type') || '', /application\/json/);
}

function createMockResponse() {
  return {
    status: null,
    headers: {},
    body: '',
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(body = '') { this.body = String(body || ''); },
  };
}

async function invokeUsageRoute(path, { method = 'GET', body = '', usageStats = {} } = {}) {
  const { routeUsage } = createUsageRoutes({ sendJson, sendMethodNotAllowed, usageStats });
  const req = {
    url: path,
    method,
    headers: {},
    socket: { remoteAddress: 'contract-test' },
    setEncoding() {},
    on(event, fn) {
      if (event === 'data' && body) process.nextTick(() => fn(body));
      if (event === 'end') process.nextTick(fn);
      return this;
    },
  };
  const res = createMockResponse();
  await routeUsage(req, res);
  return { status: res.status, headers: res.headers, json: JSON.parse(res.body || 'null') };
}

async function testApiContractCoreEndpointsKeepShape() {
  await withServer(async baseUrl => {
    const version = await request(baseUrl, '/api/version');
    assert.strictEqual(version.res.status, 200);
    assertCorsJson(version);
    assert.deepStrictEqual(Object.keys(version.json).sort(), ['version']);
    assert.strictEqual(typeof version.json.version, 'string');

    const publicConfig = await request(baseUrl, '/api/config/public');
    assert.strictEqual(publicConfig.res.status, 200);
    assertCorsJson(publicConfig);
    assert.strictEqual(typeof publicConfig.json.version, 'string');
    assert.ok(publicConfig.json.config && typeof publicConfig.json.config === 'object');
    assert.ok(publicConfig.json.config.ui && typeof publicConfig.json.config.ui === 'object');
    assert.ok(publicConfig.json.config.features && typeof publicConfig.json.config.features === 'object');
    assert.ok(publicConfig.json.config.context && typeof publicConfig.json.config.context === 'object');
    assert.strictEqual(typeof publicConfig.json.config.context.windowTokens, 'number');
  });
}

async function testApiContractMethodAndCorsPreflight() {
  await withServer(async baseUrl => {
    const options = await request(baseUrl, '/api/version', { method: 'OPTIONS' });
    assert.strictEqual(options.res.status, 204);
    assert.strictEqual(options.res.headers.get('access-control-allow-origin'), '*');
    assert.match(options.res.headers.get('access-control-allow-methods') || '', /GET,POST,OPTIONS/);
    assert.match(options.res.headers.get('access-control-allow-headers') || '', /Content-Type/);

    const wrongMethod = await request(baseUrl, '/api/version', { method: 'POST', body: '{}' });
    assert.strictEqual(wrongMethod.res.status, 405);
    assertJson(wrongMethod);
    assert.deepStrictEqual(wrongMethod.json, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
  });
}

async function testApiContractUsageUnavailableAndValidationShapes() {
  await withServer(async baseUrl => {
    const rankings = await request(baseUrl, '/api/usage/rankings?range=today');
    assert.strictEqual(rankings.res.status, 200);
    assertCorsJson(rankings);
    assert.deepStrictEqual(rankings.json, {
      available: false,
      reason: 'PostgreSQL 未配置，使用统计功能未启用',
      ranking: [],
      personal: null,
    });

    const invalidRangeWithoutDatabase = await request(baseUrl, '/api/usage/rankings?range=month');
    assert.strictEqual(invalidRangeWithoutDatabase.res.status, 200);
    assertCorsJson(invalidRangeWithoutDatabase);
    assert.deepStrictEqual(invalidRangeWithoutDatabase.json, {
      available: false,
      reason: 'PostgreSQL 未配置，使用统计功能未启用',
      ranking: [],
      personal: null,
    });

    const missingApiKey = await request(baseUrl, '/api/usage/personal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ range: 'today' }),
    });
    assert.strictEqual(missingApiKey.res.status, 400);
    assertCorsJson(missingApiKey);
    assert.deepStrictEqual(missingApiKey.json, { error: { message: '缺少 api_key' } });

    const unknownUsage = await request(baseUrl, '/api/usage/not-found');
    assert.strictEqual(unknownUsage.res.status, 404);
    assertCorsJson(unknownUsage);
    assert.deepStrictEqual(unknownUsage.json, { error: { message: '未找到使用统计接口' } });
  });
}

async function testApiContractUsageConfiguredValidationShapes() {
  const invalidRankingRange = await invokeUsageRoute('/api/usage/rankings?range=month', { usageStats: { async getRanking() { return []; } } });
  assert.strictEqual(invalidRankingRange.status, 400);
  assert.strictEqual(invalidRankingRange.headers['Access-Control-Allow-Origin'], '*');
  assert.deepStrictEqual(invalidRankingRange.json, { error: { message: '不支持的排行范围' } });

  const invalidPersonalRange = await invokeUsageRoute('/api/usage/personal', {
    method: 'POST',
    body: JSON.stringify({ api_key: 'sk-test', range: 'month' }),
    usageStats: { async getPersonalRange() { return null; } },
  });
  assert.strictEqual(invalidPersonalRange.status, 400);
  assert.strictEqual(invalidPersonalRange.headers['Access-Control-Allow-Origin'], '*');
  assert.deepStrictEqual(invalidPersonalRange.json, { error: { message: '不支持的统计范围' } });
}

async function testApiContractJobMissingAndAbortShapes() {
  await withServer(async baseUrl => {
    const missingChat = await request(baseUrl, '/api/chat-jobs/missing-job');
    assert.strictEqual(missingChat.res.status, 404);
    assertJson(missingChat);
    assert.deepStrictEqual(missingChat.json, { error: { message: '任务不存在或服务已重启' } });

    const abortMissingImage = await request(baseUrl, '/api/image-jobs/missing-job/abort', { method: 'POST' });
    assert.strictEqual(abortMissingImage.res.status, 404);
    assertJson(abortMissingImage);
    assert.deepStrictEqual(abortMissingImage.json, { error: { message: '任务不存在或服务已重启' } });

    const wrongMethod = await request(baseUrl, '/api/image-jobs/missing-job', { method: 'POST', body: '{}' });
    assert.strictEqual(wrongMethod.res.status, 405);
    assertJson(wrongMethod);
    assert.deepStrictEqual(wrongMethod.json, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
  });
}

module.exports = [
  testApiContractCoreEndpointsKeepShape,
  testApiContractMethodAndCorsPreflight,
  testApiContractUsageUnavailableAndValidationShapes,
  testApiContractUsageConfiguredValidationShapes,
  testApiContractJobMissingAndAbortShapes,
];

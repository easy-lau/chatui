const { SECURITY_HEADERS, send, sendJson } = require('../http/response');
const { readBody, parseJson } = require('../http/body');
const { normalizeExtraHeaders } = require('./headers');
const { normalizeBaseUrl } = require('../security/url-policy');

function withQueryParams(rawUrl, params) {
  const url = new URL(rawUrl);
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    for (const [key, value] of Object.entries(params)) {
      if (!key || value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        value.forEach(item => item !== undefined && item !== null && url.searchParams.append(key, String(item)));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function createOpenAiProxy({ chatJobs, makeChatJob, notifyJob, updateChatJobFromStreamChunk, upstreamTimeoutMs, allowedProxyMethods, allowedProxyPaths }) {
  async function proxy(req, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  let proxyChatJob = null;
  try {
    const targetPath = req.url.replace(/^\/api/, '').split('?')[0];
    if (!allowedProxyPaths.some(re => re.test(targetPath))) {
      return sendJson(res, 403, { error: { message: '不允许代理该路径' } });
    }

    const body = parseJson(await readBody(req));
    const baseUrl = normalizeBaseUrl(body.baseUrl);
    const apiKey = String(body.apiKey || '').trim();
    const payload = body.payload || {};
    const query = body.query || {};
    const extraHeaders = normalizeExtraHeaders(body.headers || body.extraHeaders);
    const method = String(body.method || 'POST').toUpperCase();
    const proxyJobId = String(body.jobId || '').trim();

    if (!baseUrl) return sendJson(res, 400, { error: { message: '缺少或非法 baseUrl' } });
    if (!allowedProxyMethods.has(method)) return sendJson(res, 405, { error: { message: '不支持的代理方法' } });

    const targetUrl = withQueryParams(`${baseUrl}${targetPath}`, query);
    const wantsStream = method !== 'GET' && payload && payload.stream === true;
    if (targetPath === '/chat/completions' && proxyJobId && wantsStream) {
      proxyChatJob = chatJobs.get(proxyJobId) || makeChatJob(proxyJobId, baseUrl, apiKey, payload, { stream: true });
      if (proxyChatJob.streamStarted) proxyChatJob = null;
      else {
        proxyChatJob.updatedAt = Date.now();
        proxyChatJob.streamStarted = true;
        chatJobs.set(proxyJobId, proxyChatJob);
        notifyJob(proxyChatJob);
      }
    }
    const upstream = await fetch(targetUrl.toString(), {
      method,
      signal: controller.signal,
      headers: {
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
        ...(wantsStream ? { Accept: 'text/event-stream' } : {}),
        ...extraHeaders,
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }),
    });

    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    const isEventStream = contentType.toLowerCase().includes('text/event-stream');

    if (wantsStream || isEventStream) {
      const chatJob = proxyChatJob;
      if (!chatJob && targetPath === '/chat/completions' && proxyJobId) {
        // 已有后台流式 job 接管时，当前页面直接通过 SSE 恢复，避免重复请求/重复输出。
        return sendJson(res, 409, { error: { message: '任务已在后台继续，请等待恢复连接' } }, { 'Access-Control-Allow-Origin': '*' });
      }
      res.writeHead(upstream.status, {
        ...SECURITY_HEADERS,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      if (!upstream.body) return res.end();
      let clientOpen = true;
      res.on('close', () => { clientOpen = false; });
      for await (const chunk of upstream.body) {
        const buf = Buffer.from(chunk);
        if (chatJob) updateChatJobFromStreamChunk(chatJob, buf.toString('utf8'));
        if (clientOpen && !res.destroyed) {
          try { res.write(buf); } catch { clientOpen = false; }
        }
      }
      if (chatJob) {
        chatJob.status = 'done';
        chatJob.updatedAt = Date.now();
        delete chatJob.buffer;
        notifyJob(chatJob);
      }
      if (clientOpen && !res.destroyed) res.end();
      return;
    }

    const text = await upstream.text();
    send(res, upstream.status, text, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
    });
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    const message = aborted ? '上游请求超时' : `连接上游接口失败：${err.message || String(err)}`;
    if (proxyChatJob) {
      proxyChatJob.status = 'error';
      proxyChatJob.error = message;
      proxyChatJob.updatedAt = Date.now();
      notifyJob(proxyChatJob);
    }
    if (!res.headersSent && !res.destroyed) {
      sendJson(res, err.statusCode || (aborted ? 504 : 502), { error: { message } });
    } else if (!res.destroyed) {
      res.end();
    }
  } finally {
    clearTimeout(timer);
  }
}

  async function proxyImage(req, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  try {
    const body = parseJson(await readBody(req));
    const baseUrl = normalizeBaseUrl(body.baseUrl);
    const apiKey = String(body.apiKey || '').trim();
    const extraHeaders = normalizeExtraHeaders(body.headers || body.extraHeaders);

    if (!baseUrl) return sendJson(res, 400, { error: { message: '缺少或非法 baseUrl' } });
    const imageUrl = new URL(String(body.url || '').trim());
    const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(imageUrl.protocol)) return sendJson(res, 400, { error: { message: '非法图片地址' } });
    if (imageUrl.origin !== base.origin) return sendJson(res, 403, { error: { message: '只允许代理同源图片地址' } });

    const upstream = await fetch(imageUrl.toString(), {
      method: 'GET',
      signal: controller.signal,
      headers: { ...extraHeaders, ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    });
    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok) {
      const text = await upstream.text();
      return sendJson(res, upstream.status, { error: { message: text || '图片下载失败' } });
    }
    if (!contentType.startsWith('image/')) {
      return sendJson(res, 415, { error: { message: '上游返回的不是图片' } });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    send(res, 200, buffer, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    sendJson(res, err.statusCode || (aborted ? 504 : 500), {
      error: { message: aborted ? '图片下载超时' : (err.message || String(err)) },
    });
  } finally {
    clearTimeout(timer);
  }
}

  return { proxy, proxyImage };
}

module.exports = { createOpenAiProxy, withQueryParams };

function createRouter(deps) {
  const {
    appVersion,
    send,
    sendJson,
    serveStatic,
    root,
    rootWithSep,
    proxy,
    proxyImage,
    extractFileText,
    imageJobs,
    chatJobs,
    abortJob,
    publicJob,
    subscribeJob,
    startImageJob,
    getImageJob,
    registerChatStreamJob,
    startChatJob,
    getChatJob,
  } = deps;

  return async function route(req, res) {
  if (req.method === 'OPTIONS') {
    return send(res, 204, '', {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
  }

  if (req.url === '/api/version') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
    return sendJson(res, 200, { version: appVersion }, { 'Access-Control-Allow-Origin': '*' });
  }

  if (req.url === '/api/image') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
    return proxyImage(req, res);
  }

  if (req.url === '/api/image-jobs') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
    return startImageJob(req, res);
  }

  if (req.url === '/api/chat-stream-jobs') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
    return registerChatStreamJob(req, res);
  }

  if (req.url === '/api/extract-file') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
    return extractFileText(req, res);
  }

  if (req.url === '/api/chat-jobs') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
    return startChatJob(req, res);
  }

  if (req.url.startsWith('/api/chat-jobs/')) {
    if (req.method === 'POST' && req.url.endsWith('/abort')) {
      const id = decodeURIComponent(req.url.split('?')[0].split('/').filter(Boolean).at(-2) || '');
      const job = abortJob(chatJobs, id);
      if (!job) return sendJson(res, 404, { error: { message: '任务不存在或服务已重启' } });
      return sendJson(res, 200, publicJob(job), { 'Access-Control-Allow-Origin': '*' });
    }
    if (req.method !== 'GET') return sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
    if (req.url.endsWith('/events')) return subscribeJob(req, res, chatJobs);
    return getChatJob(req, res);
  }

  if (req.url.startsWith('/api/image-jobs/')) {
    if (req.method === 'POST' && req.url.endsWith('/abort')) {
      const id = decodeURIComponent(req.url.split('?')[0].split('/').filter(Boolean).at(-2) || '');
      const job = abortJob(imageJobs, id);
      if (!job) return sendJson(res, 404, { error: { message: '任务不存在或服务已重启' } });
      return sendJson(res, 200, publicJob(job), { 'Access-Control-Allow-Origin': '*' });
    }
    if (req.method !== 'GET') return sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
    if (req.url.endsWith('/events')) return subscribeJob(req, res, imageJobs);
    return getImageJob(req, res);
  }

  if (req.url.startsWith('/api/')) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: { message: 'Method Not Allowed' } });
    return proxy(req, res);
  }

  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Method Not Allowed');

  return serveStatic(req, res, { root, rootWithSep });
  };
}

module.exports = { createRouter };

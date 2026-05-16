const fs = require('fs');
const path = require('path');
const { send } = require('./response');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function safeJoin(root, rootWithSep, urlPath) {
  try {
    const cleanPath = decodeURIComponent(urlPath.split('?')[0]);
    const filePath = path.normalize(path.join(root, cleanPath === '/' ? 'index.html' : cleanPath));
    if (filePath !== root && !filePath.startsWith(rootWithSep)) return null;
    return filePath;
  } catch {
    return null;
  }
}

function pickCompressedStaticFile(req, filePath) {
  const encoding = String(req.headers['accept-encoding'] || '');
  const ext = path.extname(filePath);
  if (!['.js', '.css'].includes(ext)) return { filePath, encoding: '' };
  const sourceMtime = fs.statSync(filePath).mtimeMs;
  const freshVariant = (suffix) => {
    const variantPath = `${filePath}${suffix}`;
    try {
      return fs.statSync(variantPath).mtimeMs >= sourceMtime ? variantPath : '';
    } catch {
      return '';
    }
  };
  const brPath = /\bbr\b/.test(encoding) ? freshVariant('.br') : '';
  if (brPath) return { filePath: brPath, encoding: 'br' };
  const gzipPath = /\bgzip\b/.test(encoding) ? freshVariant('.gz') : '';
  if (gzipPath) return { filePath: gzipPath, encoding: 'gzip' };
  return { filePath, encoding: '' };
}

function serveStatic(req, res, { root, rootWithSep }) {
  const filePath = safeJoin(root, rootWithSep, req.url);
  if (!filePath) return send(res, 403, 'Forbidden');

  fs.stat(filePath, (statErr) => {
    if (statErr) return send(res, 404, 'Not Found');
    const picked = pickCompressedStaticFile(req, filePath);
    fs.readFile(picked.filePath, (err, data) => {
      if (err) return send(res, 404, 'Not Found');
      const headers = {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': filePath.endsWith('index.html') || filePath.endsWith('.js') || filePath.endsWith('.css') ? 'no-cache' : 'public, max-age=3600',
        Vary: 'Accept-Encoding',
      };
      if (picked.encoding) headers['Content-Encoding'] = picked.encoding;
      if (req.method === 'HEAD') return send(res, 200, '', headers);
      send(res, 200, data, headers);
    });
  });
}

module.exports = { MIME, safeJoin, pickCompressedStaticFile, serveStatic };

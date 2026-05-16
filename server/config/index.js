const path = require('path');

const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '../..');
const ROOT_WITH_SEP = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || DEFAULT_UPSTREAM_TIMEOUT_MS);
const ALLOWED_PROXY_METHODS = new Set(['GET', 'POST']);
const ALLOWED_PROXY_PATHS = [/^\/models\/?$/, /^\/chat\/completions\/?$/, /^\/images\/(generations|edits)\/?$/];
const pkg = require('../../package.json');
const APP_VERSION = String(pkg.version || '0.0.0');

module.exports = {
  PORT,
  HOST,
  ROOT,
  ROOT_WITH_SEP,
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  UPSTREAM_TIMEOUT_MS,
  ALLOWED_PROXY_METHODS,
  ALLOWED_PROXY_PATHS,
  APP_VERSION,
};

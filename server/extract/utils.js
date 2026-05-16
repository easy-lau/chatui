const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

function optionalRequire(name) {
  try { return require(name); } catch { return null; }
}

function escapeXmlText(text = '') {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function decodeOpenXmlText(xml = '') {
  return escapeXmlText(String(xml || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ''));
}

function dataUrlToBuffer(dataUrl = '') {
  const base64 = String(dataUrl || '').includes(',') ? String(dataUrl).split(',')[1] : String(dataUrl || '');
  return Buffer.from(base64, 'base64');
}

function limitExtractedText(text = '', limit = 120000) {
  const clean = String(text || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}\n\n[内容过长，已截断到前 ${limit} 字符]` : clean;
}

function withAttachmentHeader(kind, filename, parser, text, note = '') {
  const intro = note || `解析说明：以下为使用 ${parser} 提取到的正文；请基于这些内容回答用户问题。`;
  return [`# ${kind} 附件：${filename}`, intro, limitExtractedText(text)].join('\n\n').slice(0, 125000);
}

function writeTempBuffer(buffer, filename) {
  const ext = path.extname(filename || '') || '.bin';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatui-extract-'));
  const file = path.join(dir, `attachment${ext}`);
  fs.writeFileSync(file, buffer);
  return { dir, file };
}

function cleanupTempDir(dir) {
  if (!dir) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 30000, maxBuffer: 20 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

async function commandExists(command) {
  try {
    await execFileText('sh', ['-c', `command -v ${command}`], { timeout: 5000, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function meaningfulExtractedText(text = '') {
  const clean = String(text || '')
    .replace(/^# .*附件：.*$/gm, '')
    .replace(/^解析说明：.*$/gm, '')
    .replace(/\[[^\]]*截断[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cjk = (clean.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (clean.match(/[A-Za-z0-9]/g) || []).length;
  return { clean, score: cjk * 2 + latin, cjk, latin };
}

function hasUsefulText(text = '', minScore = 80) {
  return meaningfulExtractedText(text).score >= minScore;
}

module.exports = {
  optionalRequire,
  escapeXmlText,
  decodeOpenXmlText,
  dataUrlToBuffer,
  limitExtractedText,
  withAttachmentHeader,
  writeTempBuffer,
  cleanupTempDir,
  execFileText,
  commandExists,
  meaningfulExtractedText,
  hasUsefulText,
};

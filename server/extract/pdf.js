const path = require('path');
const fs = require('fs');
const { optionalRequire, dataUrlToBuffer, limitExtractedText, withAttachmentHeader, writeTempBuffer, cleanupTempDir, execFileText, commandExists, meaningfulExtractedText, hasUsefulText } = require('./utils');

const pdfParseLib = optionalRequire('pdf-parse');

function decodePdfLiteralString(value = '') {
  return String(value || '')
    .replace(/\\([nrtbf()\\])/g, (_, ch) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[ch] || ch))
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodePdfHexString(hex = '') {
  const clean = String(hex || '').replace(/\s+/g, '');
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2).padEnd(2, '0'), 16));
  const buf = Buffer.from(bytes.filter(n => Number.isFinite(n)));
  if (buf.length >= 2 && ((buf[0] === 0xfe && buf[1] === 0xff) || (buf[0] === 0xff && buf[1] === 0xfe))) {
    const be = buf[0] === 0xfe;
    const chars = [];
    for (let i = 2; i + 1 < buf.length; i += 2) chars.push(String.fromCharCode(be ? (buf[i] << 8) + buf[i + 1] : (buf[i + 1] << 8) + buf[i]));
    return chars.join('').replace(/\s+/g, ' ').trim();
  }
  return buf.toString('utf8').replace(/\s+/g, ' ').trim();
}

function decodePdfUnicodeHex(hex = '') {
  const clean = String(hex || '').replace(/\s+/g, '');
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2).padEnd(2, '0'), 16));
  const buf = Buffer.from(bytes.filter(n => Number.isFinite(n)));
  const start = buf.length >= 2 && ((buf[0] === 0xfe && buf[1] === 0xff) || (buf[0] === 0xff && buf[1] === 0xfe)) ? 2 : 0;
  const be = !(buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe);
  if (buf.length - start >= 2 && (buf.length - start) % 2 === 0) {
    const chars = [];
    for (let i = start; i + 1 < buf.length; i += 2) chars.push(String.fromCharCode(be ? (buf[i] << 8) + buf[i + 1] : (buf[i + 1] << 8) + buf[i]));
    return chars.join('').replace(/\s+/g, ' ').trim();
  }
  return buf.toString('utf8').replace(/\s+/g, ' ').trim();
}

function parsePdfObjects(latin = '') {
  const objects = new Map();
  const re = /(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g;
  let m;
  while ((m = re.exec(latin))) objects.set(m[1], m[2]);
  return objects;
}

function parsePdfToUnicodeMap(cmap = '') {
  const map = new Map();
  const oneRe = /beginbfchar([\s\S]*?)endbfchar/g;
  const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  let block;
  while ((block = oneRe.exec(cmap))) {
    const pairRe = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g;
    let p;
    while ((p = pairRe.exec(block[1]))) map.set(p[1].toUpperCase(), decodePdfUnicodeHex(p[2]));
  }
  while ((block = rangeRe.exec(cmap))) {
    const lineRe = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+(?:<([0-9A-Fa-f]+)>|\[([^\]]+)\])/g;
    let r;
    while ((r = lineRe.exec(block[1]))) {
      const start = parseInt(r[1], 16);
      const end = parseInt(r[2], 16);
      if (r[3]) {
        const base = parseInt(r[3], 16);
        const width = r[3].length;
        for (let code = start; code <= end && code - start < 512; code++) {
          const key = code.toString(16).toUpperCase().padStart(r[1].length, '0');
          const val = (base + code - start).toString(16).toUpperCase().padStart(width, '0');
          map.set(key, decodePdfUnicodeHex(val));
        }
      } else if (r[4]) {
        const vals = [...r[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map(m => m[1]);
        vals.forEach((val, i) => map.set((start + i).toString(16).toUpperCase().padStart(r[1].length, '0'), decodePdfUnicodeHex(val)));
      }
    }
  }
  return map;
}

function buildPdfUnicodeMaps(latin = '') {
  const objects = parsePdfObjects(latin);
  const maps = [];
  for (const [id, obj] of objects.entries()) {
    const stream = obj.match(/stream\r?\n([\s\S]*?)\r?\nendstream/)?.[1] || obj;
    let text = stream;
    if (/FlateDecode/.test(obj)) {
      try { text = require('zlib').inflateSync(Buffer.from(stream, 'latin1')).toString('latin1'); } catch {}
    }
    if (!/beginbfchar|beginbfrange/.test(text)) continue;
    const map = parsePdfToUnicodeMap(text);
    if (map.size) maps.push({ id, map });
  }
  return maps;
}

function decodePdfHexWithMaps(hex = '', maps = []) {
  const clean = String(hex || '').replace(/\s+/g, '').toUpperCase();
  for (const { map } of maps) {
    let out = '';
    let ok = 0;
    for (let i = 0; i < clean.length;) {
      let hit = '';
      let hitLen = 0;
      for (const len of [8, 6, 4, 2]) {
        const key = clean.slice(i, i + len);
        if (key && map.has(key)) { hit = map.get(key); hitLen = len; break; }
      }
      if (hitLen) { out += hit; ok++; i += hitLen; }
      else { i += 2; }
    }
    if (ok && out.trim()) return out.replace(/\s+/g, ' ').trim();
  }
  return decodePdfHexString(clean);
}

function extractPdfTextFromStream(stream = '', unicodeMaps = []) {
  const chunks = [];
  const literalRe = /\((?:\\.|[^\\()])*\)\s*Tj/g;
  const arrayRe = /\[((?:\s*(?:\((?:\\.|[^\\()])*\)|<[^>]+>|-?\d+(?:\.\d+)?))+\s*)\]\s*TJ/g;
  const hexRe = /<([0-9a-fA-F\s]+)>\s*Tj/g;
  let m;
  while ((m = literalRe.exec(stream))) chunks.push(decodePdfLiteralString(m[0].replace(/\s*Tj$/, '').slice(1, -1)));
  while ((m = hexRe.exec(stream))) chunks.push(decodePdfHexWithMaps(m[1], unicodeMaps));
  while ((m = arrayRe.exec(stream))) {
    const arr = m[1] || '';
    const parts = [];
    const tokenRe = /\((?:\\.|[^\\()])*\)|<([0-9a-fA-F\s]+)>/g;
    let t;
    while ((t = tokenRe.exec(arr))) {
      if (t[0].startsWith('(')) parts.push(decodePdfLiteralString(t[0].slice(1, -1)));
      else parts.push(decodePdfHexWithMaps(t[1] || '', unicodeMaps));
    }
    if (parts.length) chunks.push(parts.join(''));
  }
  return chunks.filter(Boolean).join('\n');
}

async function extractPdfWithPdftotext(filename, buffer) {
  const { dir, file } = writeTempBuffer(buffer, filename);
  try {
    const text = await execFileText('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-']);
    if (!text.trim()) throw new Error('pdftotext 未提取到文本');
    return withAttachmentHeader('PDF', filename, 'Poppler/pdftotext', text, '解析说明：以下为使用 Poppler/pdftotext 提取到的 PDF 正文；对中文字体映射支持更稳定。');
  } finally {
    cleanupTempDir(dir);
  }
}

async function extractPdfWithPdfParse(filename, buffer) {
  if (!pdfParseLib?.PDFParse) throw new Error('pdf-parse 未安装');
  const parser = new pdfParseLib.PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    if (!String(result?.text || '').trim()) throw new Error('pdf-parse 未提取到文本');
    return withAttachmentHeader('PDF', filename, 'pdf-parse/pdf.js', result.text, '解析说明：以下为使用 pdf.js 提取到的 PDF 正文；对部分中文字体映射有支持。');
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractPdfWithOcr(filename, buffer) {
  const hasPdftoppm = await commandExists('pdftoppm');
  const hasTesseract = await commandExists('tesseract');
  if (!hasPdftoppm || !hasTesseract) {
    throw new Error('OCR 依赖不可用：需要 pdftoppm 和 tesseract');
  }
  const { dir, file } = writeTempBuffer(buffer, filename);
  try {
    const prefix = path.join(dir, 'page');
    await execFileText('pdftoppm', ['-r', '220', '-png', '-f', '1', '-l', '20', file, prefix], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
    const pages = fs.readdirSync(dir)
      .filter(name => /^page-\d+\.png$/i.test(name))
      .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));
    if (!pages.length) throw new Error('PDF 未能转换为页面图片');
    const chunks = [];
    for (const page of pages) {
      const imagePath = path.join(dir, page);
      const pageNo = Number(page.match(/\d+/)?.[0] || chunks.length + 1);
      try {
        const text = await execFileText('tesseract', [imagePath, 'stdout', '-l', 'chi_sim+eng', '--psm', '6'], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
        const clean = limitExtractedText(text, 20000);
        if (clean) chunks.push(`## 第 ${pageNo} 页\n${clean}`);
      } catch (err) {
        chunks.push(`## 第 ${pageNo} 页\n[OCR 失败：${err.message || String(err)}]`);
      }
    }
    const text = chunks.join('\n\n').trim();
    if (!text || !hasUsefulText(text, 20)) throw new Error('OCR 未提取到可用文本');
    return withAttachmentHeader('PDF', filename, 'Tesseract OCR chi_sim+eng', text, '解析说明：该 PDF 可能是扫描件/图片型 PDF，以下为先将页面转图片后使用 Tesseract OCR（简体中文+英文）识别到的文本。');
  } finally {
    cleanupTempDir(dir);
  }
}

function extractPdfTextBasic(filename, dataUrl, inputBuffer = null) {
  const zlib = require('zlib');
  const buffer = inputBuffer || dataUrlToBuffer(dataUrl);
  const latin = buffer.toString('latin1');
  const unicodeMaps = buildPdfUnicodeMaps(latin);
  const chunks = [`# PDF 附件：${filename}`, '解析说明：以下为从 PDF 文本流中提取到的正文；扫描件或复杂编码 PDF 可能只能提取部分内容。'];
  let extracted = '';
  const streamRe = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = streamRe.exec(latin))) {
    let data = Buffer.from(m[2], 'latin1');
    const dict = m[1] || '';
    try {
      if (/FlateDecode/.test(dict)) data = zlib.inflateSync(data);
      const text = extractPdfTextFromStream(data.toString('latin1'), unicodeMaps) || extractPdfTextFromStream(data.toString('utf8'), unicodeMaps);
      if (text) extracted += `\n${text}`;
    } catch {}
    if (extracted.length > 120000) break;
  }
  if (!extracted.trim()) {
    extracted = '未能从该 PDF 中提取到可用文本。它可能是扫描件、图片型 PDF，或使用了复杂字体编码；请使用 OCR 或导出为文本后再上传。';
  }
  chunks.push(extracted.trim());
  return chunks.join('\n\n').slice(0, 120000);
}

async function extractPdfText(filename, dataUrl) {
  const buffer = dataUrlToBuffer(dataUrl);
  const attempts = [];
  try {
    const text = await extractPdfWithPdftotext(filename, buffer);
    if (hasUsefulText(text)) return text;
    attempts.push(text);
  } catch {}
  try {
    const text = await extractPdfWithPdfParse(filename, buffer);
    if (hasUsefulText(text)) return text;
    attempts.push(text);
  } catch {}
  const basic = extractPdfTextBasic(filename, dataUrl, buffer);
  if (hasUsefulText(basic)) return basic;
  attempts.push(basic);
  try { return await extractPdfWithOcr(filename, buffer); }
  catch (err) {
    const fallback = attempts.find(Boolean) || basic;
    if (fallback && meaningfulExtractedText(fallback).clean) {
      return `${fallback}\n\n[OCR 未执行成功：${err.message || String(err)}]`;
    }
    return withAttachmentHeader('PDF', filename, 'PDF/OCR fallback', `未能从该 PDF 中提取到可用文本。它可能是扫描件/图片型 PDF；OCR 未执行成功：${err.message || String(err)}。请确认 Docker 镜像已安装 poppler-utils、tesseract-ocr、tesseract-ocr-data-chi_sim 和 tesseract-ocr-data-eng。`);
  }
}


module.exports = { extractPdfText };

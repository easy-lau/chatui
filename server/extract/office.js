const { dataUrlToBuffer, withAttachmentHeader, writeTempBuffer, cleanupTempDir, optionalRequire } = require('./utils');
const { zipEntriesFromBuffer, getZipText, escapeXmlText, decodeOpenXmlText } = require('./zip-openxml');

const mammothLib = optionalRequire('mammoth');
const officeParserLib = optionalRequire('officeparser');

function parseWorkbookSheets(xml = '') {
  const sheets = [];
  const re = /<sheet\b([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1] || '';
    const name = attrs.match(/name="([^"]*)"/)?.[1] || `Sheet${sheets.length + 1}`;
    const id = attrs.match(/r:id="([^"]*)"/)?.[1] || '';
    sheets.push({ name: escapeXmlText(name), id });
  }
  return sheets;
}

function parseWorkbookRels(xml = '') {
  const rels = new Map();
  const re = /<Relationship\b([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1] || '';
    const id = attrs.match(/Id="([^"]*)"/)?.[1] || '';
    let target = attrs.match(/Target="([^"]*)"/)?.[1] || '';
    if (id && target) {
      if (!target.startsWith('xl/')) target = `xl/${target.replace(/^\.\//, '')}`;
      rels.set(id, target);
    }
  }
  return rels;
}

function parseSharedStrings(xml = '') {
  const result = [];
  const siRe = /<si\b[\s\S]*?<\/si>/g;
  const textRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let si;
  while ((si = siRe.exec(xml))) {
    const parts = [];
    let t;
    while ((t = textRe.exec(si[0]))) parts.push(escapeXmlText(t[1] || ''));
    result.push(parts.join(''));
  }
  return result;
}

function columnIndexFromCell(ref = '') {
  const letters = String(ref).match(/[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

function cellValue(cellXml, sharedStrings) {
  const type = cellXml.match(/\bt="([^"]+)"/)?.[1] || '';
  if (type === 'inlineStr') return decodeOpenXmlText(cellXml.match(/<is>([\s\S]*?)<\/is>/)?.[1] || '');
  const value = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '';
  if (!value) return '';
  if (type === 's') return sharedStrings[Number(value)] || '';
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
  return escapeXmlText(value);
}

function parseWorksheetPreview(xml = '', sharedStrings = [], maxRows = 80, maxCols = 40) {
  const rows = [];
  const rowRe = /<row\b[\s\S]*?<\/row>/g;
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let row;
  while ((row = rowRe.exec(xml)) && rows.length < maxRows) {
    const values = [];
    let cell;
    while ((cell = cellRe.exec(row[0]))) {
      const ref = cell[1].match(/r="([^"]+)"/)?.[1] || '';
      const col = Math.min(columnIndexFromCell(ref), maxCols);
      const value = cellValue(`<c ${cell[1]}>${cell[2]}</c>`, sharedStrings);
      if (value) values[col - 1] = value;
    }
    const trimmed = values.slice(0, maxCols).map(v => String(v || '').replace(/\s+/g, ' ').trim());
    if (trimmed.some(Boolean)) rows.push(trimmed);
  }
  return rows;
}

function rowsToMarkdown(rows) {
  if (!rows.length) return '_空表或未读取到可见文本_';
  const width = Math.min(Math.max(...rows.map(r => r.length)), 12);
  const norm = rows.map(r => Array.from({ length: width }, (_, i) => String(r[i] || '').replace(/\|/g, '\\|')));
  const header = norm[0];
  const body = norm.slice(1);
  return ['| ' + header.join(' | ') + ' |', '| ' + header.map(() => '---').join(' | ') + ' |', ...body.map(r => '| ' + r.join(' | ') + ' |')].join('\n');
}

async function parseOfficeWithOfficeParser(buffer, filename) {
  if (!officeParserLib?.parseOffice) throw new Error('officeparser 未安装');
  const { dir, file } = writeTempBuffer(buffer, filename);
  try {
    const ast = await officeParserLib.parseOffice(file, {
      newlineDelimiter: '\n',
      ignoreNotes: false,
      putNotesAtLast: true,
      outputErrorToConsole: false,
      includeBreakNodes: true,
    });
    return typeof ast?.toText === 'function' ? ast.toText() : String(ast || '');
  } finally {
    cleanupTempDir(dir);
  }
}

async function extractDocxWithMammoth(filename, buffer) {
  if (!mammothLib) throw new Error('mammoth 未安装');
  const result = await mammothLib.extractRawText({ buffer });
  return withAttachmentHeader('Word', filename, 'mammoth', result.value || '');
}

function extractXlsxText(filename, dataUrl, inputBuffer = null) {
  const buffer = inputBuffer || dataUrlToBuffer(dataUrl);
  const entries = zipEntriesFromBuffer(buffer);
  const workbook = getZipText(buffer, entries, 'xl/workbook.xml');
  const relXml = getZipText(buffer, entries, 'xl/_rels/workbook.xml.rels');
  const shared = parseSharedStrings(getZipText(buffer, entries, 'xl/sharedStrings.xml'));
  const rels = parseWorkbookRels(relXml);
  const sheets = parseWorkbookSheets(workbook).slice(0, 8);
  const chunks = [`# Excel 附件：${filename}`, `解析说明：以下为每个工作表前 80 行、前 40 列的文本预览；请基于这些内容回答用户问题。`];
  for (const sheet of sheets) {
    const target = rels.get(sheet.id) || `xl/worksheets/sheet${chunks.length - 1}.xml`;
    const xml = getZipText(buffer, entries, target);
    if (!xml) continue;
    const rows = parseWorksheetPreview(xml, shared);
    chunks.push(`\n## 工作表：${sheet.name}\n${rowsToMarkdown(rows)}`);
  }
  return chunks.join('\n\n').slice(0, 120000);
}

async function extractExcelText(filename, dataUrl) {
  const buffer = dataUrlToBuffer(dataUrl);
  try { return withAttachmentHeader('Excel', filename, 'officeparser', await parseOfficeWithOfficeParser(buffer, filename), '解析说明：以下为使用 officeparser 提取到的工作簿文本；中文、日期和公式显示值会尽量保留。'); }
  catch (primaryErr) {
    try { return extractXlsxText(filename, dataUrl, buffer); }
    catch { throw primaryErr; }
  }
}

function slideNumberFromName(name = '') {
  return Number(String(name).match(/slide(\d+)\.xml$/)?.[1] || 0);
}

function extractPptxText(filename, dataUrl, inputBuffer = null) {
  const buffer = inputBuffer || dataUrlToBuffer(dataUrl);
  const entries = zipEntriesFromBuffer(buffer);
  const slideNames = [...entries.keys()]
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumberFromName(a) - slideNumberFromName(b))
    .slice(0, 80);
  const chunks = [`# PowerPoint 附件：${filename}`, '解析说明：以下为每页幻灯片提取到的文本；请基于这些内容回答用户问题。'];
  for (const name of slideNames) {
    const xml = getZipText(buffer, entries, name);
    const texts = [];
    const re = /<a:t>([\s\S]*?)<\/a:t>/g;
    let m;
    while ((m = re.exec(xml))) texts.push(escapeXmlText(m[1] || '').trim());
    const content = texts.filter(Boolean).join('\n').trim();
    if (content) chunks.push(`\n## 幻灯片 ${slideNumberFromName(name)}\n${content}`);
  }
  return chunks.join('\n\n').slice(0, 120000);
}

async function extractPowerPointText(filename, dataUrl) {
  const buffer = dataUrlToBuffer(dataUrl);
  try { return withAttachmentHeader('PowerPoint', filename, 'officeparser', await parseOfficeWithOfficeParser(buffer, filename)); }
  catch {
    return extractPptxText(filename, dataUrl, buffer);
  }
}

function extractDocxText(filename, dataUrl, inputBuffer = null) {
  const buffer = inputBuffer || dataUrlToBuffer(dataUrl);
  const entries = zipEntriesFromBuffer(buffer);
  const xml = getZipText(buffer, entries, 'word/document.xml');
  const paragraphs = [];
  const pRe = /<w:p\b[\s\S]*?<\/w:p>/g;
  const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let p;
  while ((p = pRe.exec(xml)) && paragraphs.length < 2000) {
    const parts = [];
    let t;
    while ((t = tRe.exec(p[0]))) parts.push(escapeXmlText(t[1] || ''));
    const text = parts.join('').trim();
    if (text) paragraphs.push(text);
  }
  return [`# Word 附件：${filename}`, '解析说明：以下为文档正文提取文本；请基于这些内容回答用户问题。', paragraphs.join('\n')].join('\n\n').slice(0, 120000);
}

async function extractWordText(filename, dataUrl) {
  const buffer = dataUrlToBuffer(dataUrl);
  try { return await extractDocxWithMammoth(filename, buffer); }
  catch {
    try { return withAttachmentHeader('Word', filename, 'officeparser', await parseOfficeWithOfficeParser(buffer, filename)); }
    catch { return extractDocxText(filename, dataUrl, buffer); }
  }
}


module.exports = { extractExcelText, extractPowerPointText, extractWordText };

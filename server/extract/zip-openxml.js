const { escapeXmlText, decodeOpenXmlText } = require('./utils');

function zipEntriesFromBuffer(buffer) {
  const entries = new Map();
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 70000); i--) {
    if (buffer.readUInt32LE(i) === eocdSig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 Office Open XML 文件');
  const total = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  let offset = centralOffset;
  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLen).toString('utf8');
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    entries.set(name, { method, compressedSize, uncompressedSize, dataStart });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function inflateZipEntry(buffer, entry) {
  const zlib = require('zlib');
  const compressed = buffer.slice(entry.dataStart, entry.dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed.toString('utf8');
  if (entry.method === 8) return zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(entry.uncompressedSize * 2, 1024 * 1024) }).toString('utf8');
  throw new Error(`不支持的压缩方式：${entry.method}`);
}

function getZipText(buffer, entries, name) {
  const entry = entries.get(name);
  if (!entry) return '';
  return inflateZipEntry(buffer, entry);
}

module.exports = { zipEntriesFromBuffer, inflateZipEntry, getZipText, escapeXmlText, decodeOpenXmlText };

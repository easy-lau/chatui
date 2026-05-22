function copySuccessState(successIconSvg, previousHtml) {
  return { className: 'copied', html: successIconSvg, restoreHtml: previousHtml, timeoutMs: 900 };
}

function normalizeRenderedCopyText(text = '') {
  const normalized = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  const lines = normalized.split('\n');
  const nonEmpty = lines.filter(line => line.trim()).length;
  const blank = lines.length - nonEmpty;
  const mostlyInterleavedBlanks = nonEmpty >= 2 && blank >= nonEmpty - 1 && lines.every((line, index) => line.trim() || index % 2 === 1);
  return mostlyInterleavedBlanks ? lines.filter(line => line.trim()).join('\n') : normalized.replace(/\n{3,}/g, '\n\n');
}

function messageCopyText(rawText = '', renderedText = '') {
  const rendered = normalizeRenderedCopyText(renderedText);
  return rendered || String(rawText || '').trim();
}

async function copyText(text, clipboard, documentRef) {
  if (clipboard?.writeText) return clipboard.writeText(text);
  const textarea = documentRef.createElement('textarea');
  textarea.value = text;
  documentRef.body.appendChild(textarea);
  textarea.select();
  documentRef.execCommand('copy');
  textarea.remove();
}

module.exports = { copySuccessState, copyText, normalizeRenderedCopyText, messageCopyText };

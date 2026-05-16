function normalizeReasoningText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(item => normalizeReasoningText(item?.text || item?.content || item?.summary || item?.reasoning || item?.thinking || item)).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    return normalizeReasoningText(value.text || value.content || value.summary || value.reasoning || value.thinking || value.reasoning_content || value.thinking_content || value.reasoning_details || value.output_text || '');
  }
  return String(value || '');
}

module.exports = { normalizeReasoningText };

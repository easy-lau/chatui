const {
  makeImageReferenceId,
  parseImageReferenceId,
  makeImageItemId,
  normalizeSelectedImageIds,
  normalizeImageSelection,
} = require('./image-references');

function imageCandidateLabels(text = '') {
  const value = String(text || '').toLowerCase();
  const patterns = [
    ['dog', /狗|犬|dog|puppy/],
    ['cat', /猫|cat|kitten/],
    ['cow', /牛|cow|bull|calf/],
    ['chicken', /鸡|chicken|hen|rooster/],
    ['duck', /鸭|duck|duckling/],
    ['bird', /鸟|bird/],
    ['person', /人|人物|person|human/],
  ];
  const labels = [];
  for (const [label, pattern] of patterns) if (pattern.test(value)) labels.push(label);
  return labels;
}

function splitPromptSubjects(text = '', count = 1) {
  const parts = String(text || '').split(/(?:，|,|、|和|与|及|\band\b|\n|；|;)/i).map(item => item.trim()).filter(Boolean);
  const subjects = [];
  for (const part of parts) {
    const labels = imageCandidateLabels(part);
    if (labels.length) subjects.push(labels);
  }
  if (subjects.length >= count) return subjects.slice(0, count);
  const labels = imageCandidateLabels(text);
  while (subjects.length < count) subjects.push(labels);
  return subjects;
}

function normalizeLastGeneratedImage(value) {
  if (!value) return null;
  const normalizeItem = item => ({
    ...item,
    labels: Array.isArray(item.labels) ? item.labels : imageCandidateLabels(`${item.prompt || ''} ${item.filename || ''} ${item.raw || ''} ${item.label || ''} ${item.subject || ''}`),
  });
  if (!Array.isArray(value.images)) {
    return {
      ...value,
      images: value.src ? [normalizeItem({
        src: value.src,
        filename: value.filename || 'generated-image.png',
        prompt: value.prompt || '',
        updatedAt: value.updatedAt || null,
        width: value.width || 0,
        height: value.height || 0,
      })] : [],
    };
  }
  return { ...value, images: (value.images || []).map(normalizeItem) };
}

function extractPersistedImageRefs(html = '') {
  const refs = [];
  const text = String(html || '');
  const pattern = /data-persisted-src="([^"]+)"[^>]*data-filename="([^"]*)"|data-filename="([^"]*)"[^>]*data-persisted-src="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(text))) {
    const src = match[1] || match[4];
    const filename = match[2] || match[3] || 'generated-image.png';
    if (src) refs.push({ src, filename });
  }
  return refs;
}

function latestImageReferenceMeta({ lastGeneratedImage = null, latestUploadedImage = null } = {}) {
  const generated = normalizeLastGeneratedImage(lastGeneratedImage);
  const generatedCount = Array.isArray(generated && generated.images) ? generated.images.length : generated && generated.src ? 1 : 0;
  const uploadCount = latestUploadedImage && latestUploadedImage.attachments ? latestUploadedImage.attachments.length || 0 : 0;
  if (generatedCount && uploadCount) {
    const generatedUpdatedAt = Number(generated.updatedAt || 0);
    const uploadedUpdatedAt = Number(latestUploadedImage.updatedAt || 0);
    return generatedUpdatedAt >= uploadedUpdatedAt
      ? { target: 'previous', usePreviousImage: true, count: generatedCount, selection: 'all', reason: 'latest-generated-image', reference_id: makeImageReferenceId('latest') }
      : { target: 'uploaded', usePreviousImage: false, count: uploadCount, selection: 'all', reason: 'latest-uploaded-image' };
  }
  if (generatedCount) return { target: 'previous', usePreviousImage: true, count: generatedCount, selection: 'all', reason: 'last-generated-image', reference_id: makeImageReferenceId('latest') };
  if (uploadCount) return { target: 'uploaded', usePreviousImage: false, count: uploadCount, selection: 'all', reason: 'latest-uploaded-image' };
  return { target: 'none', usePreviousImage: false, count: 0, selection: 'none', reason: 'no-image-reference' };
}

function collectRecentImageReferences({ display = [], lastGeneratedImage = null, limit = 6 } = {}) {
  const references = [];
  const generated = normalizeLastGeneratedImage(lastGeneratedImage);
  if (generated && generated.images && generated.images.length) {
    const referenceId = makeImageReferenceId('latest');
    references.push({
      reference_id: referenceId,
      target: 'previous',
      prompt: String(generated.prompt || '').slice(0, 300),
      updated_at: generated.updatedAt || null,
      count: generated.images.length,
      candidates: generated.images.map((item, index) => ({
        index: index + 1,
        image_id: makeImageItemId(referenceId, index + 1),
        filename: item.filename || '',
        prompt: String(item.prompt || generated.prompt || '').slice(0, 160),
        labels: item.labels || [],
      })),
    });
  }
  for (const item of [...display].reverse()) {
    if (references.length >= limit) break;
    if (item && item.role !== 'assistant') continue;
    const refs = extractPersistedImageRefs(item && item.html || '');
    if (!refs.length) continue;
    const rawId = item.id || `display-${references.length + 1}`;
    const referenceId = makeImageReferenceId(rawId);
    const prompt = String(item.rawText || '').replace(/^\[图片(生成|编辑|修改)完成\]\s*/, '').slice(0, 300);
    const subjects = splitPromptSubjects(prompt, refs.length);
    if (references.some(ref => ref.reference_id === referenceId)) continue;
    references.push({
      reference_id: referenceId,
      target: 'previous',
      prompt,
      updated_at: item.updatedAt || null,
      count: refs.length,
      candidates: refs.map((ref, index) => ({
        index: index + 1,
        image_id: makeImageItemId(referenceId, index + 1),
        filename: ref.filename || '',
        prompt,
        labels: subjects[index] || imageCandidateLabels(`${prompt} ${ref.filename || ''}`),
      })),
    });
  }
  return references;
}

function findImageReferenceById({ display = [], referenceId = '' } = {}) {
  const rawId = parseImageReferenceId(referenceId);
  if (!rawId || rawId === 'latest') return null;
  const item = (display || []).find(entry => entry && entry.id === rawId);
  if (!item) return null;
  const refs = extractPersistedImageRefs(item.html || '');
  if (!refs.length) return null;
  const resolvedReferenceId = makeImageReferenceId(rawId);
  return {
    images: refs.map((ref, index) => ({
      ...ref,
      prompt: item.rawText || '',
      imageId: makeImageItemId(resolvedReferenceId, index + 1),
      labels: splitPromptSubjects(item.rawText || '', refs.length)[index] || [],
    })),
    prompt: item.rawText || '',
    updatedAt: item.updatedAt || null,
  };
}

function normalizeRoute(route, fallbackMode = 'chat') {
  const mode = ['chat', 'image', 'edit_image'].includes(route && route.mode) ? route.mode : fallbackMode;
  const target = ['none', 'new', 'uploaded', 'previous'].includes(route && route.target) ? route.target : mode === 'image' ? 'new' : 'none';
  const confidence = Number.isFinite(Number(route && route.confidence)) ? Math.max(0, Math.min(1, Number(route.confidence))) : 0;
  const evidence = String(route && route.evidence || '').trim();
  return {
    mode,
    target,
    evidence,
    usePreviousImage: mode === 'edit_image' && target === 'previous' && !!(route && (route.use_previous_image || route.usePreviousImage)) && confidence >= 0.75 && evidence.length > 0,
    selectedIndexes: normalizeImageSelection(route && (route.selected_indexes || route.selectedIndexes || route.image_indexes || route.imageIndexes)) || [],
    selectedReferenceId: makeImageReferenceId(route && (route.selected_reference_id || route.selectedReferenceId) || ''),
    selectedImageIds: normalizeSelectedImageIds(route && (route.selected_image_ids || route.selectedImageIds) || route),
    confidence,
  };
}

module.exports = {
  imageCandidateLabels,
  splitPromptSubjects,
  normalizeLastGeneratedImage,
  extractPersistedImageRefs,
  latestImageReferenceMeta,
  collectRecentImageReferences,
  findImageReferenceById,
  normalizeRoute,
};

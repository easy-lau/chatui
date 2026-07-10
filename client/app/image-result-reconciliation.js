(function initChatUIImageResultReconciliation(root) {
  'use strict';

  function hasValue(value) {
    return value !== undefined && value !== null && String(value) !== '';
  }

  function sameValue(left, right) {
    return hasValue(left) && hasValue(right) && String(left) === String(right);
  }

  function normalizedIndex(value) {
    if (!hasValue(value)) return -1;
    const index = Number(value);
    return Number.isFinite(index) && index >= 0 ? index : -1;
  }

  function isPending(item) {
    return item?.pending === true || item?.pending === 1 || item?.pending === '1';
  }

  function isImageCompletionMessage(message) {
    return message?.role === 'assistant' && /^\[图片(生成|编辑|修改)完成\]/.test(String(message.content || ''));
  }

  function isImageCompletionDisplayItem(item) {
    const html = String(item?.html || '');
    return item?.role === 'assistant' && !isPending(item) && (
      /class=["'][^"']*generated-thumb/.test(html)
      || /data-persisted-src=/.test(html)
      || /image-download-row/.test(html)
    );
  }

  function createAnchor({ item = null, currentItem = null, job = null, responseIndex = -1 } = {}) {
    const anchorItem = currentItem || item;
    const displayIds = new Set([
      anchorItem?.id,
      anchorItem?.displayItemId,
      job?.displayItemId,
    ].filter(hasValue).map(String));
    const jobIds = new Set([
      anchorItem?.jobId,
      anchorItem?.imageJobId,
      job?.id,
      job?.jobId,
      job?.imageJobId,
    ].filter(hasValue).map(String));
    const responseIndexes = new Set([
      responseIndex,
      anchorItem?.responseIndex,
      job?.responseIndex,
    ].map(normalizedIndex).filter(index => index >= 0).map(String));

    return {
      displayIds,
      jobIds,
      responseIndexes,
      matches(candidate, candidateIndex = -1) {
        if (!candidate) return false;
        return (candidate.id && displayIds.has(String(candidate.id)))
          || (candidate.displayItemId && displayIds.has(String(candidate.displayItemId)))
          || (candidate.jobId && jobIds.has(String(candidate.jobId)))
          || (candidate.imageJobId && jobIds.has(String(candidate.imageJobId)))
          || (hasValue(candidate.responseIndex) && responseIndexes.has(String(candidate.responseIndex)))
          || (!hasValue(candidate.responseIndex) && candidateIndex >= 0 && responseIndexes.has(String(candidateIndex)));
      },
    };
  }

  function hasSuccessfulImageResult({ session, item = null, job = null, responseIndex = -1 } = {}) {
    if (!session) return false;
    const anchor = createAnchor({ item, job, responseIndex });
    return (session.messages || []).some((message, index) => isImageCompletionMessage(message) && anchor.matches(message, index))
      || (session.display || []).some(candidate => isImageCompletionDisplayItem(candidate) && anchor.matches(candidate));
  }

  function reconcileSuccessfulImageResult({ session, currentItem = null, job = null, responseIndex = -1 } = {}) {
    if (!session) return { changed: false, removedDisplayItems: [], removedMessages: [] };

    const anchor = createAnchor({ currentItem, job, responseIndex });
    const currentId = currentItem?.id || '';
    const resolvedIndex = normalizedIndex(responseIndex) >= 0
      ? normalizedIndex(responseIndex)
      : normalizedIndex(currentItem?.responseIndex);
    const originalDisplay = Array.isArray(session.display) ? session.display : [];
    const successfulDisplayItem = (
      currentItem && isImageCompletionDisplayItem(currentItem) ? currentItem : null
    ) || originalDisplay.find(item => isImageCompletionDisplayItem(item) && anchor.matches(item)) || null;

    const removedDisplayItems = [];
    session.display = originalDisplay.filter(item => {
      if (!item || !['assistant', 'error'].includes(item.role) || !anchor.matches(item)) return true;
      const isCurrent = item === currentItem || (currentId && sameValue(item.id, currentId));
      if (isCurrent || item === successfulDisplayItem) return true;
      removedDisplayItems.push(item);
      return false;
    });

    const originalMessages = Array.isArray(session.messages) ? session.messages : [];
    const successfulMessage = originalMessages.find((message, index) => (
      isImageCompletionMessage(message)
      && anchor.matches(message, index)
      && (
        (currentId && sameValue(message.displayItemId, currentId))
        || (job?.id && sameValue(message.imageJobId, job.id))
      )
    )) || originalMessages.find((message, index) => isImageCompletionMessage(message) && anchor.matches(message, index)) || null;

    const removedMessages = [];
    session.messages = originalMessages.filter((message, index) => {
      if (!message || message === successfulMessage) return true;
      if (!['assistant', 'error'].includes(message.role) || !anchor.matches(message, index)) return true;
      removedMessages.push(message);
      return false;
    });

    return {
      changed: removedDisplayItems.length > 0 || removedMessages.length > 0,
      removedDisplayItems,
      removedMessages,
      responseIndex: resolvedIndex,
      currentDisplayItemId: currentId,
      jobId: job?.id || '',
    };
  }

  const api = Object.freeze({
    reconcileSuccessfulImageResult,
    hasSuccessfulImageResult,
    isImageCompletionMessage,
    isImageCompletionDisplayItem,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatUIImageResultReconciliation = api;
  if (root?.window) root.window.ChatUIImageResultReconciliation = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

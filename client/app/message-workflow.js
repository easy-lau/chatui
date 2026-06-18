(function initChatUIAppMessageWorkflow(root) {
  // Intentionally not strict: message rendering bodies are migrated from app.js and resolved through a deps scope.

  function createMessageWorkflow(deps = {}) {
    if (!deps.state) throw new Error('state is required');

    function cleanupGeneratedImageNumberArtifacts(root) {
      const scopeRoot = root?.querySelectorAll ? root : null;
      if (!scopeRoot) return;
      scopeRoot.querySelectorAll('.generated-image-item').forEach(item => {
        item.querySelectorAll(':scope > .generated-image-index').forEach(badge => badge.remove());
      });
      scopeRoot.querySelectorAll('.generated-image-index').forEach(badge => {
        badge.remove();
      });
    }

    function shouldProgressiveRenderMarkdown(text = '') {
      const raw = String(text || '');
      return raw.length > 8000 || raw.split('\n').length > 180;
    }

    const messageDomain = root.ChatUIFeaturesMessagesDomain || {};
    const messageRoleLabel = messageDomain.messageRoleLabel || (role => role === 'user' ? '我' : role === 'assistant' ? 'AI' : '消息');
    const messageRoleFromNode = messageDomain.messageRoleFromNode || (node => node?.classList?.contains('assistant') ? 'assistant' : node?.classList?.contains('user') ? 'user' : 'error');
    const normalizeQuoteText = messageDomain.normalizeQuoteText || ((text = '', limit = 1200) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit));
    const escapeHtmlLocal = messageDomain.escapeHtmlLocal || (value => String(value ?? '').replace(/[&<>\"'`]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;', '`': '&#96;' }[ch])));
    const readQuoteContext = messageDomain.readQuoteContext || (() => null);
    const quoteContextJson = messageDomain.quoteContextJson || (value => {
      const quote = readQuoteContext(value);
      return quote ? JSON.stringify(quote) : '';
    });

    const quotePreview = (root.ChatUIFeaturesMessagesQuotePreview?.createQuotePreview || (() => ({ renderSentQuotePreview: () => '', withSentQuotePreview: html => String(html || '') })))({
      readQuoteContext,
      normalizeQuoteText,
      escapeHtml: escapeHtmlLocal,
    });
    const renderSentQuotePreview = quotePreview.renderSentQuotePreview;
    const withSentQuotePreview = quotePreview.withSentQuotePreview;

    function findQuotedMessageNode(quote) {
      const ctx = readQuoteContext(quote);
      if (!ctx) return null;
      if (ctx.sessionId && deps.state?.activeSessionId && ctx.sessionId !== deps.state.activeSessionId) return null;
      const root = deps.$?.('messages') || deps.document;
      if (!root?.querySelectorAll) return null;
      const nodes = [...root.querySelectorAll('.message')];
      if (ctx.displayItemId) {
        const byDisplay = nodes.find(node => node.dataset.displayItemId === ctx.displayItemId);
        if (byDisplay) return byDisplay;
      }
      if (ctx.role === 'assistant' && ctx.responseIndex !== undefined) {
        const byResponse = nodes.find(node => node.classList.contains('assistant') && String(node.dataset.responseIndex || '') === String(ctx.responseIndex));
        if (byResponse) return byResponse;
      }
      if (ctx.role === 'user' && ctx.messageIndex !== undefined) {
        const byMessage = nodes.find(node => node.classList.contains('user') && String(node.dataset.messageIndex || '') === String(ctx.messageIndex));
        if (byMessage) return byMessage;
      }
      return nodes.find(node => messageRoleFromNode(node) === ctx.role && normalizeQuoteText(node.dataset.rawText || node.textContent || '', 1200) === ctx.content) || null;
    }

    function scrollQuotedMessageToStart(target, margin = 18) {
      if (!target?.isConnected) return false;
      try { root.ChatUIScrollDebug?.releaseBottomScrollLock?.({ bumpVersion: true, suppressMs: 1800 }); } catch {}
      try { root.ChatUIScrollDebug?.cleanupBottomScrollLock?.(); } catch {}
      const messages = deps.$?.('messages') || target.closest?.('#messages,.messages');
      if (!messages?.getBoundingClientRect) {
        target.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return true;
      }
      const applyScroll = () => {
        if (!target.isConnected) return;
        const messagesRect = messages.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const top = Math.max(0, messages.scrollTop + targetRect.top - messagesRect.top - margin);
        if (typeof messages.scrollTo === 'function') messages.scrollTo({ top, behavior: 'auto' });
        else messages.scrollTop = top;
      };
      applyScroll();
      root.requestAnimationFrame?.(() => { applyScroll(); root.requestAnimationFrame?.(applyScroll); });
      [80, 180, 360].forEach(ms => root.setTimeout?.(applyScroll, ms));
      return true;
    }

    function jumpToQuotedMessage(quote) {
      const target = findQuotedMessageNode(quote);
      if (!target) return false;
      scrollQuotedMessageToStart(target, 18);
      target.classList.remove('quote-target-flash');
      void target.offsetWidth;
      target.classList.add('quote-target-flash');
      const clearFlash = () => target.classList.remove('quote-target-flash');
      target.addEventListener?.('animationend', clearFlash, { once: true });
      setTimeout(clearFlash, 2800);
      return true;
    }

    function bindSentQuotePreviews(root) {
      root?.querySelectorAll?.('.sent-quote-preview').forEach(button => {
        if (button.dataset.quoteJumpBound === '1') return;
        button.dataset.quoteJumpBound = '1';
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          jumpToQuotedMessage(button.dataset.quoteContext || '');
        });
      });
    }

    function getQuotedMessage() {
      const quote = deps.state?.quotedMessage || null;
      return quote?.content ? quote : null;
    }

    function renderComposerQuote() {
      const bar = deps.$?.('quoteBar');
      if (!bar) return;
      const quote = getQuotedMessage();
      if (!quote) {
        bar.hidden = true;
        bar.replaceChildren?.();
        if (!bar.replaceChildren) bar.innerHTML = '';
        return;
      }
      const label = deps.document?.createElement ? deps.document.createElement('span') : document.createElement('span');
      const text = deps.document?.createElement ? deps.document.createElement('span') : document.createElement('span');
      const close = deps.document?.createElement ? deps.document.createElement('button') : document.createElement('button');
      label.className = 'quote-preview-label';
      label.textContent = `引用 ${messageRoleLabel(quote.role)}`;
      text.className = 'quote-preview-text';
      text.textContent = normalizeQuoteText(quote.content, 180);
      close.className = 'quote-preview-close';
      close.type = 'button';
      close.title = '取消引用';
      close.setAttribute('aria-label', '取消引用');
      close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      close.addEventListener('click', clearQuotedMessage);
      bar.replaceChildren?.(label, text, close);
      if (!bar.replaceChildren) {
        bar.innerHTML = '';
        bar.append(label, text, close);
      }
      bar.hidden = false;
    }

    function clearQuotedMessage() {
      deps.state.quotedMessage = null;
      renderComposerQuote();
    }

    function activeSession() {
      const id = deps.state?.activeSessionId || '';
      return (deps.state?.sessions || []).find(session => session?.id === id) || null;
    }

    function displayItemForNode(node) {
      const session = activeSession();
      const display = Array.isArray(session?.display) ? session.display : [];
      const displayItemId = node?.dataset?.displayItemId || node?.__displayItem?.id || '';
      const responseIndex = node?.dataset?.responseIndex || node?.__displayItem?.responseIndex || '';
      const messageIndex = node?.dataset?.messageIndex || node?.__displayItem?.messageIndex || '';
      return node?.__displayItem
        || (displayItemId ? display.find(item => item?.id === displayItemId) : null)
        || (responseIndex !== '' ? display.find(item => item?.role === 'assistant' && String(item.responseIndex || '') === String(responseIndex)) : null)
        || (messageIndex !== '' ? display.find(item => item?.role === 'user' && String(item.messageIndex || '') === String(messageIndex)) : null)
        || null;
    }

    function canonicalMessageForNode(node, role = '') {
      const session = activeSession();
      const messages = Array.isArray(session?.messages) ? session.messages : Array.isArray(deps.state?.messages) ? deps.state.messages : [];
      const responseIndex = node?.dataset?.responseIndex || node?.__displayItem?.responseIndex || '';
      const messageIndex = node?.dataset?.messageIndex || node?.__displayItem?.messageIndex || '';
      if (role === 'assistant' && responseIndex !== '') {
        const message = messages[Number(responseIndex)];
        if (message?.role === 'assistant') return message;
      }
      if (role === 'user' && messageIndex !== '') {
        const message = messages[Number(messageIndex)];
        if (message?.role === 'user') return message;
      }
      return null;
    }

    function hasUsableImageContext(value) {
      if (!value) return false;
      try {
        const context = typeof value === 'string' ? JSON.parse(value) : value;
        return !!(context && typeof context === 'object' && Array.isArray(context.attachments) && context.attachments.length);
      } catch { return false; }
    }

    function resolveQuoteContextForNode(node) {
      if (!node) return null;
      const role = messageRoleFromNode(node);
      const displayItem = displayItemForNode(node);
      const canonical = canonicalMessageForNode(node, role);
      const content = normalizeQuoteText(
        node.dataset.rawText
        || displayItem?.rawText
        || canonical?.rawText
        || canonical?.content
        || node.querySelector?.('.content')?.innerText
        || node.textContent
        || ''
      );
      let imageContext = node.dataset.imageContext || displayItem?.imageContext || canonical?.imageContext || '';
      if (imageContext && !hasUsableImageContext(imageContext)) imageContext = '';
      if (!imageContext && typeof deps.getAssistantImageContext === 'function') {
        try {
          const assistantImageContext = deps.getAssistantImageContext(node);
          if (assistantImageContext) imageContext = typeof assistantImageContext === 'string' ? assistantImageContext : JSON.stringify(assistantImageContext);
        } catch {}
      }
      let attachmentContext = node.dataset.attachmentContext || displayItem?.attachmentContext || canonical?.attachmentContext || '';
      const quoteContent = content || (imageContext ? '[图片消息]' : attachmentContext ? '[附件消息]' : '');
      if (!quoteContent && !imageContext && !attachmentContext) return null;
      if (imageContext && !node.dataset.imageContext) node.dataset.imageContext = imageContext;
      if (attachmentContext && !node.dataset.attachmentContext) node.dataset.attachmentContext = attachmentContext;
      const quote = { role: role === 'assistant' ? 'assistant' : 'user', content: quoteContent, sessionId: deps.state.activeSessionId || '' };
      const displayItemId = node.dataset.displayItemId || displayItem?.id || canonical?.displayItemId || '';
      const messageIndex = node.dataset.messageIndex || displayItem?.messageIndex || canonical?.messageIndex || '';
      const responseIndex = node.dataset.responseIndex || displayItem?.responseIndex || canonical?.responseIndex || '';
      if (displayItemId) quote.displayItemId = String(displayItemId);
      if (messageIndex !== '') quote.messageIndex = String(messageIndex);
      if (responseIndex !== '') quote.responseIndex = String(responseIndex);
      if (imageContext) quote.imageContext = imageContext;
      if (attachmentContext) quote.attachmentContext = attachmentContext;
      return quote;
    }

    function selectQuotedMessage(node) {
      const quote = resolveQuoteContextForNode(node);
      if (!quote) return;
      deps.state.quotedMessage = quote;
      renderComposerQuote();
      deps.$?.('prompt')?.focus?.();
    }

    let markdownFinalRenderer = null;

    function getMarkdownFinalRenderer() {
      if (markdownFinalRenderer) return markdownFinalRenderer;
      const factory = root.ChatUIFeaturesMessagesMarkdownFinalRenderer?.createMarkdownFinalRenderer;
      if (!factory) throw new Error('ChatUIFeaturesMessagesMarkdownFinalRenderer 未加载');
      markdownFinalRenderer = factory({
        state: deps.state,
        document: deps.document || root.document,
        performance: root.performance,
        requestIdleCallback: root.requestIdleCallback?.bind?.(root),
        requestAnimationFrame: root.requestAnimationFrame?.bind?.(root),
        setTimeout: root.setTimeout?.bind?.(root),
        $: deps.$,
        getMessagesRoot: () => deps.$?.('messages'),
        renderMarkdown: deps.renderMarkdown,
        resetMessageActionStates: deps.resetMessageActionStates,
        bindInlineCopyButtons: deps.bindInlineCopyButtons,
        enhanceRenderedMarkdown: deps.enhanceRenderedMarkdown,
        hydrateMessageMedia: deps.hydrateMessageMedia,
        cleanupGeneratedImageNumberArtifacts,
        shouldFollowScroll: deps.shouldFollowScroll,
        focusSessionTail: deps.focusSessionTail,
        preserveMessageBottomAnchor: deps.preserveMessageBottomAnchor,
      });
      return markdownFinalRenderer;
    }

    function renderMarkdownProgressively(messageNode, text = '', hash = chatuiContentHash(text)) {
      return getMarkdownFinalRenderer().renderProgressively(messageNode, text, hash);
    }

    function createLiveMarkdownStream() {
      const factory = root.ChatUIFeaturesMessagesMarkdownLiveStream?.createMarkdownLiveStream;
      if (factory) return factory({
        renderMarkdown: deps.renderMarkdown,
        createStreamingRenderer: root.ChatUIApp?.markdown?.createStreamingRenderer,
        bindInlineCopyButtons: deps.bindInlineCopyButtons,
        enhanceRenderedMarkdown: deps.enhanceRenderedMarkdown,
        now: () => chatuiPerfNow(),
      });
      return null;
    }

    function renderMarkdownPreviewSnapshot(contentNode, rawValue = '') {
      if (!contentNode) return false;
      const preview = root.ChatUIFeaturesMessagesMarkdownPreview?.renderMarkdownPreview;
      if (!preview) return renderPlainMarkdownSnapshot(contentNode, rawValue);
      contentNode.innerHTML = preview(String(rawValue || ''));
      contentNode.classList?.remove('markdown-stream-fallback-text');
      return true;
    }

    function renderPlainMarkdownSnapshot(contentNode, rawValue = '') {
      if (!contentNode) return false;
      const doc = deps.document || root.document;
      contentNode.textContent = String(rawValue || '');
      contentNode.classList?.add('markdown-stream-fallback-text');
      return !!doc;
    }

    function updateLiveMarkdownStream(messageNode, contentNode, rawValue = '', incoming = '') {
      if (!messageNode || !contentNode) return false;
      let liveStream = messageNode.__markdownLiveStream;
      if (!liveStream) {
        liveStream = createLiveMarkdownStream();
        messageNode.__markdownLiveStream = liveStream;
      }
      const next = String(rawValue || '');
      if (!liveStream) {
        contentNode.textContent = next || String(incoming || '');
        messageNode.dataset.streamingMarkdownMode = 'text-fallback';
        return false;
      }
      const result = liveStream.append(contentNode, next, { force: !messageNode.dataset.streamingMarkdownMode });
      messageNode.dataset.streamingMarkdownMode = 'incremental';
      messageNode.dataset.streamingMarkdownConsumed = String(result?.consumed ?? '');
      messageNode.dataset.streamingMarkdownTail = String(result?.tail?.length ?? 0);
      return true;
    }

    function updateMessage(e, t, s = {}) {
      with (deps) {
        const contentNode = e.querySelector(".content");
        const restore = s.noScroll ? (state.userScrollLocked ? preserveMessageViewport(e) : preserveMessageBottomAnchor(e, 72)) : null;
        const rawValue = String(s.rawText ?? t ?? "");
        const rawHash = chatuiContentHash(rawValue);
        const streamingFinalShouldPin = e === state.activeOutputNode && !state.userScrollLocked;
        const canAutoFollowNow = () => !state.userScrollLocked && shouldFollowScroll();
        if (e.dataset.rawHash === rawHash && e.dataset.renderedHash === rawHash && e.dataset.enhancedHash === rawHash && !s.html && !s.metaText) {
          cleanupGeneratedImageNumberArtifacts(e);
          delete e.dataset.streaming;
          delete e.dataset.streamKind;
          delete e.dataset.streamRunToken;
          return;
        }

        let rendered = false;
        const largeAssistantMarkdown = !s.html && !e.classList?.contains("user") && shouldProgressiveRenderMarkdown(rawValue);
        if ((e.__markdownLiveStream?.final || e.__markdownStreamingRenderer?.final) && !s.html && !e.classList?.contains("user")) {
          try {
            if (e.__markdownLiveStream?.final) {
              const result = e.__markdownLiveStream.final(contentNode, rawValue);
              rendered = !!result;
              e.dataset.renderedHash = rawHash;
              if (result?.enhanced) e.dataset.enhancedHash = rawHash;
              e.dataset.markdownFinalEnhanced = result?.enhanced ? "1" : "";
              e.dataset.markdownFinalMode = result?.mode || "incremental-final";
              if (result?.reason) e.dataset.markdownFinalReason = result.reason;
              if (streamingFinalShouldPin && canAutoFollowNow()) pinNodeBottomToTarget(e, { margin: 72 });
            } else if (largeAssistantMarkdown) {
              renderMarkdownProgressively(e, rawValue, rawHash);
              rendered = true;
              e.dataset.markdownFinalMode = "progressive-final";
              delete e.dataset.markdownFinalEnhanced;
            } else {
              const result = e.__markdownStreamingRenderer.final(contentNode, rawValue);
              rendered = !!result;
              e.dataset.renderedHash = rawHash;
              if (result?.enhanced) e.dataset.enhancedHash = rawHash;
              e.dataset.markdownFinalEnhanced = result?.enhanced ? "1" : "";
              e.dataset.markdownFinalMode = result?.mode || "final";
              if (result?.reason) e.dataset.markdownFinalReason = result.reason;
              if (streamingFinalShouldPin && canAutoFollowNow()) pinNodeBottomToTarget(e, { margin: 72 });
            }
          } catch {}
          delete e.__markdownLiveStream;
          delete e.__markdownStreamingRenderer;
        }
        if (!rendered && e.dataset.streamingMarkdownMode === "text-fallback" && largeAssistantMarkdown) {
          renderMarkdownProgressively(e, rawValue, rawHash);
          rendered = true;
          e.dataset.markdownFinalMode = "progressive-final";
        }
        delete e.dataset.streamingMarkdownMode;
        delete e.dataset.streamingMarkdownConsumed;
        delete e.dataset.streamingMarkdownTail;
        delete e.dataset.lastStreamingRaw;

        delete e.dataset.streaming;
        delete e.dataset.streamKind;
        delete e.dataset.streamRunToken;
        if (e === state.activeOutputNode && !s.skipSave) {
          state.streamFocusLocked = false;
          if (canAutoFollowNow()) pinNodeBottomToTarget(e, { margin: 72 });
        }
        e.dataset.rawText = rawValue;
        e.dataset.rawHash = rawHash;
        if (s.skipSave) e.dataset.persist = "0";
        else delete e.dataset.persist;
        if (void 0 !== s.messageIndex && null !== s.messageIndex) e.dataset.messageIndex = String(s.messageIndex);
        if (void 0 !== s.responseIndex && null !== s.responseIndex) e.dataset.responseIndex = String(s.responseIndex);

        if (!rendered) {
          if (s.html) {
            contentNode.innerHTML = stripTransientBlobUrlsFromHtml(t);
            e.dataset.renderedHash = rawHash;
            delete e.dataset.enhancedHash;
          } else if (chatuiShouldLazyRender(e.classList?.contains("user") ? "user" : "assistant", rawValue, { ...s, final: true }) && !chatuiIsNearViewport(e)) {
            chatuiQueueLazyMessage(e, rawValue);
          } else {
            const started = chatuiPerfNow();
            if (largeAssistantMarkdown) {
              renderMarkdownProgressively(e, rawValue, rawHash);
              rendered = true;
            } else {
              contentNode.innerHTML = e.classList?.contains("user") ? renderUserMessageContent(String(t || "")) : renderMarkdown(String(t || ""));
              e.dataset.renderedHash = rawHash;
            }
            delete e.dataset.enhancedHash;
            e.dataset.lazyMarkdown = "0";
            chatuiLogLongTask("message.update.renderMarkdown", chatuiPerfNow() - started, { chars: rawValue.length });
          }
        }

        cleanupGeneratedImageNumberArtifacts(e);
        resetMessageActionStates(e);
        if (void 0 !== s.metaText) setMessageMetaText(e, s.metaText);
        if ("1" !== e.dataset.markdownFinalEnhanced && e.dataset.lazyMarkdown !== "1" && e.dataset.enhancedHash !== rawHash && e.dataset.progressiveRendering !== "1") {
          bindInlineCopyButtons(e);
          enhanceRenderedMarkdown(e, { deferMermaid: true, allowResourceLoad: true, autoRenderMermaid: true, forceMermaid: true });
          cleanupGeneratedImageNumberArtifacts(e);
          hydrateMessageMedia(e, { save: true !== s.skipSave });
          e.dataset.enhancedHash = rawHash;
        }
        if (streamingFinalShouldPin && canAutoFollowNow()) {
          const pinFinal = () => { if (canAutoFollowNow()) pinNodeBottomToTarget(e, { margin: 72 }); };
          requestAnimationFrame?.(pinFinal);
        }
        delete e.dataset.markdownFinalEnhanced;
        if (s.noScroll) {
          state.scrollVersion += 1;
          cancelScrollTimer();
          if (restore) { restore(); requestAnimationFrame(restore); setTimeout(restore, 80); }
          setTimeout(updateResumeStreamButton, 0);
        } else if (true === s.followActive || state.activeOutputNode === e) {
          if ((s.forceScroll ?? true === s.followActive) && canAutoFollowNow()) {
            if (false === s.settleScroll) {
              cancelScrollTimer();
              scrollToActiveOutput(e, { force: true, active: true, settle: false });
              cancelScrollTimer();
            } else scrollToActiveOutput(e, { force: true, active: true, settle: true });
          } else {
            state.activeOutputNode = e;
            state.scrollVersion += 1;
            cancelScrollTimer();
          }
        } else scrollToBottom(s.forceScroll ?? false);
      }
    }

    function updateMessageContentLight(e, t, s = {}) {
      with (deps) {
        if (shouldSuppressRunUi(s.sessionId || state.activeSessionId, s.runToken)) return;
        const contentNode = e?.querySelector('.content');
        if (!contentNode) return;
        const rawValue = String(s.rawText ?? t ?? '');
        const chatStream = s.streamKind === 'chat' && !s.html && !e.classList?.contains('user');
        const rawHash = chatStream ? '' : chatuiContentHash(rawValue);
        if (!s.html && !chatStream && !e.classList?.contains('user') && e.dataset.rawHash === rawHash && e.dataset.renderedHash === rawHash && e.dataset.enhancedHash === rawHash && !s.forceRender) {
          cleanupGeneratedImageNumberArtifacts(e);
          return;
        }

        const restoreViewport = s.noScroll ? (state.userScrollLocked ? preserveMessageViewport(e) : preserveMessageBottomAnchor(e, 72)) : null;
        e.dataset.rawText = rawValue;
        if (chatStream) {
          e.dataset.streamingRawLength = String(rawValue.length);
          if (!e.dataset.rawHash) e.dataset.rawHash = 'streaming';
          if (e.dataset.lastStreamingRaw === rawValue) {
            updateResumeStreamButton();
            return;
          }
          e.dataset.lastStreamingRaw = rawValue;
        } else {
          e.dataset.rawHash = rawHash;
          delete e.dataset.streamingRawLength;
          delete e.dataset.lastStreamingRaw;
        }
        e.dataset.streaming = '1';
        if (void 0 !== s.streamKind) e.dataset.streamKind = s.streamKind || '';
        if (void 0 !== s.runToken) e.dataset.streamRunToken = s.runToken || '';
        if (s.skipSave) e.dataset.persist = '0';

        if (chatStream && shouldProgressiveRenderMarkdown(rawValue)) {
          delete e.__markdownStreamingRenderer;
          delete e.dataset.enhancedHash;
          updateLiveMarkdownStream(e, contentNode, rawValue, t);
        } else if (chatStream) {
          delete e.dataset.enhancedHash;
          let streamRenderer = e.__markdownStreamingRenderer;
          if (!streamRenderer || s.resetStream) {
            streamRenderer = window.ChatUIApp?.markdown?.createStreamingRenderer?.({
              renderMarkdown,
              enhance: (scopeRoot, phase = {}) => {
                bindInlineCopyButtons(scopeRoot);
                enhanceRenderedMarkdown(scopeRoot, { streaming: !!phase.streaming, deferMermaid: true, allowResourceLoad: !!phase.final, autoRenderMermaid: !!phase.final, forceMermaid: !!phase.final });
              },
            });
            e.__markdownStreamingRenderer = streamRenderer;
            contentNode.innerHTML = '';
          }
          if (streamRenderer && s.chunk !== false) {
            const incoming = String(t ?? '');
            const previousRaw = streamRenderer.getRaw?.() || '';
            const deltaText = s.delta ? incoming : incoming.startsWith(previousRaw) ? incoming.slice(previousRaw.length) : rawValue.startsWith(previousRaw) ? rawValue.slice(previousRaw.length) : incoming;
            streamRenderer.append(deltaText, contentNode);
          } else if (contentNode.textContent !== rawValue) contentNode.textContent = rawValue;
        } else {
          const html = s.html ? String(t || '') : e.classList?.contains('user') ? renderUserMessageContent(rawValue) : renderMarkdown(rawValue);
          if (contentNode.innerHTML !== html) {
            contentNode.innerHTML = html;
            e.dataset.renderedHash = rawHash;
            delete e.dataset.enhancedHash;
            resetMessageActionStates(e);
            cleanupGeneratedImageNumberArtifacts(e);
            if (s.streamKind !== 'chat') {
              bindInlineCopyButtons(e);
              enhanceRenderedMarkdown(e, { allowResourceLoad: false });
              cleanupGeneratedImageNumberArtifacts(e);
              hydrateMessageMedia(e, { save: false });
              e.dataset.enhancedHash = rawHash;
            }
          }
          cleanupGeneratedImageNumberArtifacts(e);
        }

        if (s.noScroll) restoreViewport && restoreViewport();
        else if (!s.noScroll && (s.forceScroll || shouldFollowScroll())) scrollToActiveOutput(e, { force: true, active: true, settle: false, margin: 72 });
        updateResumeStreamButton();
      }
    }

    function addMessage(e, t, s = {}) {
      with (deps) {
        clearEmpty();const n=$("messageTemplate").content.firstElementChild.cloneNode(!0);n.classList.add(e),n.querySelector(".avatar").textContent="user"===e?"我":"error"===e?"!":"AI";const a=n.querySelector(".content"),i=s.rawText??t,q=quoteContextJson(s.quoteContext);n.dataset.rawText=i,n.dataset.rawHash=chatuiContentHash(i),q&&(n.dataset.quoteContext=q,n.classList.add("has-quote")),s.skipSave&&(n.dataset.persist="0"),void 0!==s.messageIndex&&null!==s.messageIndex&&(n.dataset.messageIndex=String(s.messageIndex)),void 0!==s.responseIndex&&null!==s.responseIndex&&(n.dataset.responseIndex=String(s.responseIndex)),s.attachmentContext&&(n.dataset.attachmentContext=s.attachmentContext),s.imageContext&&(n.dataset.imageContext=s.imageContext);const o=chatuiShouldLazyRender(e,i,s);s.deferEnhance&&"assistant"===e&&!s.html?a.innerHTML="":s.html?a.innerHTML=("user"===e?withSentQuotePreview(stripTransientBlobUrlsFromHtml(t),q):stripTransientBlobUrlsFromHtml(t)):o?a.innerHTML=chatuiPlainPreview(i):a.innerHTML="user"===e?withSentQuotePreview(renderUserMessageContent(String(t||"")),q):renderMarkdown(String(t||""));cleanupGeneratedImageNumberArtifacts(n);bindSentQuotePreviews(n);n.querySelector(".quote-btn")?.addEventListener("click",()=>selectQuotedMessage(n));const r=n.querySelector(".edit-btn");"user"===e?r.addEventListener("click",()=>editUserMessage(n)):r.remove();const l=n.querySelector(".refresh-btn");"assistant"===e||"error"===e?l.addEventListener("click",()=>regenerateAssistantMessage(n)):l.remove(),n.querySelector(".copy-btn")?.addEventListener("click",async()=>{await copyText(messageCopyText(n.dataset.rawText,a.innerText||a.textContent||"",a)),showCopySuccess(n.querySelector(".copy-btn"))});const d=n.querySelector(".download-answer-btn");return"assistant"===e?d?.addEventListener("click",()=>downloadAnswerFile(n,d)):d?.remove(),$("messages").appendChild(n),s.deferEnhance?(n.dataset.renderedHash=n.dataset.rawHash,n.dataset.deferEnhance="1",bindInlineCopyButtons(n),cleanupGeneratedImageNumberArtifacts(n),hydrateMessageMedia(n,{save:!s.skipSave})):o?chatuiQueueLazyMessage(n,i,{force:s.forceLazy}):(n.dataset.renderedHash=n.dataset.rawHash,bindInlineCopyButtons(n),enhanceRenderedMarkdown(n,{autoRenderMermaid:!0,forceMermaid:!0,deferMermaid:!0,allowResourceLoad:!0}),cleanupGeneratedImageNumberArtifacts(n),hydrateMessageMedia(n,{save:!s.skipSave}),bindSentQuotePreviews(n),n.dataset.enhancedHash=n.dataset.rawHash),chatuiRefreshVirtualizer(),setMessageMetaText(n,s.metaText||""),n.querySelector("img.generated-thumb")&&!s.deferEnhance&&revealNodeAboveComposer(n),s.noScroll||s.deferSave||scrollToBottom(!0),s.skipSave||s.deferSave||saveDisplayHistory(),n
      }
    }

    function addMessageProgressive(role, text, options = {}) {
      with (deps) {
        clearEmpty();
        const node = $("messageTemplate").content.firstElementChild.cloneNode(true);
        node.classList.add(role);
        node.querySelector(".avatar").textContent = role === "user" ? "我" : role === "error" ? "!" : "AI";
        const content = node.querySelector(".content");
        const rawText = options.rawText ?? text;
        const quote = quoteContextJson(options.quoteContext);
        node.dataset.rawText = rawText;
        node.dataset.rawHash = chatuiContentHash(rawText);
        if (quote) { node.dataset.quoteContext = quote; node.classList.add("has-quote"); }
        if (options.skipSave) node.dataset.persist = "0";
        if (options.messageIndex !== undefined && options.messageIndex !== null) node.dataset.messageIndex = String(options.messageIndex);
        if (options.responseIndex !== undefined && options.responseIndex !== null) node.dataset.responseIndex = String(options.responseIndex);
        if (options.attachmentContext) node.dataset.attachmentContext = options.attachmentContext;
        if (options.imageContext) node.dataset.imageContext = options.imageContext;

        const lazy = chatuiShouldLazyRender(role, rawText, options);
        const progressive = !options.html && role === "assistant" && shouldProgressiveRenderMarkdown(rawText) && !options.deferEnhance;
        if (options.deferEnhance && role === "assistant" && !options.html) content.innerHTML = "";
        else if (options.html) content.innerHTML = role === "user" ? withSentQuotePreview(stripTransientBlobUrlsFromHtml(text), quote) : stripTransientBlobUrlsFromHtml(text);
        else if (progressive) renderMarkdownPreviewSnapshot(content, rawText);
        else if (lazy) content.innerHTML = chatuiPlainPreview(rawText);
        else content.innerHTML = role === "user" ? withSentQuotePreview(renderUserMessageContent(String(text || "")), quote) : renderMarkdown(String(text || ""));

        cleanupGeneratedImageNumberArtifacts(node);
        bindSentQuotePreviews(node);
        node.querySelector(".quote-btn")?.addEventListener("click", () => selectQuotedMessage(node));
        const edit = node.querySelector(".edit-btn");
        if (role === "user") edit.addEventListener("click", () => editUserMessage(node));
        else edit.remove();
        const forceImage = node.querySelector(".force-image-btn");
        if (role === "user") forceImage?.addEventListener("click", () => forceImageFromUserMessage(node));
        else forceImage?.remove();
        const refresh = node.querySelector(".refresh-btn");
        if (role === "assistant" || role === "error") refresh.addEventListener("click", () => regenerateAssistantMessage(node));
        else refresh.remove();
        node.querySelector(".copy-btn")?.addEventListener("click", async () => {
          await copyText(messageCopyText(node.dataset.rawText, content.innerText || content.textContent || "", content));
          showCopySuccess(node.querySelector(".copy-btn"));
        });
        const download = node.querySelector(".download-answer-btn");
        if (role === "assistant") download?.addEventListener("click", () => downloadAnswerFile(node, download));
        else download?.remove();

        $("messages").appendChild(node);
        if (progressive) renderMarkdownProgressively(node, String(rawText || ""), node.dataset.rawHash);
        else if (options.deferEnhance) {
          node.dataset.renderedHash = node.dataset.rawHash;
          node.dataset.deferEnhance = "1";
          bindInlineCopyButtons(node);
          cleanupGeneratedImageNumberArtifacts(node);
          hydrateMessageMedia(node, { save: !options.skipSave });
        } else if (lazy) chatuiQueueLazyMessage(node, rawText, { force: options.forceLazy });
        else {
          node.dataset.renderedHash = node.dataset.rawHash;
          bindInlineCopyButtons(node);
          enhanceRenderedMarkdown(node, { autoRenderMermaid: true, forceMermaid: true, deferMermaid: true, allowResourceLoad: true });
          cleanupGeneratedImageNumberArtifacts(node);
          hydrateMessageMedia(node, { save: !options.skipSave });
          bindSentQuotePreviews(node);
          node.dataset.enhancedHash = node.dataset.rawHash;
        }
        chatuiRefreshVirtualizer();
        setMessageMetaText(node, options.metaText || "");
        if (node.querySelector("img.generated-thumb") && !options.deferEnhance) revealNodeAboveComposer(node);
        if (!options.noScroll && !options.deferSave) scrollToBottom(true);
        if (!options.skipSave && !options.deferSave) saveDisplayHistory();
        return node;
      }
    }

    return Object.freeze({ updateMessage, updateMessageContentLight, addMessage: addMessageProgressive, getQuotedMessage, clearQuotedMessage, selectQuotedMessage, resolveQuoteContextForNode, readQuoteContext, quoteContextJson, renderSentQuotePreview, withSentQuotePreview, jumpToQuotedMessage });
  }

  const api = Object.freeze({ createMessageWorkflow });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatUIAppMessageWorkflow = api;
  if (root?.window) root.window.ChatUIAppMessageWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

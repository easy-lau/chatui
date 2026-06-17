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

    function splitMarkdownRenderChunks(text = '') {
      const src = String(text || '').replace(/\r\n?/g, '\n');
      const chunks = [];
      let buf = '', inFence = false, fenceChar = '', fenceLen = 0, inMath = false;
      const flush = () => { if (buf) { chunks.push(buf); buf = ''; } };
      for (const line of src.split(/(?<=\n)/)) {
        const rawLine = line.replace(/\n$/, '');
        const fence = rawLine.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
        if (!inMath && fence) {
          const marker = fence[1], ch = marker[0], info = String(fence[2] || '').trim();
          if (inFence && ch === fenceChar && marker.length >= fenceLen && !info) {
            inFence = false; fenceChar = ''; fenceLen = 0; buf += line; flush(); continue;
          }
          if (!inFence) { inFence = true; fenceChar = ch; fenceLen = marker.length; }
          buf += line; continue;
        }
        if (!inFence && /^\s*\$\$\s*$/.test(rawLine)) {
          inMath = !inMath; buf += line; if (!inMath) flush(); continue;
        }
        buf += line;
        if (!inFence && !inMath && /^\s*$/.test(rawLine)) flush();
        if (!inFence && !inMath && buf.length > 8000) flush();
      }
      flush();
      return chunks.length ? chunks : [src];
    }

    function messageRoleLabel(role = '') {
      return role === 'user' ? '我' : role === 'assistant' ? 'AI' : '消息';
    }

    function messageRoleFromNode(node) {
      return node?.classList?.contains('assistant') ? 'assistant' : node?.classList?.contains('user') ? 'user' : 'error';
    }

    function normalizeQuoteText(text = '', limit = 1200) {
      return String(text || '')
        .replace(/\[base64 image\]/gi, '')
        .replace(/耗时：[^\n]+/g, '')
        .replace(/RT\s+[^\n]+/gi, '')
        .replace(/TTFT\s+[^\n]+/gi, '')
        .replace(/^\[图片(?:生成|编辑|修改)完成\]\s*/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limit);
    }

    function escapeHtmlLocal(value = '') {
      return String(value ?? '').replace(/[&<>\"'`]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;', '`': '&#96;' }[ch]));
    }

    function readQuoteContext(value) {
      if (!value) return null;
      if (typeof value === 'string') {
        try { return readQuoteContext(JSON.parse(value)); } catch { return null; }
      }
      if (!value || typeof value !== 'object') return null;
      const hasImageContext = !!(value.imageContext || value.image_context);
      const content = normalizeQuoteText(value.content ?? value.rawText ?? (hasImageContext ? '[图片消息]' : ''), 1200);
      if (!content && !hasImageContext) return null;
      const quote = { role: value.role === 'assistant' ? 'assistant' : 'user', content: content || '[图片消息]' };
      ['sessionId', 'displayItemId', 'messageIndex', 'responseIndex', 'imageContext', 'attachmentContext'].forEach(key => {
        const altKey = key === 'imageContext' ? 'image_context' : key === 'attachmentContext' ? 'attachment_context' : key;
        const raw = value[key] ?? value[altKey];
        if (raw !== undefined && raw !== null && raw !== '') quote[key] = typeof raw === 'string' ? raw : JSON.stringify(raw);
      });
      return quote;
    }

    function quoteContextJson(value) {
      const quote = readQuoteContext(value);
      return quote ? JSON.stringify(quote) : '';
    }

    function renderSentQuotePreview(value) {
      const quote = readQuoteContext(value);
      if (!quote) return '';
      const label = quote.role === 'assistant' ? 'AI' : '用户';
      const context = escapeHtmlLocal(JSON.stringify(quote));
      const text = escapeHtmlLocal(normalizeQuoteText(quote.content, 48));
      return `<button class="sent-quote-preview" type="button" data-quote-context="${context}" title="jump to quoted message"><span class="sent-quote-label">&#24341;&#29992;</span><span class="sent-quote-text">${text}</span></button>`;
    }

    function withSentQuotePreview(html = '', quoteContext = '') {
      const preview = renderSentQuotePreview(quoteContext);
      if (!preview || /class=["'][^"']*sent-quote-preview/.test(String(html || ''))) return String(html || '');
      return `${preview}${String(html || '')}`;
    }

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

    function jumpToQuotedMessage(quote) {
      const target = findQuotedMessageNode(quote);
      if (!target) return false;
      if (!deps.revealNodeAboveComposer?.(target, 18)) target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
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
      deps.document?.querySelectorAll?.('.message.quoted')?.forEach(node => node.classList.remove('quoted'));
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
      deps.document?.querySelectorAll?.('.message.quoted')?.forEach(item => item.classList.remove('quoted'));
      node.classList.add('quoted');
      deps.state.quotedMessage = quote;
      renderComposerQuote();
      deps.$?.('prompt')?.focus?.();
    }

    function renderMarkdownProgressively(messageNode, text = '', hash = chatuiContentHash(text)) {
      const render = deps.renderMarkdown || (value => String(value || ''));
      const resetActions = deps.resetMessageActionStates || (() => {});
      const bindCopy = deps.bindInlineCopyButtons || (() => {});
      const enhance = deps.enhanceRenderedMarkdown || (() => {});
      const hydrate = deps.hydrateMessageMedia || (() => {});
      const content = messageNode?.querySelector?.('.content');
      if (!content) return false;
      const shouldAutoRefocusTail = () => !deps.state?.userScrollLocked && (deps.shouldFollowScroll?.() ?? true);
      const refocusTailAfterMarkdownLayout = () => {
        if (!messageNode?.isConnected || !shouldAutoRefocusTail()) return;
        const root = deps.$?.('messages');
        if (!root || messageNode !== [...root.querySelectorAll?.('.message') || []].at(-1)) return;
        const run = () => {
          if (!messageNode.isConnected || !shouldAutoRefocusTail()) return;
          deps.state.autoScrollLocked = true;
          deps.state.programmaticScrollUntil = Math.max(Number(deps.state.programmaticScrollUntil) || 0, Date.now() + 900);
          try { deps.focusSessionTail?.({ margin: 18, threshold: 12 }); } catch {}
        };
        run();
        requestAnimationFrame?.(run);
      };
      const token = Date.now() + ':' + Math.random().toString(36).slice(2);
      try { messageNode.__progressiveCleanup?.(); } catch {}
      messageNode.dataset.progressiveRenderToken = token;
      messageNode.dataset.progressiveRendering = '1';
      messageNode.dataset.progressiveOffscreen = '1';
      if (deps.state && shouldAutoRefocusTail()) deps.state.programmaticScrollUntil = Math.max(Number(deps.state.programmaticScrollUntil) || 0, Date.now() + 1200);
      delete content.__plainStreamingTextNode;
      delete content.__plainStreamingBox;

      const doc = deps.document || document;
      const body = doc.body || doc.documentElement;
      const contentWidth = Math.max(320, Math.ceil(content.getBoundingClientRect?.().width || content.clientWidth || messageNode.getBoundingClientRect?.().width || 720));
      const stageHost = doc.createElement('div');
      stageHost.className = messageNode.className || 'message assistant';
      stageHost.dataset.progressiveStage = '1';
      stageHost.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + contentWidth + 'px;max-width:' + contentWidth + 'px;visibility:hidden;pointer-events:none;z-index:-1;contain:layout style;';
      const stageContent = doc.createElement('div');
      stageContent.className = content.className || 'content';
      stageHost.appendChild(stageContent);
      body.appendChild(stageHost);

      let cleaned = false;
      const cleanupStage = () => {
        if (cleaned) return;
        cleaned = true;
        try { stageContent.__chatuiEnhanceJob?.cancel?.(); } catch {}
        try { stageHost.remove(); } catch {}
        if (messageNode.__progressiveCleanup === cleanupStage) delete messageNode.__progressiveCleanup;
      };
      messageNode.__progressiveCleanup = cleanupStage;

      const chunks = splitMarkdownRenderChunks(text);
      const nodeQueue = [];
      let chunkIndex = 0;
      let finishing = false;
      const isCurrent = () => messageNode.isConnected && messageNode.dataset.progressiveRenderToken === token;
      const schedule = () => {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 80 });
        else setTimeout(() => run(), 0);
      };
      const finish = async () => {
        if (finishing || !isCurrent()) return;
        finishing = true;
        try {
          resetActions(messageNode);
          cleanupGeneratedImageNumberArtifacts(stageContent);
          bindCopy(stageContent);
          const enhancePromise = enhance(stageContent, { deferMermaid: true, allowResourceLoad: true, autoRenderMermaid: true, forceMermaid: true });
          await Promise.resolve(enhancePromise).catch(() => []);
          if (!isCurrent()) return cleanupStage();
          hydrate(stageContent, { save: false });
          cleanupGeneratedImageNumberArtifacts(stageContent);
          const shouldRefocus = shouldAutoRefocusTail();
          const restoreProgressiveAnchor = shouldRefocus && deps.state?.activeOutputNode === messageNode
            ? deps.preserveMessageBottomAnchor?.(messageNode, 72)
            : null;
          content.replaceChildren(...[...stageContent.childNodes]);
          messageNode.dataset.renderedHash = hash;
          messageNode.dataset.enhancedHash = hash;
          delete messageNode.dataset.progressiveRendering;
          delete messageNode.dataset.progressiveOffscreen;
          cleanupGeneratedImageNumberArtifacts(messageNode);
          hydrate(messageNode, { save: false });
          resetActions(messageNode);
          cleanupStage();
          if (shouldRefocus) {
            restoreProgressiveAnchor?.();
            refocusTailAfterMarkdownLayout();
            Promise.resolve().then(refocusTailAfterMarkdownLayout);
            requestAnimationFrame?.(() => restoreProgressiveAnchor?.());
          }
        } catch (err) {
          console.warn('[chatui] progressive markdown offscreen render failed', err);
          if (isCurrent()) {
            content.innerHTML = render(text);
            messageNode.dataset.renderedHash = hash;
            delete messageNode.dataset.progressiveRendering;
            delete messageNode.dataset.progressiveOffscreen;
            try { bindCopy(messageNode); enhance(messageNode, { deferMermaid: true, allowResourceLoad: true, autoRenderMermaid: true, forceMermaid: true }); } catch {}
          }
          cleanupStage();
        }
      };
      const run = deadline => {
        if (!isCurrent()) return cleanupStage();
        const started = performance?.now ? performance.now() : Date.now();
        const batch = [];
        while (true) {
          while (nodeQueue.length) {
            batch.push(nodeQueue.shift());
            const now = performance?.now ? performance.now() : Date.now();
            const timeLeft = typeof deadline?.timeRemaining === 'function' ? deadline.timeRemaining() : 0;
            if (batch.length >= 48 || (now - started) > 10 || (timeLeft && timeLeft < 5)) break;
          }
          if (batch.length || chunkIndex >= chunks.length) break;
          const tpl = doc.createElement('template');
          tpl.innerHTML = render(chunks[chunkIndex++]);
          nodeQueue.push(...tpl.content.childNodes);
          const now = performance?.now ? performance.now() : Date.now();
          const timeLeft = typeof deadline?.timeRemaining === 'function' ? deadline.timeRemaining() : 0;
          if ((now - started) > 10 || (timeLeft && timeLeft < 5)) break;
        }
        if (batch.length) stageContent.append(...batch);
        if (chunkIndex < chunks.length || nodeQueue.length) return schedule();
        finish();
      };
      schedule();
      return true;
    }

    function ensurePlainMarkdownStream(contentNode) {
      if (!contentNode) return null;
      let box = contentNode.__plainStreamingBox;
      if (!box || !box.isConnected) {
        contentNode.innerHTML = '<pre class="markdown-stream-plain"></pre>';
        box = contentNode.querySelector('.markdown-stream-plain');
        const textNode = document.createTextNode('');
        if (box) box.appendChild(textNode);
        contentNode.__plainStreamingBox = box;
        contentNode.__plainStreamingTextNode = textNode;
      }
      return box;
    }

    function updatePlainMarkdownStream(messageNode, contentNode, rawValue = '', incoming = '') {
      const box = ensurePlainMarkdownStream(contentNode);
      if (!box) return false;
      const textNode = contentNode.__plainStreamingTextNode || box.firstChild || document.createTextNode('');
      if (!textNode.parentNode) box.appendChild(textNode);
      const previous = String(messageNode.__plainStreamingRaw || '');
      const next = String(rawValue || '');
      if (next.startsWith(previous)) {
        const delta = next.slice(previous.length) || String(incoming || '');
        if (delta) textNode.data += delta;
      } else {
        textNode.data = next;
      }
      messageNode.__plainStreamingRaw = next;
      messageNode.dataset.streamingPlainMarkdown = '1';
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
        if (e.__markdownStreamingRenderer?.final && !s.html && !e.classList?.contains("user")) {
          try {
            if (largeAssistantMarkdown) {
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
          delete e.__markdownStreamingRenderer;
        }
        if (!rendered && e.dataset.streamingPlainMarkdown === "1" && largeAssistantMarkdown) {
          renderMarkdownProgressively(e, rawValue, rawHash);
          rendered = true;
          e.dataset.markdownFinalMode = "progressive-final";
        }
        delete e.__plainStreamingRaw;
        delete e.dataset.streamingPlainMarkdown;

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
        const rawHash = chatuiContentHash(rawValue);
        const chatStream = s.streamKind === 'chat' && !s.html && !e.classList?.contains('user');
        if (!s.html && !chatStream && !e.classList?.contains('user') && e.dataset.rawHash === rawHash && e.dataset.renderedHash === rawHash && e.dataset.enhancedHash === rawHash && !s.forceRender) {
          cleanupGeneratedImageNumberArtifacts(e);
          return;
        }

        const restoreViewport = s.noScroll ? (state.userScrollLocked ? preserveMessageViewport(e) : preserveMessageBottomAnchor(e, 72)) : null;
        e.dataset.rawText = rawValue;
        e.dataset.rawHash = rawHash;
        e.dataset.streaming = '1';
        if (void 0 !== s.streamKind) e.dataset.streamKind = s.streamKind || '';
        if (void 0 !== s.runToken) e.dataset.streamRunToken = s.runToken || '';
        if (s.skipSave) e.dataset.persist = '0';

        if (chatStream && shouldProgressiveRenderMarkdown(rawValue)) {
          delete e.__markdownStreamingRenderer;
          delete e.dataset.enhancedHash;
          updatePlainMarkdownStream(e, contentNode, rawValue, t);
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
        else if (progressive) content.innerHTML = '<div class="markdown-progressive-status">正在分块挂载 Markdown...</div>';
        else if (lazy) content.innerHTML = chatuiPlainPreview(rawText);
        else content.innerHTML = role === "user" ? withSentQuotePreview(renderUserMessageContent(String(text || "")), quote) : renderMarkdown(String(text || ""));

        cleanupGeneratedImageNumberArtifacts(node);
        bindSentQuotePreviews(node);
        node.querySelector(".quote-btn")?.addEventListener("click", () => selectQuotedMessage(node));
        const edit = node.querySelector(".edit-btn");
        if (role === "user") edit.addEventListener("click", () => editUserMessage(node));
        else edit.remove();
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

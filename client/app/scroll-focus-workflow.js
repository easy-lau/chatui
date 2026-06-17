(function initChatUIAppScrollFocusWorkflow(root) {
  // Intentionally not strict: scroll/focus bodies are migrated from app.js and resolved through a deps scope.

  function createScrollFocusWorkflow(deps = {}) {
    if (!deps.state) throw new Error('state is required');

    const state = deps.state;
    const getElement = deps.$ || deps.getElement || (id => (root.document || document).getElementById(id));
    const documentRef = deps.document || root.document || document;
    const windowRef = deps.window || root.window || root;
    const getActiveRun = deps.getActiveRun || (() => null);
    const now = () => Date.now();
    const raf = cb => (windowRef.requestAnimationFrame || setTimeout).call(windowRef, cb, 0);

    let scrollTimer = null;
    let pointerScrolling = false;
    let pointerScrollTimer = null;
    let sessionTailFocusCleanup = null;
    let layoutPinSession = null;
    let programmaticScrollDepth = 0;
    let streamingPinTimer = null;
    let lastStreamingPinAt = 0;
    let resumeButtonTimer = null;
    let lastResumeButtonUpdate = 0;

    const createAutoFollowState = windowRef.ChatUI?.scroll?.createAutoFollowState
      || windowRef.ChatUIScrollController?.createAutoFollowState
      || root.ChatUIScrollController?.createAutoFollowState;
    const autoFollow = typeof createAutoFollowState === 'function'
      ? createAutoFollowState({ threshold: 140, suppressMs: 360, now })
      : null;

    function messagesEl() { return getElement('messages'); }

    function cancelScrollTimer() {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }

    function messagesBottomGap() {
      const el = messagesEl();
      return el ? Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight) : 0;
    }

    function jumpToMessagesBottom(options = {}) {
      const el = messagesEl();
      if (!el) return false;
      withProgrammaticScroll(() => {
        el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        state.lastMessageScrollTop = el.scrollTop;
      }, Number.isFinite(options.durationMs) ? options.durationMs : 160);
      state.userScrollLocked = false;
      state.streamFocusLocked = false;
      state.autoScrollLocked = true;
      updateResumeStreamButton();
      return messagesBottomGap() <= (Number.isFinite(options.threshold) ? options.threshold : 12);
    }

    function isNearMessagesBottom(threshold = 180) {
      return messagesBottomGap() <= threshold;
    }

    function setMessagesProgrammaticScroll(durationMs = 420) {
      state.programmaticScrollUntil = now() + durationMs;
      try { autoFollow?.suppress?.(); } catch {}
    }

    function withProgrammaticScroll(fn, durationMs = 420) {
      setMessagesProgrammaticScroll(durationMs);
      programmaticScrollDepth += 1;
      try { return fn?.(); }
      finally {
        raf(() => setTimeout(() => { programmaticScrollDepth = Math.max(0, programmaticScrollDepth - 1); }, Math.max(80, durationMs / 2)));
      }
    }

    function getSessionTailAnchor() {
      const el = messagesEl();
      if (!el) return null;
      const nodes = [...el.querySelectorAll('.message')].filter(node => node.offsetParent !== null && node.getBoundingClientRect().height > 0);
      return nodes[nodes.length - 1] || null;
    }

    function ensureTailScrollSpace(margin = 72) {
      const el = messagesEl();
      const composerRect = documentRef.querySelector('.composer')?.getBoundingClientRect();
      if (!el || !composerRect) return;
      const rect = el.getBoundingClientRect();
      const safeBottom = getComposerSafeBottom();
      const composerOverlap = Math.max(0, rect.bottom - (composerRect.top - margin));
      const next = Math.max(safeBottom, composerOverlap);
      const clamped = Math.max(96, Math.min(320, Math.ceil(next)));
      el.style.setProperty('--session-tail-scroll-space', `${clamped}px`);
      el.style.setProperty('--messages-bottom-space', `${clamped}px`);
    }

    function focusSessionTail(options = {}) {
      const el = messagesEl();
      if (!el) return false;
      if (state.userScrollLocked && !options.force) return false;
      if (now() < (state.suppressTailFocusUntil || 0) && !options.force) return false;

      const margin = Number.isFinite(options.margin) ? options.margin : 72;
      ensureTailScrollSpace(margin);
      state.userScrollLocked = false;
      state.streamFocusLocked = false;
      state.autoScrollLocked = true;
      autoFollow?.begin?.(el);

      const tail = getSessionTailAnchor();
      if (tail) {
        pinNodeBottomToTarget(tail, { margin });
        state.lastMessageScrollTop = el.scrollTop;
        updateResumeStreamButton();
        const tailRect = tail.getBoundingClientRect();
        const composerRect = documentRef.querySelector('.composer')?.getBoundingClientRect();
        const messagesRect = el.getBoundingClientRect();
        const targetBottom = Math.min(messagesRect.bottom, (composerRect?.top || windowRef.innerHeight) - margin);
        return Math.abs(tailRect.bottom - targetBottom) <= (Number.isFinite(options.threshold) ? options.threshold : 10);
      }

      withProgrammaticScroll(() => { el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight); });
      state.lastMessageScrollTop = el.scrollTop;
      updateResumeStreamButton();
      return messagesBottomGap() <= (Number.isFinite(options.threshold) ? options.threshold : 10);
    }

    function scheduleSessionTailFocus(options = {}) {
      const settleMs = Array.isArray(options.settleMs) ? options.settleMs : [0, 50, 150, 320, 700];
      const version = ++state.scrollVersion;
      focusSessionTail({ ...options, force: options.force !== false });
      raf(() => { if (state.scrollVersion === version) focusSessionTail({ ...options, force: options.force !== false }); });
      settleMs.forEach(delay => setTimeout(() => {
        if (state.scrollVersion === version) focusSessionTail({ ...options, force: options.force !== false });
      }, delay));
      return version;
    }

    function cancelSessionTailFocusAfterLayout() {
      try { sessionTailFocusCleanup?.(); } catch {}
      sessionTailFocusCleanup = null;
      layoutPinSession = null;
    }

    function layoutPendingCount(rootNode = messagesEl()) {
      if (!rootNode?.querySelectorAll) return 0;
      let count = 0;
      count += rootNode.querySelectorAll('img.image-restoring, img[data-markdown-media-pending="1"]').length;
      rootNode.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src') || '';
        if (src && !src.startsWith('data:image/gif;base64,R0lGODlhAQABAIA') && img.complete === false) count += 1;
      });
      count += rootNode.querySelectorAll('[data-progressive-rendering="1"], .markdown-progressive-status, .long-answer-block-pending, [data-long-answer-state="rendering"], [data-mermaid-rendered="rendering"], .markdown-mermaid-pending[data-mermaid-rendered="rendering"]').length;
      try { if (documentRef.fonts && documentRef.fonts.status !== 'loaded') count += 1; } catch {}
      return count;
    }

    function layoutSnapshot(el = messagesEl()) {
      if (!el) return '';
      const tail = getSessionTailAnchor();
      const tailRect = tail?.getBoundingClientRect?.();
      const docEl = documentRef.scrollingElement || documentRef.documentElement;
      return [
        el.scrollHeight,
        el.clientHeight,
        el.children.length,
        Math.round(el.scrollTop || 0),
        Math.round(tailRect?.top || 0),
        Math.round(tailRect?.bottom || 0),
        Math.round(tailRect?.height || 0),
        docEl?.scrollHeight || 0,
        documentRef.body?.scrollHeight || 0,
        windowRef.innerHeight || 0,
        layoutPendingCount(el),
      ].join(':');
    }

    function scheduleSessionTailFocusAfterLayout(options = {}) {
      const el = messagesEl();
      if (!el) return scheduleSessionTailFocus(options);
      cancelSessionTailFocusAfterLayout();

      if (options.reason === 'switch-bottom' || options.instantBottom === true) {
        const version = ++state.scrollVersion;
        const apply = () => { if (state.scrollVersion === version) jumpToMessagesBottom({ durationMs: 160 }); };
        apply();
        raf(apply);
        [40, 120, 260].forEach(delay => setTimeout(apply, delay));
        return version;
      }

      const version = ++state.scrollVersion;
      const quietMs = Number.isFinite(options.quietMs) ? options.quietMs : 180;
      const maxMs = Number.isFinite(options.maxMs) ? options.maxMs : 9000;
      const stableFramesTarget = Number.isFinite(options.stableFrames) ? Math.max(2, options.stableFrames) : 4;
      const minWaitMs = Number.isFinite(options.minWaitMs) ? Math.max(0, options.minWaitMs) : 220;
      const startedAt = now();
      const observed = new WeakSet();
      const imageObserved = new WeakSet();
      const session = { version, released: false, bottomGap: 0, pending: 0, reason: options.reason || 'layout' };
      layoutPinSession = session;

      let resizeObserver = null;
      let mutationObserver = null;
      let settleTimer = null;
      let maxTimer = null;
      let frameHandle = null;
      let lastSnapshot = '';
      let stableFrames = 0;

      const canPin = () => state.scrollVersion === version && !session.released && !state.userScrollLocked;

      const rememberGap = () => {
        session.bottomGap = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
      };

      const applyBottomGap = () => {
        if (!canPin()) return;
        withProgrammaticScroll(() => {
          const next = Math.max(0, el.scrollHeight - el.clientHeight - session.bottomGap);
          el.scrollTop = next;
          state.lastMessageScrollTop = el.scrollTop;
        });
        updateResumeStreamButton();
      };

      const pin = () => {
        if (!canPin()) return;
        focusSessionTail({ ...options, force: true });
        rememberGap();
      };

      const observeImages = () => {
        el.querySelectorAll('img').forEach(img => {
          if (imageObserved.has(img)) return;
          imageObserved.add(img);
          const onDone = () => notifyLayoutChange('image');
          try {
            img.addEventListener('load', onDone, { once: true });
            img.addEventListener('error', onDone, { once: true });
          } catch {}
        });
      };

      const observeLayoutTargets = () => {
        if (!resizeObserver) return;
        const selector = '.message,.bubble-wrap,.bubble,.content,.reasoning-panel,.markdown-body,img,video,iframe,table,pre,.code-block,.mermaid,.mermaid-block,.markdown-mermaid-pending,svg,canvas,.long-answer-block,[data-progressive-rendering="1"]';
        [el, ...el.querySelectorAll(selector)].forEach(node => {
          try {
            if (!observed.has(node)) {
              observed.add(node);
              resizeObserver.observe(node);
            }
          } catch {}
        });
        observeImages();
      };

      const cleanup = () => {
        clearTimeout(settleTimer);
        clearTimeout(maxTimer);
        if (frameHandle) windowRef.cancelAnimationFrame?.(frameHandle);
        try { resizeObserver?.disconnect?.(); } catch {}
        try { mutationObserver?.disconnect?.(); } catch {}
        session.released = true;
        if (layoutPinSession === session) layoutPinSession = null;
        sessionTailFocusCleanup = null;
      };

      const finish = reason => {
        if (session.released || state.scrollVersion !== version) return;
        if (!state.userScrollLocked) {
          pin();
          raf(() => { if (state.scrollVersion === version && !state.userScrollLocked) applyBottomGap(); });
        }
        cleanup();
        if (options.releaseBooting) {
          try { documentRef.body.classList.remove('app-booting'); } catch {}
        }
        try { options.onDone?.(reason); } catch {}
      };

      const stableLoop = () => {
        if (session.released || state.scrollVersion !== version) return;
        applyBottomGap();
        const snapshot = layoutSnapshot(el);
        const pending = layoutPendingCount(el) + session.pending;
        if (snapshot === lastSnapshot && pending === 0 && now() - startedAt >= minWaitMs) stableFrames += 1;
        else { lastSnapshot = snapshot; stableFrames = 0; }
        if (stableFrames >= stableFramesTarget) return finish('stable');
        frameHandle = raf(stableLoop);
      };

      const scheduleSettle = () => {
        if (session.released || state.scrollVersion !== version) return;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          stableFrames = 0;
          lastSnapshot = '';
          frameHandle = raf(stableLoop);
        }, quietMs);
      };

      function notifyLayoutChange(reason = 'layout') {
        if (session.released || state.scrollVersion !== version) return;
        observeLayoutTargets();
        if (!state.userScrollLocked) {
          applyBottomGap();
          raf(() => { if (state.scrollVersion === version && !state.userScrollLocked) applyBottomGap(); });
        }
        scheduleSettle();
      }

      if (windowRef.ResizeObserver) {
        resizeObserver = new windowRef.ResizeObserver(() => notifyLayoutChange('resize'));
        observeLayoutTargets();
      }
      if (windowRef.MutationObserver) {
        mutationObserver = new windowRef.MutationObserver(() => notifyLayoutChange('mutation'));
        mutationObserver.observe(el, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'src', 'srcset', 'data-persisted-src', 'width', 'height', 'viewBox', 'data-mermaid-rendered', 'data-state', 'data-progressive-rendering', 'data-long-answer-state', 'data-markdown-media-pending'],
        });
      }

      if (options.immediate !== false) {
        pin();
        raf(() => { if (state.scrollVersion === version && !state.userScrollLocked) { pin(); rememberGap(); } });
      }
      const settleMs = Array.isArray(options.settleMs) ? options.settleMs : [0, 80, 180, 360, 720, 1400, 2600];
      settleMs.forEach(delay => setTimeout(() => notifyLayoutChange(`settle:${delay}`), delay));
      try { documentRef.fonts?.ready?.then?.(() => notifyLayoutChange('fonts')).catch?.(() => {}); } catch {}
      maxTimer = setTimeout(() => finish('max'), maxMs);
      scheduleSettle();

      sessionTailFocusCleanup = cleanup;
      return version;
    }

    function notifyLayoutChange(reason = 'layout') {
      const session = layoutPinSession;
      if (!session || session.released) return false;
      const el = messagesEl();
      if (!el) return false;
      if (!state.userScrollLocked) {
        withProgrammaticScroll(() => {
          const next = Math.max(0, el.scrollHeight - el.clientHeight - (session.bottomGap || 0));
          el.scrollTop = next;
          state.lastMessageScrollTop = el.scrollTop;
        });
      }
      updateResumeStreamButton();
      return true;
    }

    function registerLayoutPromise(promise, reason = 'layout-promise') {
      const session = layoutPinSession;
      if (!session || !promise?.then) return promise;
      session.pending += 1;
      notifyLayoutChange(`${reason}:start`);
      return Promise.resolve(promise).finally(() => {
        session.pending = Math.max(0, session.pending - 1);
        notifyLayoutChange(`${reason}:done`);
      });
    }

    function updateAutoScrollLock() {
      state.autoScrollLocked = !!state.streamFocusLocked && !state.userScrollLocked;
    }

    function shouldFollowScroll() {
      return !!state.streamFocusLocked && !state.userScrollLocked;
    }

    function restoreStreamingFollowIfNearBottom(threshold = 180) {
      if (!isNearMessagesBottom(threshold)) return false;
      state.userScrollLocked = false;
      state.autoScrollLocked = true;
      const active = getActiveOutputForSession(state.activeSessionId);
      if (active?.isConnected && active.dataset.streaming === '1') {
        state.streamFocusLocked = true;
        state.activeOutputNode = active;
      }
      updateResumeStreamButton();
      return true;
    }

    function preserveMessageViewport(node) {
      const el = messagesEl();
      const initialTop = node?.isConnected ? node.getBoundingClientRect().top : null;
      const initialScrollTop = el ? el.scrollTop : null;
      return () => {
        if (!node?.isConnected) return;
        if (el && initialScrollTop !== null) {
          const currentTop = node.getBoundingClientRect().top;
          if (initialTop !== null && Number.isFinite(currentTop)) el.scrollTop += currentTop - initialTop;
          else el.scrollTop = initialScrollTop;
        } else if (initialTop !== null) {
          const currentTop = node.getBoundingClientRect().top;
          if (Number.isFinite(currentTop)) windowRef.scrollBy({ top: currentTop - initialTop, behavior: 'auto' });
        }
        updateResumeStreamButton();
      };
    }

    function preserveMessageBottomAnchor(node, margin = 72) {
      return () => {
        if (shouldFollowScroll()) pinNodeBottomToTarget(node, { margin });
        updateResumeStreamButton();
      };
    }

    function markManualMessageScroll(event) {
      const el = messagesEl();
      if (!el) return;
      if ((event?.currentTarget === windowRef || event?.target === windowRef) && event?.target && !el.contains(event.target) && event.target !== documentRef && event.target !== documentRef.body && event.target !== documentRef.documentElement) return;

      const type = event?.type || '';
      const currentTop = Number(el.scrollTop) || 0;
      const pointerEvent = type === 'pointerdown' || type === 'mousedown';
      const directUserGesture = type === 'wheel' || type === 'touchstart' || type === 'touchmove' || pointerEvent;
      const wheelUp = type === 'wheel' && Number(event?.deltaY || 0) < -1;
      const touch = type === 'touchstart' || type === 'touchmove';
      const explicitUserAway = wheelUp || touch || pointerEvent;
      const suppressed = !directUserGesture && (programmaticScrollDepth > 0 || now() < (state.programmaticScrollUntil || 0));
      if (pointerEvent) {
        pointerScrolling = true;
        clearTimeout(pointerScrollTimer);
        pointerScrollTimer = setTimeout(() => { pointerScrolling = false; }, 1200);
      }

      if (suppressed) {
        state.lastMessageScrollTop = currentTop;
        try { autoFollow?.suppress?.(); } catch {}
        return;
      }

      let userAway = false;
      if (autoFollow) {
        const autoState = autoFollow.markEvent(event, el);
        userAway = explicitUserAway || !!autoState.userScrolledAway;
        if (!userAway && autoFollow.isNearBottom?.(el)) {
          state.userScrollLocked = false;
          state.autoScrollLocked = true;
        }
      } else {
        const scrollUp = type === 'scroll' && currentTop < (state.lastMessageScrollTop || 0) - 1;
        const scrollbarAway = type === 'scroll' && !isNearMessagesBottom(140) && (pointerScrolling || Math.abs(currentTop - (state.lastMessageScrollTop || 0)) > 1);
        userAway = explicitUserAway || scrollUp || scrollbarAway;
      }

      if (userAway) {
        state.streamFocusLocked = false;
        state.userScrollLocked = true;
        state.autoScrollLocked = false;
        state.outputPinSuppressUntil = now() + 6000;
        state.scrollVersion += 1;
        cancelScrollTimer();
        cancelSessionTailFocusAfterLayout();
      } else if (isNearMessagesBottom(120)) {
        state.userScrollLocked = false;
        state.autoScrollLocked = true;
        try { autoFollow?.begin?.(el); } catch {}
      }
      setTimeout(updateResumeStreamButton, 0);
      setTimeout(updateResumeStreamButton, 140);
      state.lastMessageScrollTop = currentTop;
    }

    function getComposerSafeBottom() {
      const value = getComputedStyle(documentRef.documentElement).getPropertyValue('--composer-safe-bottom');
      const parsed = parseFloat(value);
      const helper = windowRef.ChatUI?.scroll?.composerSafeBottom || windowRef.ChatUIScrollController?.composerSafeBottom;
      return helper ? helper(value, 168) : Number.isFinite(parsed) ? parsed : 168;
    }

    function scrollToBottom(force = true, options = {}) {
      const el = messagesEl();
      if (!el) return;
      if (!force && !shouldFollowScroll()) return;
      const isMobile = windowRef.matchMedia?.('(max-width: 640px)').matches;
      const settleMs = Array.isArray(options.settleMs) ? options.settleMs : [isMobile ? 80 : 160, 360];
      state.autoScrollLocked = true;
      state.userScrollLocked = false;
      try { autoFollow?.begin?.(el); } catch {}
      const version = ++state.scrollVersion;
      setMessagesProgrammaticScroll();
      const apply = () => focusSessionTail({ threshold: 12, force: true });
      apply();
      raf(() => { if (state.scrollVersion === version) apply(); });
      cancelScrollTimer();
      settleMs.forEach((delay, index) => {
        const timer = setTimeout(() => { if (state.scrollVersion === version) apply(); }, delay);
        if (index === settleMs.length - 1) scrollTimer = timer;
      });
    }

    function settleScrollToBottom(options = {}) {
      scrollToBottom(true, { settleMs: options.settleMs || [50, 150, 360] });
    }

    function activeOutputBottomTarget(margin = 24) {
      const rect = documentRef.querySelector('.composer')?.getBoundingClientRect();
      const helper = windowRef.ChatUI?.scroll?.activeOutputBottomTarget || windowRef.ChatUIScrollController?.activeOutputBottomTarget;
      return helper ? helper({ composerTop: rect?.top, viewportHeight: windowRef.innerHeight, margin }) : Math.max(80, (rect?.top || windowRef.innerHeight) - margin);
    }

    function lockToStreamingOutput(node, options = {}) {
      if (!node?.isConnected) return;
      state.streamFocusLocked = true;
      state.userScrollLocked = false;
      state.autoScrollLocked = true;
      state.activeOutputNode = node;
      pinNodeBottomToTarget(node, options);
    }

    function settleActiveOutput(node, options = {}) {
      if (!node?.isConnected || state.userScrollLocked) return;
      const durationMs = Number.isFinite(options.durationMs) ? Math.max(160, options.durationMs) : 900;
      const until = now() + durationMs;
      const apply = () => {
        if (!node?.isConnected || state.userScrollLocked) return false;
        if (node.dataset.sessionId && node.dataset.sessionId !== state.activeSessionId) return false;
        pinNodeBottomToTarget(node, options);
        return true;
      };
      apply();
      raf(() => apply());
      [50, 150, 320, 700].forEach(delay => setTimeout(() => apply(), delay));
      let timer = null;
      let ro = null;
      const stop = () => { clearTimeout(timer); try { ro?.disconnect?.(); } catch {} };
      const tick = () => {
        if (now() > until || !apply()) return stop();
        clearTimeout(timer);
        timer = setTimeout(tick, 90);
      };
      if (windowRef.ResizeObserver) {
        try {
          ro = new windowRef.ResizeObserver(tick);
          [node, ...node.querySelectorAll('.content,.reasoning-panel,.markdown-body,img,video,iframe,table,pre,.code-block,.mermaid,.mermaid-block,.long-answer-block')].forEach(item => ro.observe(item));
        } catch {}
      }
      setTimeout(stop, durationMs + 80);
    }

    function armStreamingOutputFocus(sessionId, node, options = {}) {
      if (!sessionId || !node) return;
      const margin = Number.isFinite(options.margin) ? options.margin : 72;
      if (options.clearStaleFocus) {
        state.streamFocusLocked = false;
        state.autoScrollLocked = false;
        state.userScrollLocked = false;
        state.outputPinSuppressUntil = 0;
        cancelScrollTimer();
      }
      setActiveOutputForSession(sessionId, node);
      if (sessionId === state.activeSessionId && node.isConnected) lockToStreamingOutput(node, { margin });
      else updateResumeStreamButton();
    }

    function pinNodeBottomToTarget(node, options = {}) {
      if (!node?.isConnected) return;
      const el = messagesEl();
      if (!el) return;
      setMessagesProgrammaticScroll();
      const margin = Number.isFinite(options.margin) ? options.margin : 72;
      const target = activeOutputBottomTarget(margin);
      const messagesRect = el.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const targetBottom = Math.min(messagesRect.bottom, target);
      const scrollable = el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible';
      withProgrammaticScroll(() => {
        if (scrollable) {
          if (nodeRect.bottom > targetBottom + 1) el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + (nodeRect.bottom - targetBottom)));
          else if (nodeRect.bottom < messagesRect.top) el.scrollTop = Math.max(0, el.scrollTop - (messagesRect.top - nodeRect.bottom + margin));
          state.lastMessageScrollTop = el.scrollTop;
        } else {
          const delta = nodeRect.bottom - targetBottom;
          if (Math.abs(delta) > 1) {
            const scrollY = windowRef.scrollY || documentRef.documentElement?.scrollTop || documentRef.body?.scrollTop || 0;
            windowRef.scrollTo({ top: Math.max(0, scrollY + delta), behavior: 'auto' });
          }
          state.lastMessageScrollTop = el.scrollTop;
        }
      });
    }

    function scrollToActiveOutput(node, options = {}) {
      const el = messagesEl();
      if (!el || !node?.isConnected) return;
      if (options.active) state.activeOutputNode = node;
      if (options.force === false) { updateResumeStreamButton(); return; }
      if (!state.userScrollLocked && node.dataset.streaming === '1' && options.settle === false) {
        state.streamFocusLocked = true;
        state.userScrollLocked = false;
        state.autoScrollLocked = true;
        const throttleMs = Number.isFinite(options.throttleMs) ? Math.max(32, options.throttleMs) : 90;
        const run = () => {
          streamingPinTimer = null;
          if (!node?.isConnected || state.userScrollLocked) return;
          lastStreamingPinAt = now();
          pinNodeBottomToTarget(node, options);
          updateResumeStreamButton();
        };
        if (now() - lastStreamingPinAt >= throttleMs) run();
        else if (!streamingPinTimer) streamingPinTimer = setTimeout(run, Math.max(16, throttleMs - (now() - lastStreamingPinAt)));
        updateResumeStreamButton();
        return;
      }
      if (!state.userScrollLocked) lockToStreamingOutput(node, options);
      updateResumeStreamButton();
    }

    function isNodeAwayFromOutputFocus(node) {
      if (!node?.isConnected) return false;
      const nodeRect = node.getBoundingClientRect();
      const messagesRect = messagesEl()?.getBoundingClientRect();
      const composerRect = documentRef.querySelector('.composer')?.getBoundingClientRect();
      const helper = windowRef.ChatUI?.scroll?.isNodeAwayFromOutputFocus || windowRef.ChatUIScrollController?.isNodeAwayFromOutputFocus;
      if (helper) return helper({ nodeRect, messagesRect, composerTop: composerRect?.top, viewportHeight: windowRef.innerHeight, margin: 72 });
      const focusBottom = (composerRect?.top || windowRef.innerHeight) - 72;
      const top = messagesRect?.top || 0;
      const bottom = messagesRect?.bottom ? Math.min(messagesRect.bottom, focusBottom) : focusBottom;
      return nodeRect.bottom > bottom + 72 || nodeRect.bottom < top + 80 || nodeRect.top > bottom || nodeRect.bottom < top;
    }

    function setActiveOutputForSession(sessionId, node) {
      if (sessionId && node) node.dataset.sessionId = sessionId;
      if (sessionId) {
        if (node) state.activeOutputSessions.set(sessionId, node);
        else state.activeOutputSessions.delete(sessionId);
      }
      if (sessionId === state.activeSessionId) state.activeOutputNode = node || null;
      updateResumeStreamButton();
    }

    function getActiveOutputForSession(sessionId = state.activeSessionId) {
      let node = sessionId === state.activeSessionId ? state.activeOutputNode : state.activeOutputSessions.get(sessionId) || null;
      if (node?.isConnected) return node;
      if (sessionId === state.activeSessionId) {
        const found = [...documentRef.querySelectorAll('.message[data-streaming="1"]')].reverse().find(item => !item.dataset.sessionId || item.dataset.sessionId === sessionId);
        if (found) { node = found; setActiveOutputForSession(sessionId, found); }
      }
      return node || null;
    }

    function updateResumeStreamButton(options = {}) {
      if (!options.immediate) {
        const elapsed = now() - lastResumeButtonUpdate;
        if (elapsed < 80) {
          if (!resumeButtonTimer) resumeButtonTimer = setTimeout(() => {
            resumeButtonTimer = null;
            updateResumeStreamButton({ immediate: true });
          }, Math.max(16, 80 - elapsed));
          return;
        }
      }
      lastResumeButtonUpdate = now();
      const button = getElement('resumeStreamBtn');
      const active = getActiveOutputForSession(state.activeSessionId);
      if (!button) return;
      const composerRect = documentRef.querySelector('.composer')?.getBoundingClientRect();
      if (composerRect) button.style.setProperty('--resume-stream-left', `${composerRect.left + composerRect.width / 2}px`);
      const run = getActiveRun(state.activeSessionId);
      const validNode = active?.isConnected && active.closest('#messages') && active.dataset.sessionId === state.activeSessionId;
      const streaming = !!(validNode && active.dataset.streaming === '1' && (!active.dataset.streamKind || active.dataset.streamKind === 'chat') && (!active.dataset.streamRunToken || !run?.token || active.dataset.streamRunToken === run.token) && state.busySessions.has(state.activeSessionId));
      const suppressed = now() < (state.resumeButtonSuppressUntil || 0);
      const away = streaming && isNodeAwayFromOutputFocus(active);
      const show = !!(streaming && !suppressed && (!state.streamFocusLocked || away));
      button.classList.toggle('show', show);
      button.setAttribute('aria-hidden', show ? 'false' : 'true');
    }

    function resumeActiveOutputFocus() {
      const active = getActiveOutputForSession(state.activeSessionId);
      if (!active?.isConnected) return;
      state.resumeButtonSuppressUntil = now() + 500;
      state.outputPinSuppressUntil = 0;
      getElement('resumeStreamBtn')?.classList.remove('show');
      getElement('resumeStreamBtn')?.setAttribute('aria-hidden', 'true');
      lockToStreamingOutput(active, { margin: 72 });
      setTimeout(() => { lockToStreamingOutput(active, { margin: 72 }); updateResumeStreamButton(); }, 80);
    }

    function revealNodeAboveComposer(node, margin = 18) {
      if (!node?.isConnected) return false;
      raf(() => {
        const composerRect = documentRef.querySelector('.composer')?.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();
        const target = (composerRect?.top || windowRef.innerHeight) - margin;
        if (nodeRect.bottom > target) windowRef.scrollBy({ top: nodeRect.bottom - target, behavior: 'auto' });
      });
      return true;
    }

    const coordinator = {
      beginSessionBottomPin: scheduleSessionTailFocusAfterLayout,
      notifyLayoutChange,
      registerLayoutPromise,
      withProgrammaticScroll,
      isPinned: () => !!layoutPinSession && !layoutPinSession.released,
      pendingCount: () => (layoutPinSession?.pending || 0) + layoutPendingCount(messagesEl()),
    };
    try { root.ChatUIScrollCoordinator = coordinator; } catch {}
    try { windowRef.ChatUIScrollCoordinator = coordinator; } catch {}

    return Object.freeze({
      cancelScrollTimer,
      messagesBottomGap,
      jumpToMessagesBottom,
      isNearMessagesBottom,
      setMessagesProgrammaticScroll,
      withProgrammaticScroll,
      getSessionTailAnchor,
      ensureTailScrollSpace,
      focusSessionTail,
      scheduleSessionTailFocus,
      cancelSessionTailFocusAfterLayout,
      scheduleSessionTailFocusAfterLayout,
      beginSessionBottomPin: scheduleSessionTailFocusAfterLayout,
      notifyLayoutChange,
      registerLayoutPromise,
      updateAutoScrollLock,
      shouldFollowScroll,
      restoreStreamingFollowIfNearBottom,
      preserveMessageViewport,
      preserveMessageBottomAnchor,
      markManualMessageScroll,
      getComposerSafeBottom,
      scrollToBottom,
      settleScrollToBottom,
      activeOutputBottomTarget,
      lockToStreamingOutput,
      settleActiveOutput,
      armStreamingOutputFocus,
      pinNodeBottomToTarget,
      scrollToActiveOutput,
      isNodeAwayFromOutputFocus,
      setActiveOutputForSession,
      getActiveOutputForSession,
      updateResumeStreamButton,
      resumeActiveOutputFocus,
      revealNodeAboveComposer,
    });
  }

  const api = Object.freeze({ createScrollFocusWorkflow });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatUIAppScrollFocusWorkflow = api;
  if (root?.window) root.window.ChatUIAppScrollFocusWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

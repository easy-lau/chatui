(function initChatUIAppScrollFocusWorkflow(root) {
  // Intentionally not strict: scroll/focus bodies are migrated from app.js and resolved through a deps scope.

  function createScrollFocusWorkflow(deps = {}) {
    if (!deps.state) throw new Error('state is required');

    const BOTTOM_THRESHOLD = 24;
    let bottomLockRaf = 0;
    let resumeButtonRaf = 0;
    let bottomLockObserver = null;
    let bottomLockMutationObserver = null;
    let bottomLockObserved = new WeakSet();
    let sessionTailFocusCleanup = null;
    let activeOutputCleanup = null;
    let manualScrollIntentUntil = 0;
    let manualAutoFollowSuppressUntil = 0;
    let lockedBottomSyncing = false;
    let lastLockedScrollHeight = 0;
    let lastLockedClientHeight = 0;

    const getWindow = () => deps.window || root?.window || root;
    const now = () => Date.now();
    const raf = (fn) => {
      const win = getWindow();
      const request = win?.requestAnimationFrame || root?.requestAnimationFrame;
      return request ? request.call(win || root, fn) : (fn(), 0);
    };
    const caf = (id) => {
      if (!id) return;
      const win = getWindow();
      const cancel = win?.cancelAnimationFrame || root?.cancelAnimationFrame;
      try { cancel?.call(win || root, id); } catch {}
    };

    function cancelScrollTimer() {
      cancelBottomScrollFrame();
    }

    function messagesBottomGap() {
      with (deps) {
        const el = $("messages");
        return distanceToBottom(el);
      }
    }

    function distanceToBottom(el) {
      if (!el) return 0;
      return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
    }

    function isNearMessagesBottom(threshold = 180) {
      return messagesBottomGap() <= threshold;
    }

    function setMessagesProgrammaticScroll(duration = 260) {
      with (deps) {
        state.programmaticScrollUntil = now() + duration;
      }
    }

    function bottomThreshold(options = {}) {
      return Number.isFinite(options.bottomThreshold) ? Math.max(0, options.bottomThreshold) : BOTTOM_THRESHOLD;
    }

    function isBottomLocked(options = {}) {
      with (deps) {
        if (!options.ignoreManualSuppress && now() < manualAutoFollowSuppressUntil) return false;
        return state.bottomScrollLocked !== false && !state.userScrollLocked;
      }
    }

    function queueResumeButtonUpdate() {
      if (resumeButtonRaf) return;
      resumeButtonRaf = raf(() => {
        resumeButtonRaf = 0;
        updateResumeStreamButton();
      });
    }

    function cancelBottomScrollFrame() {
      caf(bottomLockRaf);
      bottomLockRaf = 0;
    }

    function scrollMessagesToBottom(el, options = {}) {
      with (deps) {
        if (!el) return false;
        const target = Math.max(0, el.scrollHeight - el.clientHeight);
        const diff = Math.abs((el.scrollTop || 0) - target);
        if (diff > (Number.isFinite(options.writeThreshold) ? options.writeThreshold : 0.5)) {
          setMessagesProgrammaticScroll(options.programmaticMs || 320);
          el.scrollTop = target;
        }
        lastLockedScrollHeight = el.scrollHeight;
        lastLockedClientHeight = el.clientHeight;
        state.lastMessageScrollTop = el.scrollTop;
        queueResumeButtonUpdate();
        return distanceToBottom(el) <= bottomThreshold(options);
      }
    }

    function syncLockedBottomBeforePaint(reason = "layout") {
      with (deps) {
        const el = $("messages");
        if (!el || !isBottomLocked() || lockedBottomSyncing) return false;
        lockedBottomSyncing = true;
        try {
          const heightChanged = el.scrollHeight !== lastLockedScrollHeight || el.clientHeight !== lastLockedClientHeight;
          const gap = distanceToBottom(el);
          if (heightChanged || gap > 0) scrollMessagesToBottom(el, { reason, programmaticMs: 260, writeThreshold: 0 });
          return true;
        } finally {
          lockedBottomSyncing = false;
        }
      }
    }

    function requestBottomScroll(options = {}) {
      with (deps) {
        const el = $("messages");
        if (!el) return;
        const force = options.force === true;
        if (!force && !isBottomLocked()) return;
        if (options.beforePaint === true && (force || isBottomLocked({ ignoreManualSuppress: options.ignoreManualSuppress === true }))) {
          syncLockedBottomBeforePaint(options.reason || "before-paint");
        }
        if (bottomLockRaf) return;
        bottomLockRaf = raf(() => {
          bottomLockRaf = 0;
          const current = $("messages");
          if (!current) return;
          if (force || isBottomLocked({ ignoreManualSuppress: options.ignoreManualSuppress === true })) scrollMessagesToBottom(current, options);
        });
      }
    }

    function refreshBottomLockObservers() {
      with (deps) {
        const el = $("messages");
        if (!el) return;
        if (!("ResizeObserver" in window)) return;
        if (!bottomLockObserver) {
          bottomLockObserver = new ResizeObserver(() => {
            if (isBottomLocked()) requestBottomScroll({ reason: "resize-observer", beforePaint: true });
          });
        }
        const targets = [
          el,
          ...el.querySelectorAll(".message,.bubble-wrap,.bubble,.content,.reasoning-panel,.markdown-body,img,video,iframe,table,pre,.code-block,.mermaid,.mermaid-block,.markdown-mermaid-pending,svg,canvas")
        ];
        for (const target of targets) {
          try {
            if (!bottomLockObserved.has(target)) {
              bottomLockObserved.add(target);
              bottomLockObserver.observe(target);
            }
          } catch {}
        }
      }
    }

    function ensureBottomScrollLockObservers() {
      with (deps) {
        const el = $("messages");
        if (!el) return;
        refreshBottomLockObservers();
        if (!bottomLockMutationObserver && "MutationObserver" in window) {
          bottomLockMutationObserver = new MutationObserver(() => {
            refreshBottomLockObservers();
            if (isBottomLocked()) requestBottomScroll({ reason: "mutation-observer", beforePaint: true });
          });
          bottomLockMutationObserver.observe(el, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "style", "src", "data-persisted-src", "width", "height", "viewBox", "data-mermaid-rendered", "data-state"]
          });
        }
      }
    }

    function cleanupBottomScrollLock() {
      cancelBottomScrollFrame();
      try { bottomLockObserver?.disconnect?.(); } catch {}
      try { bottomLockMutationObserver?.disconnect?.(); } catch {}
      bottomLockObserver = null;
      bottomLockMutationObserver = null;
      bottomLockObserved = new WeakSet();
    }

    function activateBottomScrollLock(options = {}) {
      with (deps) {
        const el = $("messages");
        if (!el) return false;
        state.bottomScrollLocked = true;
        state.bottomLockSessionId = options.conversationId || state.activeSessionId || "";
        state.userScrollLocked = false;
        state.streamFocusLocked = false;
        state.autoScrollLocked = true;
        state.isAutoFollowing = true;
        state.userScrolledAway = false;
        ensureBottomScrollLockObservers();
        scrollMessagesToBottom(el, options);
        requestBottomScroll({ ...options, force: true, beforePaint: true, ignoreManualSuppress: true });
        raf(() => requestBottomScroll({ ...options, force: true, beforePaint: true, ignoreManualSuppress: true, reason: options.reason || "layout" }));
        return true;
      }
    }

    function releaseBottomScrollLock(options = {}) {
      with (deps) {
        state.bottomScrollLocked = false;
        state.userScrollLocked = true;
        state.streamFocusLocked = false;
        state.autoScrollLocked = false;
        state.isAutoFollowing = false;
        state.userScrolledAway = true;
        state.lastUserScrollAt = now();
        state.outputPinSuppressUntil = now() + (Number.isFinite(options.suppressMs) ? options.suppressMs : 1500);
        state.scrollVersion += options.bumpVersion === false ? 0 : 1;
        cancelBottomScrollFrame();
        const el = $("messages");
        lastLockedScrollHeight = el?.scrollHeight || 0;
        lastLockedClientHeight = el?.clientHeight || 0;
      }
    }

    function updateBottomLockFromScrollEvent(event, options = {}) {
      with (deps) {
        const el = $("messages");
        if (!el) return;
        const gap = distanceToBottom(el);
        const threshold = bottomThreshold(options);
        const programmatic = now() < state.programmaticScrollUntil;
        const manualIntent = now() < manualScrollIntentUntil;
        if (manualIntent && event?.type === "scroll" && gap > threshold) {
          releaseBottomScrollLock({ bumpVersion: true });
        } else if (gap <= threshold) {
          state.bottomScrollLocked = true;
          state.userScrollLocked = false;
          state.autoScrollLocked = true;
          state.isAutoFollowing = true;
          state.userScrolledAway = false;
        } else if (!programmatic && manualIntent && event?.type === "scroll") {
          releaseBottomScrollLock({ bumpVersion: true });
        } else if (isBottomLocked()) {
          requestBottomScroll({ reason: "locked-scroll-compensation" });
        }
        state.lastMessageScrollTop = el.scrollTop;
        queueResumeButtonUpdate();
      }
    }

    function getSessionTailAnchor() {
      with (deps) {
        const el = $("messages");
        if (!el) return null;
        const nodes = [...el.querySelectorAll(".message")].filter(node => node.offsetParent !== null && node.getBoundingClientRect().height > 0);
        return nodes[nodes.length - 1] || null;
      }
    }

    function ensureTailScrollSpace(margin = 18) {
      with (deps) {
        const el = $("messages"), composer = document.querySelector(".composer")?.getBoundingClientRect();
        if (!el || !composer) return;
        const rect = el.getBoundingClientRect();
        const safe = getComposerSafeBottom();
        const required = Math.max(0, rect.bottom - (composer.top - margin));
        const space = Math.max(safe, required);
        el.style.setProperty("--session-tail-scroll-space", `${Math.max(96, Math.min(260, Math.ceil(space)))}px`);
      }
    }

    function focusSessionTail(options = {}) {
      with (deps) {
        const el = $("messages");
        if (!el) return false;
        ensureTailScrollSpace(Number.isFinite(options.margin) ? options.margin : 18);
        return activateBottomScrollLock(options);
      }
    }

    function scheduleSessionTailFocus(options = {}) {
      with (deps) {
        const version = ++state.scrollVersion;
        activateBottomScrollLock(options);
        return version;
      }
    }

    function cancelSessionTailFocusAfterLayout() {
      try { sessionTailFocusCleanup?.(); } catch {}
      sessionTailFocusCleanup = null;
      cancelBottomScrollFrame();
    }

    function scheduleSessionTailFocusAfterLayout(options = {}) {
      with (deps) {
        const el = $("messages");
        if (!el) return scheduleSessionTailFocus(options);
        cancelSessionTailFocusAfterLayout();
        const version = ++state.scrollVersion;
        let done = false;
        const finish = () => {
          if (done || state.scrollVersion !== version) return;
          done = true;
          sessionTailFocusCleanup = null;
          if (options.releaseBooting) {
            try { document.body.classList.remove("app-booting"); } catch {}
          }
          try { options.onDone?.(); } catch {}
        };
        sessionTailFocusCleanup = () => {
          done = true;
          cancelBottomScrollFrame();
          sessionTailFocusCleanup = null;
        };
        activateBottomScrollLock({ ...options, conversationId: state.activeSessionId, force: true });
        raf(() => {
          if (state.scrollVersion !== version || done) return;
          requestBottomScroll({ ...options, force: true, reason: options.reason || "layout" });
          raf(finish);
        });
        return version;
      }
    }

    function updateAutoScrollLock() {
      with (deps) {
        state.autoScrollLocked = !!(state.streamFocusLocked || isBottomLocked());
      }
    }

    function shouldFollowScroll() {
      with (deps) {
        return !state.userScrollLocked && (!!state.streamFocusLocked || isBottomLocked());
      }
    }

    function restoreStreamingFollowIfNearBottom(threshold = 180) {
      with (deps) {
        if (!isNearMessagesBottom(threshold)) return false;
        state.bottomScrollLocked = true;
        state.userScrollLocked = false;
        state.autoScrollLocked = true;
        const node = getActiveOutputForSession(state.activeSessionId);
        if (node?.isConnected && node.dataset.streaming === "1") {
          state.streamFocusLocked = true;
          state.activeOutputNode = node;
        }
        updateResumeStreamButton();
        return true;
      }
    }

    function preserveMessageViewport(node) {
      with (deps) {
        const el = $("messages"), top = node?.isConnected ? node.getBoundingClientRect().top : null, scrollTop = el ? el.scrollTop : null;
        return () => {
          if (!node?.isConnected) return;
          if (el && scrollTop !== null) {
            const nextTop = node.getBoundingClientRect().top;
            if (top !== null && Number.isFinite(nextTop)) el.scrollTop += nextTop - top;
            else el.scrollTop = scrollTop;
          } else if (top !== null) {
            const nextTop = node.getBoundingClientRect().top;
            Number.isFinite(nextTop) && window.scrollBy({ top: nextTop - top, behavior: "auto" });
          }
          updateResumeStreamButton();
        };
      }
    }

    function preserveMessageBottomAnchor(node, margin = 72) {
      return () => {
        shouldFollowScroll() && pinNodeBottomToTarget(node, { margin });
        updateResumeStreamButton();
      };
    }

    function markManualMessageScroll(event) {
      with (deps) {
        const el = $("messages");
        if (!el) return;
        if ((event?.currentTarget === window || event?.target === window) && event?.target && !el.contains(event.target) && event.target !== document && event.target !== document.body && event.target !== document.documentElement) return;
        const wheelDelta = Number(event?.deltaY || 0);
        const wheel = event?.type === "wheel" && Math.abs(wheelDelta) > 1;
        const touch = event?.type === "touchstart" || event?.type === "touchmove";
        const pointer = event?.type === "pointerdown" || event?.type === "mousedown";
        if (wheel || touch || pointer) {
          manualScrollIntentUntil = now() + 1400;
          // If the user tries to scroll upward while auto-follow is correcting async
          // Markdown layout, pause bottom compensation immediately. Otherwise the
          // next ResizeObserver/RAF correction can pull the viewport back before
          // the native scroll event has a chance to create a >24px bottom gap.
          if (touch || pointer || wheelDelta < -1) {
            manualAutoFollowSuppressUntil = now() + 900;
            cancelBottomScrollFrame();
          }
        }
        updateBottomLockFromScrollEvent(event, { bottomThreshold: BOTTOM_THRESHOLD });
      }
    }

    function getComposerSafeBottom() {
      with (deps) {
        const raw = getComputedStyle(document.documentElement).getPropertyValue("--composer-safe-bottom");
        const parsed = parseFloat(raw);
        return window.ChatUI?.scroll?.composerSafeBottom ? window.ChatUI.scroll.composerSafeBottom(raw, 168) : Number.isFinite(parsed) ? parsed : 168;
      }
    }

    function scrollToBottom(force = true, options = {}) {
      with (deps) {
        const el = $("messages");
        if (!el) return;
        if (!force && !shouldFollowScroll()) return;
        activateBottomScrollLock({ ...options, force: true });
      }
    }

    function settleScrollToBottom(options = {}) {
      scrollToBottom(true, options);
    }

    function activeOutputBottomTarget(margin = 24) {
      with (deps) {
        const composer = document.querySelector(".composer")?.getBoundingClientRect();
        return window.ChatUI?.scroll?.activeOutputBottomTarget ? window.ChatUI.scroll.activeOutputBottomTarget({ composerTop: composer?.top, viewportHeight: innerHeight, margin }) : Math.max(80, (composer?.top || innerHeight) - margin);
      }
    }

    function lockToStreamingOutput(node, options = {}) {
      with (deps) {
        if (!node?.isConnected) return;
        state.streamFocusLocked = true;
        state.bottomScrollLocked = true;
        state.userScrollLocked = false;
        state.autoScrollLocked = true;
        state.activeOutputNode = node;
        pinNodeBottomToTarget(node, options);
      }
    }

    function cleanupActiveOutputSettler() {
      try { activeOutputCleanup?.(); } catch {}
      activeOutputCleanup = null;
    }

    function settleActiveOutput(node, options = {}) {
      with (deps) {
        if (!node?.isConnected || state.userScrollLocked) return;
        cleanupActiveOutputSettler();
        const maxFrames = Number.isFinite(options.frames) ? Math.max(1, options.frames) : 56;
        let frame = 0;
        let frameId = 0;
        let observer = null;
        const pin = () => {
          if (!node?.isConnected || state.userScrollLocked) return false;
          if (node.dataset.sessionId && node.dataset.sessionId !== state.activeSessionId) return false;
          pinNodeBottomToTarget(node, options);
          return true;
        };
        const tick = () => {
          frameId = 0;
          if (frame++ >= maxFrames || !pin()) return cleanupActiveOutputSettler();
          frameId = raf(tick);
        };
        activeOutputCleanup = () => {
          caf(frameId);
          frameId = 0;
          try { observer?.disconnect?.(); } catch {}
          observer = null;
          activeOutputCleanup = null;
        };
        pin();
        if ("ResizeObserver" in window) {
          try {
            observer = new ResizeObserver(() => pin());
            [node, ...node.querySelectorAll(".content,.reasoning-panel,.markdown-body,img,video,iframe,table,pre,.code-block,.mermaid,.mermaid-block,svg,canvas")].forEach(target => observer.observe(target));
          } catch {}
        }
        frameId = raf(tick);
      }
    }

    function armStreamingOutputFocus(sessionId, node, options = {}) {
      with (deps) {
        if (!sessionId || !node) return;
        const margin = Number.isFinite(options.margin) ? options.margin : 72;
        if (options.clearStaleFocus) {
          state.streamFocusLocked = false;
          state.autoScrollLocked = false;
          state.userScrollLocked = false;
          state.bottomScrollLocked = true;
          state.outputPinSuppressUntil = 0;
          cancelScrollTimer();
        }
        setActiveOutputForSession(sessionId, node);
        if (sessionId === state.activeSessionId && node.isConnected) lockToStreamingOutput(node, { margin });
        else updateResumeStreamButton();
      }
    }

    function pinNodeBottomToTarget(node, options = {}) {
      with (deps) {
        if (!node?.isConnected) return;
        const el = $("messages");
        if (!el) return;
        setMessagesProgrammaticScroll();
        const margin = Number.isFinite(options.margin) ? options.margin : 72;
        const target = activeOutputBottomTarget(margin);
        const messagesRect = el.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();
        const bottom = Math.min(messagesRect.bottom, target);
        const canScroll = el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== "visible";
        if (canScroll) {
          if (nodeRect.bottom > bottom + 1) el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + (nodeRect.bottom - bottom)));
          else if (nodeRect.bottom < messagesRect.top) el.scrollTop = Math.max(0, el.scrollTop - (messagesRect.top - nodeRect.bottom + margin));
          state.lastMessageScrollTop = el.scrollTop;
        } else {
          const delta = nodeRect.bottom - bottom;
          if (Math.abs(delta) > 1) {
            const scrollY = window.scrollY || document.documentElement?.scrollTop || document.body?.scrollTop || 0;
            window.scrollTo({ top: Math.max(0, scrollY + delta), behavior: "auto" });
          }
          state.lastMessageScrollTop = el.scrollTop;
        }
      }
    }

    function scrollToActiveOutput(node, options = {}) {
      with (deps) {
        const el = $("messages");
        if (!el || !node?.isConnected) return;
        if (options.active) state.activeOutputNode = node;
        if (options.force === false) {
          updateResumeStreamButton();
          return;
        }
        if (!state.userScrollLocked) lockToStreamingOutput(node, options);
        updateResumeStreamButton();
      }
    }

    function isNodeAwayFromOutputFocus(node) {
      with (deps) {
        if (!node?.isConnected) return false;
        const nodeRect = node.getBoundingClientRect();
        const messagesRect = $("messages")?.getBoundingClientRect();
        const composer = document.querySelector(".composer")?.getBoundingClientRect();
        return window.ChatUI?.scroll?.isNodeAwayFromOutputFocus ? window.ChatUI.scroll.isNodeAwayFromOutputFocus({ nodeRect, messagesRect, composerTop: composer?.top, viewportHeight: innerHeight, margin: 72 }) : (() => {
          const target = (composer?.top || innerHeight) - 72;
          const top = messagesRect?.top || 0;
          const bottom = messagesRect?.bottom ? Math.min(messagesRect.bottom, target) : target;
          return nodeRect.bottom > bottom + 72 || nodeRect.bottom < top + 80 || nodeRect.top > bottom || nodeRect.bottom < top;
        })();
      }
    }

    function setActiveOutputForSession(sessionId, node) {
      with (deps) {
        if (sessionId && node) node.dataset.sessionId = sessionId;
        if (sessionId) {
          if (node) state.activeOutputSessions.set(sessionId, node);
          else state.activeOutputSessions.delete(sessionId);
        }
        if (sessionId === state.activeSessionId) state.activeOutputNode = node || null;
        updateResumeStreamButton();
      }
    }

    function getActiveOutputForSession(sessionId = deps.state.activeSessionId) {
      with (deps) {
        let node = sessionId === state.activeSessionId ? state.activeOutputNode : state.activeOutputSessions.get(sessionId) || null;
        if (node?.isConnected) return node;
        if (sessionId === state.activeSessionId) {
          const found = [...document.querySelectorAll('.message[data-streaming="1"]')].reverse().find(item => !item.dataset.sessionId || item.dataset.sessionId === sessionId);
          if (found) {
            node = found;
            setActiveOutputForSession(sessionId, found);
          }
        }
        return node || null;
      }
    }

    function updateResumeStreamButton() {
      with (deps) {
        const button = $("resumeStreamBtn"), node = getActiveOutputForSession(state.activeSessionId);
        if (!button) return;
        const composer = document.querySelector(".composer")?.getBoundingClientRect();
        if (composer) button.style.setProperty("--resume-stream-left", `${composer.left + composer.width / 2}px`);
        const run = getActiveRun(state.activeSessionId);
        const belongs = node?.isConnected && node.closest("#messages") && node.dataset.sessionId === state.activeSessionId;
        const streaming = !!(belongs && node.dataset.streaming === "1" && (!node.dataset.streamKind || node.dataset.streamKind === "chat") && (!node.dataset.streamRunToken || !run?.token || node.dataset.streamRunToken === run.token) && state.busySessions.has(state.activeSessionId));
        const suppressed = now() < state.resumeButtonSuppressUntil;
        const away = streaming && isNodeAwayFromOutputFocus(node);
        const show = !!(streaming && !suppressed && (!state.streamFocusLocked || away));
        button.classList.toggle("show", show);
        button.setAttribute("aria-hidden", show ? "false" : "true");
      }
    }

    function resumeActiveOutputFocus() {
      with (deps) {
        const node = getActiveOutputForSession(state.activeSessionId);
        if (!node?.isConnected) return;
        state.resumeButtonSuppressUntil = now() + 500;
        state.outputPinSuppressUntil = 0;
        $("resumeStreamBtn")?.classList.remove("show");
        $("resumeStreamBtn")?.setAttribute("aria-hidden", "true");
        lockToStreamingOutput(node, { margin: 72 });
        raf(() => lockToStreamingOutput(node, { margin: 72 }));
      }
    }

    function revealNodeAboveComposer(node, margin = 18) {
      with (deps) {
        if (!node?.isConnected) return;
        raf(() => {
          const composer = document.querySelector(".composer")?.getBoundingClientRect();
          const rect = node.getBoundingClientRect();
          const target = (composer?.top || innerHeight) - margin;
          if (rect.bottom > target) window.scrollBy({ top: rect.bottom - target, behavior: "auto" });
        });
      }
    }

    return Object.freeze({
      cancelScrollTimer,
      messagesBottomGap,
      isNearMessagesBottom,
      setMessagesProgrammaticScroll,
      getSessionTailAnchor,
      ensureTailScrollSpace,
      focusSessionTail,
      scheduleSessionTailFocus,
      cancelSessionTailFocusAfterLayout,
      scheduleSessionTailFocusAfterLayout,
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
      cleanupBottomScrollLock,
      activateBottomScrollLock,
    });
  }

  const api = Object.freeze({ createScrollFocusWorkflow });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatUIAppScrollFocusWorkflow = api;
  if (root?.window) root.window.ChatUIAppScrollFocusWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

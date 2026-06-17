(function initChatUIAppComposerLayoutWorkflow(root) {
  'use strict';

  function createComposerLayoutWorkflow(deps = {}) {
    const { getElement, window, document, requestAnimationFrame } = deps;
    let resizeFrame = 0;
    let resizeSecondFrame = 0;

    function updateComposerSafeArea(){const e=getElement("composer"),t=getElement("messages");if(!e||!t)return;const s=e.getBoundingClientRect(),n=window.visualViewport?.height||window.innerHeight||document.documentElement.clientHeight||0,a=Math.ceil(Math.max(120,n-s.top+28));document.documentElement.style.setProperty("--composer-safe-bottom",`${a}px`),t.style.scrollPaddingBottom=`${a}px`}

    function autoResize(){const e=getElement("prompt");if(!e)return!1;const t=window.matchMedia("(max-width: 640px)").matches,s=Math.round(window.innerHeight*(t?0.36:0.42)),n=t?42:52,i=e.style.getPropertyValue("--prompt-height");e.style.setProperty("--prompt-height",`${n}px`),e.style.setProperty("height",`${n}px`,"important");const o=e.scrollHeight,a=Math.max(n,Math.min(o,s)),r=e.style.overflowY,l=o>s?"auto":"hidden";e.style.setProperty("--prompt-height",`${a}px`),e.style.setProperty("height",`${a}px`,"important"),e.style.overflowY=l,updateComposerSafeArea();return i!==`${a}px`||r!==l}

    function scheduleAutoResize(){if(resizeFrame)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;autoResize()&&(resizeSecondFrame&&window.cancelAnimationFrame?.(resizeSecondFrame),resizeSecondFrame=requestAnimationFrame(()=>{resizeSecondFrame=0,autoResize()}))})}

    return Object.freeze({ updateComposerSafeArea, autoResize, scheduleAutoResize });
  }

  const api = Object.freeze({ createComposerLayoutWorkflow });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatUIAppComposerLayoutWorkflow = api;
  if (root?.window) root.window.ChatUIAppComposerLayoutWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

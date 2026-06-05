(function initChatUIAppConfigWorkflow(root) {
  'use strict';

  const defaults = Object.freeze({ baseUrl: '', apiKey: '', headerParams: [], chatModel: '', routeModel: '', imageModel: '', imageSize: 'auto', systemPrompt: '', imageStylePrompt: '', directMode: false, models: [], editingIndex: null, editingNode: null, attachments: [] });

  function createConfigWorkflow(deps = {}) {
    const { state, getElement, localStorage, document, window, crypto, setTimeout, normalizeHeaderParamConfigCore, generateShortUuidCore, buildRequestHeadersFromParams, renderModelOptions, updateCustomSelect, enhanceConfigSelects, closeAllCustomSelects, getActiveSession, saveSessionsMeta, toast } = deps;
    const CONFIG_KEY = deps.CONFIG_KEY;

    function readJsonStorage(e,t){try{const s=localStorage.getItem(e);return s?JSON.parse(s):t}catch{return localStorage.removeItem(e),t}}

    function normalizeModelMeta(e,t={}){const s={};return(Array.isArray(e)?e:[]).forEach(e=>{const n=t?.[e]||{};s[e]={id:e,type:String(n.type||"").trim(),unrecognized:!0===n.unrecognized||!String(n.type||"").trim()}}),s}

    function setApiKeyVisible(e){const t=getElement("apiKey"),s=getElement("toggleApiKeyVisibility");t&&s&&(t.type=e?"text":"password",s.classList.toggle("visible",e),s.setAttribute("aria-label",e?"隐藏 API Key":"显示 API Key"),s.setAttribute("aria-pressed",e?"true":"false"))}

    function toggleApiKeyVisibility(){const e=getElement("apiKey");e&&(setApiKeyVisible("password"===e.type),e.focus())}

    function loadConfig(){const e=readJsonStorage(CONFIG_KEY,readJsonStorage("openapi-chat-image-config",{})),t={...defaults,...e};getElement("baseUrl").value=t.baseUrl||"",getElement("apiKey").value=t.apiKey||"",getElement("imageSize").value=t.imageSize||defaults.imageSize,updateCustomSelect(getElement("imageSize")),getElement("systemPrompt").value=t.systemPrompt||"",getElement("imageStylePrompt")&&(getElement("imageStylePrompt").value=t.imageStylePrompt||""),state.models=Array.isArray(t.models)?t.models:[],state.modelMeta=normalizeModelMeta(state.models,t.modelMeta||{});const s=new Set(state.models),n=s.has(t.chatModel)?t.chatModel:"",a=s.has(t.routeModel)?t.routeModel:"",i=s.has(t.imageModel)?t.imageModel:"";renderModelOptions(n,i,a),t.chatModel===n&&t.routeModel===a&&t.imageModel===i||saveConfig(!0)}

    function getConfig(){const e=readJsonStorage(CONFIG_KEY,{}),t=getElement("headerParamsPanel")?.classList.contains("show")?collectHeaderParamRows():normalizeHeaderParamConfig(e.headerParams);return{baseUrl:getElement("baseUrl").value.trim().replace(/\/$/,""),apiKey:getElement("apiKey").value.trim(),headerParams:t,chatModel:getElement("chatModel").value.trim(),routeModel:getElement("routeModel")?.value.trim()||"",imageModel:getElement("imageModel").value.trim(),imageSize:getElement("imageSize").value,systemPrompt:getElement("systemPrompt")?.value.trim()||"",imageStylePrompt:getElement("imageStylePrompt")?.value.trim()||"",directMode:!!e.directMode,models:state.models}}

    function normalizeHeaderParamConfig(e=[]){return window.ChatUIApp?.headerParams?.normalizeHeaderParamConfig?window.ChatUIApp.headerParams.normalizeHeaderParamConfig(e):(Array.isArray(e)?e:[]).map(e=>({name:String(e?.name||"").trim(),mode:["manual","session_short_uuid","message_short_uuid"].includes(e?.mode)?e.mode:"manual",value:String(e?.value||"")})).filter(e=>e.name)}

    function generateShortUuid(){try{if(window.ChatUIApp?.headerParams?.generateShortUuid)return window.ChatUIApp.headerParams.generateShortUuid(e=>{const t=new Uint8Array(e);return crypto.getRandomValues(t),t})}catch{}try{const e=new Uint8Array(8);crypto.getRandomValues(e);return[...e].map(e=>e.toString(16).padStart(2,"0")).join("").slice(0,12)}catch{return`${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`.slice(0,12)}}

    function ensureSessionHeaderValues(e=state.activeSessionId){const t=state.sessions.find(t=>t.id===e)||getActiveSession();return t.headerValues&&"object"==typeof t.headerValues||(t.headerValues={}),t}

    function buildRequestHeaders(e="message",t=state.activeSessionId){const s=normalizeHeaderParamConfig(getConfig().headerParams),n=ensureSessionHeaderValues(t);if(window.ChatUIApp?.headerParams?.buildRequestHeadersFromParams){const e=window.ChatUIApp.headerParams.buildRequestHeadersFromParams({params:s,sessionValues:n.headerValues,messageUuid:generateShortUuid,sessionUuid:generateShortUuid});return e.changed&&saveSessionsMeta(),e.headers}const a={};let i=!1;for(const o of s){let s="";"manual"===o.mode?s=o.value:"session_short_uuid"===o.mode?(n.headerValues[o.name]||(n.headerValues[o.name]=generateShortUuid(),i=!0),s=n.headerValues[o.name]):"message_short_uuid"===o.mode&&(s=generateShortUuid()),o.name&&s&&(a[o.name]=s)}return i&&saveSessionsMeta(),a}

    function renderHeaderParamRows(){const e=getElement("headerParamList");if(!e)return;e.innerHTML="";const t=normalizeHeaderParamConfig(getConfig().headerParams);t.length||t.push({name:"",mode:"manual",value:""});t.forEach(t=>addHeaderParamRow(t))}

    function addHeaderParamRow(e={}){const t=getElement("headerParamList"),s=getElement("headerParamRowTemplate");if(!t||!s)return;const n=s.content.firstElementChild.cloneNode(!0),a=n.querySelector(".header-param-name"),i=n.querySelector(".header-param-mode"),o=n.querySelector(".header-param-value");a.value=e.name||"",i.value=e.mode||"manual",o.value=e.value||"";const r=()=>{const e=i.value,t="manual"===e;o.readOnly=!t,o.classList.toggle("disabled",!t),o.placeholder=t?"Header 值":"自动生成";t?(o.value&&["会话UUID","消息UUID"].includes(o.value)&&(o.value="")):o.value="session_short_uuid"===e?"会话UUID":"消息UUID"};i.addEventListener("change",r),n.querySelector(".header-param-remove")?.addEventListener("click",()=>n.remove()),r(),t.appendChild(n),enhanceConfigSelects([i])}

    function collectHeaderParamRows(){return[...getElement("headerParamList")?.querySelectorAll(".header-param-row")||[]].map(e=>({name:e.querySelector(".header-param-name")?.value.trim()||"",mode:e.querySelector(".header-param-mode")?.value||"manual",value:e.querySelector(".header-param-value")?.value||""})).filter(e=>e.name)}

    function positionHeaderParamsPanel(){const e=getElement("headerParamsPanel"),t=getElement("configModal")?.querySelector(".config-dialog");if(!e||!t||!e.classList.contains("show"))return;if(window.matchMedia("(max-width: 840px)").matches){const t=getElement("configModal")?.querySelector(".config-dialog");t&&["position","left","right","top","bottom","margin","width","max-width","max-height","height","border-radius"].forEach(e=>t.style.removeProperty(e));return e.style.cssText="";}const s=window.visualViewport?.width||window.innerWidth,n=window.visualViewport?.height||window.innerHeight,a=24,i=12,o=s-2*a;let r=o>=1200?Math.min(900,Math.round(.66*(o-i))):Math.max(520,Math.round(.64*(o-i))),l=Math.max(320,Math.min(430,o-i-r));if(r+l+i>o){l=Math.max(320,Math.min(390,Math.round((o-i)*.34))),r=o-i-l}const d=r+l+i,c=Math.max(a,Math.round((s-d)/2)),m=Math.max(360,Math.min(n-88,window.innerHeight-88));t.style.setProperty("position","absolute","important"),t.style.setProperty("left",`${c}px`,"important"),t.style.setProperty("right","auto","important"),t.style.setProperty("top","36px","important"),t.style.setProperty("bottom","auto","important"),t.style.setProperty("margin","0","important"),t.style.setProperty("width",`${r}px`,"important"),t.style.setProperty("max-width",`${r}px`,"important"),t.style.setProperty("max-height",`${m}px`,"important"),t.style.setProperty("height","auto","important"),t.style.setProperty("border-radius","18px","important");const h=t.getBoundingClientRect(),g=Math.max(36,Math.round((n-h.height)/2));t.style.setProperty("top",`${g}px`,"important");const y=t.getBoundingClientRect();e.style.setProperty("position","absolute","important"),e.style.setProperty("left",`${y.right+i}px`,"important"),e.style.setProperty("top",`${y.top}px`,"important"),e.style.setProperty("width",`${l}px`,"important"),e.style.setProperty("max-width",`${l}px`,"important"),e.style.setProperty("height",`${y.height}px`,"important"),e.style.setProperty("max-height",`${y.height}px`,"important")}

    function openHeaderParamsModal(){renderHeaderParamRows();const e=getElement("headerParamsPanel"),t=getElement("headerParamsBtn");e&&(e.classList.add("show"),e.setAttribute("aria-hidden","false"),t&&(t.disabled=!0,t.classList.add("is-disabled"),t.setAttribute("aria-disabled","true")),positionHeaderParamsPanel(),setTimeout(()=>getElement("headerParamList")?.querySelector("input")?.focus(),0))}

    function closeHeaderParamsModal(){closeAllCustomSelects();const e=getElement("headerParamsPanel"),t=getElement("configModal")?.querySelector(".config-dialog"),s=getElement("headerParamsBtn");e&&(e.classList.remove("show"),e.setAttribute("aria-hidden","true"),e.style.cssText=""),s&&(s.disabled=!1,s.classList.remove("is-disabled"),s.removeAttribute("aria-disabled")),t&&(t.style.left="",t.style.right="",t.style.top="",t.style.width="",t.style.maxHeight="",t.style.borderRadius="")}

    function saveHeaderParams(){const e=collectHeaderParamRows(),t=getConfig();localStorage.setItem(CONFIG_KEY,JSON.stringify({...readJsonStorage(CONFIG_KEY,{}),...t,headerParams:e,models:Array.isArray(state.models)?state.models:[],modelMeta:state.modelMeta||{}})),toast("Header 参数已保存")}

    function cleanupLegacyConfigCache(){localStorage.removeItem("openapi-chat-image-config"),localStorage.removeItem("openapi-chat-image-config-v1")}

    function saveConfig(e=!1){cleanupLegacyConfigCache();const t=getConfig();localStorage.setItem(CONFIG_KEY,JSON.stringify({baseUrl:t.baseUrl,apiKey:t.apiKey,headerParams:normalizeHeaderParamConfig(t.headerParams),chatModel:t.chatModel,routeModel:t.routeModel,imageModel:t.imageModel,imageSize:t.imageSize,systemPrompt:t.systemPrompt,imageStylePrompt:t.imageStylePrompt,directMode:!!t.directMode,models:Array.isArray(state.models)?state.models:[],modelMeta:state.modelMeta||{}})),e||closeConfigModal()}

    function openConfigModal(){closeHeaderParamsModal(),document.body.classList.add("modal-open"),getElement("configModal").classList.add("show"),getElement("configModal").setAttribute("aria-hidden","false"),setTimeout(()=>getElement("baseUrl")?.focus(),0)}

    function closeConfigModal(){closeHeaderParamsModal(),document.body.classList.remove("modal-open"),getElement("configModal").classList.remove("show"),getElement("configModal").setAttribute("aria-hidden","true")}

    return Object.freeze({ readJsonStorage, normalizeModelMeta, setApiKeyVisible, toggleApiKeyVisibility, loadConfig, getConfig, normalizeHeaderParamConfig, generateShortUuid, ensureSessionHeaderValues, buildRequestHeaders, renderHeaderParamRows, addHeaderParamRow, collectHeaderParamRows, positionHeaderParamsPanel, openHeaderParamsModal, closeHeaderParamsModal, saveHeaderParams, cleanupLegacyConfigCache, saveConfig, openConfigModal, closeConfigModal });
  }

  const api = Object.freeze({ createConfigWorkflow, defaults });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatUIAppConfigWorkflow = api;
  if (root?.window) root.window.ChatUIAppConfigWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

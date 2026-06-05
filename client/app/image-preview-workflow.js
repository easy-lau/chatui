(function initChatUIAppImagePreviewWorkflow(root) {
  'use strict';

  function createImagePreviewWorkflow(deps = {}) {
    const { getElement, getImageBlob, canWriteImageClipboard, imageClipboardUnsupportedMessage, URL } = deps;

    function updateImagePreviewCopyAvailability(){const e=getElement("imagePreviewCopy");if(!e)return;const t=canWriteImageClipboard();e.disabled=!t,e.classList.toggle("is-disabled",!t),e.title=t?"复制图片":imageClipboardUnsupportedMessage(),e.setAttribute("aria-label",e.title)}

    async function resolvePreviewSrc(e){if(!e)return{src:"",owned:!1};if(String(e).startsWith("indexeddb://")){const t=await getImageBlob(String(e).replace("indexeddb://",""));return t?{src:URL.createObjectURL(t),owned:!0}:{src:"",owned:!1}}if(String(e).startsWith("blob:"))return{src:"",owned:!1};return{src:e,owned:!1}}

    async function openImagePreview(e,t="image.png"){const s=await resolvePreviewSrc(e);if(s?.src){const n=getElement("imagePreviewImg"),a=n?.dataset.previewObjectUrl;a?.startsWith("blob:")&&a!==s.src&&URL.revokeObjectURL(a),n.dataset.previewObjectUrl=s.owned?s.src:"",n.dataset.persistedSrc=e||"",n.dataset.filename=t||"image.png",n.src=s.src;const i=getElement("imagePreviewDownload");i&&(i.dataset.persistedHref=e||s.src,i.dataset.filename=t||"image.png",i.hidden=!1);const o=getElement("imagePreviewCopy");o&&(o.dataset.persistedHref=e||s.src,o.dataset.filename=t||"image.png",o.hidden=!1,updateImagePreviewCopyAvailability());getElement("imagePreview").classList.add("show"),getElement("imagePreview").setAttribute("aria-hidden","false")}}

    function closeImagePreview(){const e=getElement("imagePreviewImg"),t=e?.dataset.previewObjectUrl;t?.startsWith("blob:")&&URL.revokeObjectURL(t),e&&(delete e.dataset.previewObjectUrl,delete e.dataset.persistedSrc,delete e.dataset.filename),getElement("imagePreviewCopy")&&(getElement("imagePreviewCopy").hidden=!0),getElement("imagePreview").classList.remove("show"),getElement("imagePreview").setAttribute("aria-hidden","true"),e.src=""}

    return Object.freeze({ updateImagePreviewCopyAvailability, resolvePreviewSrc, openImagePreview, closeImagePreview });
  }

  const api = Object.freeze({ createImagePreviewWorkflow });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatUIAppImagePreviewWorkflow = api;
  if (root?.window) root.window.ChatUIAppImagePreviewWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

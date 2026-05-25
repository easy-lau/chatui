(function () {
  const current = window.ChatUIServices || {};
  const fallback = window.ChatUIServicesFallback || {};
  const models = current.models || fallback.models || {};
  const jobs = current.jobs || fallback.jobs || {};
  const chat = current.chat || fallback.chat || {};
  const route = current.route || fallback.route || {};
  const images = current.images || fallback.images || {};

  window.ChatUIServices = Object.freeze({
    ...current,
    models: Object.freeze(models),
    jobs: Object.freeze(jobs),
    chat: Object.freeze(chat),
    route: Object.freeze(route),
    images: Object.freeze(images),
  });
})();

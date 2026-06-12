(() => {
  const CONFIG_KEY = 'openapi-chat-image-config-v2';
  const DEPARTMENT_PASSWORD_KEY = 'openapi-chat-usage-department-password';

  function currentApiKey({ getElement = id => document.getElementById(id), storage = localStorage } = {}) {
    const inputValue = getElement('apiKey')?.value?.trim();
    if (inputValue) return inputValue;
    try {
      return String(JSON.parse(storage.getItem(CONFIG_KEY) || '{}')?.apiKey || '').trim();
    } catch {
      return '';
    }
  }

  function shouldLoadRanking(apiKey) {
    return Boolean(String(apiKey || '').trim());
  }

  function getDepartmentPassword(storage = localStorage) {
    try { return String(storage.getItem(DEPARTMENT_PASSWORD_KEY) || '').trim(); } catch { return ''; }
  }

  function setDepartmentPassword(password, storage = localStorage) {
    try { storage.setItem(DEPARTMENT_PASSWORD_KEY, String(password || '').trim()); } catch {}
  }

  function clearDepartmentPassword(storage = localStorage) {
    try { storage.removeItem(DEPARTMENT_PASSWORD_KEY); } catch {}
  }

  const api = {
    CONFIG_KEY,
    DEPARTMENT_PASSWORD_KEY,
    currentApiKey,
    shouldLoadRanking,
    getDepartmentPassword,
    setDepartmentPassword,
    clearDepartmentPassword,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ChatUIUsageStatsAuth = api;
})();

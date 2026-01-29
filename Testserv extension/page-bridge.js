// Content script: runs on all pages where the extension is allowed.
// Injects extension ID and bridges postMessage from the page to chrome.runtime
// so the React app (or any page) can talk to the extension without chrome.runtime.

(function () {
  const extensionId = chrome.runtime.id;

  // Expose extension ID to the page (same as extension-id-injector for control.html)
  try {
    window.__EXTENSION_ID__ = extensionId;
    if (typeof document !== 'undefined') document.__EXTENSION_ID__ = extensionId;
  } catch (e) {
    console.warn('Testserv page-bridge: could not set __EXTENSION_ID__', e);
  }

  // Respond to getExtensionId from the page (e.g. React app iframe detection)
  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'getExtensionId') {
      window.postMessage({ type: 'extensionIdResponse', extensionId }, window.location.origin);
      return;
    }

    // Bridge: page sends extensionRequest -> we call chrome.runtime.sendMessage -> post extensionResponse
    if (data.type === 'extensionRequest' && data.requestId != null && data.action) {
      const requestId = data.requestId;
      const action = data.action;
      const payload = data.data || {};

      chrome.runtime.sendMessage(
        extensionId,
        { action, ...payload },
        function (response) {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            window.postMessage(
              { type: 'extensionResponse', requestId, error: lastError.message },
              window.location.origin
            );
          } else {
            window.postMessage(
              { type: 'extensionResponse', requestId, response: response ?? {} },
              window.location.origin
            );
          }
        }
      );
    }
  });
})();

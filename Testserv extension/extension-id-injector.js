// Content script to inject extension ID into control page
// This runs when the control page loads
// Uses postMessage since inline scripts are blocked by CSP

(function () {
  // Only run on the control page
  if (window.location.pathname.includes('control.html') ||
    window.location.href.includes('control.html')) {

    // Get extension ID from the extension context
    const extensionId = chrome.runtime.id;

    console.log('Extension ID injector running, ID:', extensionId);

    // Listen for messages from the page requesting the extension ID
    window.addEventListener('message', (event) => {
      // Only accept messages from same origin
      if (event.origin !== window.location.origin) return;

      if (event.data && event.data.type === 'getExtensionId') {
        console.log('Received getExtensionId request, sending response');
        // Send extension ID back via postMessage
        window.postMessage({
          type: 'extensionIdResponse',
          extensionId: extensionId
        }, window.location.origin);
      }
    });

    // Proactively send extension ID
    setTimeout(() => {
      window.postMessage({ type: 'extensionIdResponse', extensionId }, window.location.origin);
    }, 100);

    // BRIDGE: Listen for messages from background script and forward to web page
    // This allows the control page (localhost) to receive events in realtime
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Bridge received message from background:', message);
      window.postMessage({
        type: 'extensionMessage',
        message: message
      }, window.location.origin);
      return false; // Sync response
    });

    console.log('Extension ID injector + Message Bridge setup complete');
  }
})();

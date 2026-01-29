// Control Page JavaScript - Communicates with extension

let currentUuid = null;
let currentScript = null;
let isRecording = false;
let isPlaying = false;
let extensionId = null;

// DOM Elements
const extensionStatusDiv = document.getElementById('extensionStatus');
const urlInput = document.getElementById('url');
const uuidInput = document.getElementById('uuid');
const statusDiv = document.getElementById('status');
const errorDiv = document.getElementById('error');
const btnRecord = document.getElementById('btnRecord');
const btnStop = document.getElementById('btnStop');
const btnPlay = document.getElementById('btnPlay');
const btnRerun = document.getElementById('btnRerun');
const btnClear = document.getElementById('btnClear');
const scriptContainer = document.getElementById('scriptContainer');
const debugConsole = document.getElementById('debugConsole');

// Debug logging function
function debugLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const icon = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
  const logMessage = `[${timestamp}] ${icon} ${message}\n`;

  if (debugConsole) {
    debugConsole.textContent += logMessage;
    debugConsole.scrollTop = debugConsole.scrollHeight;
  }

  // Also log to browser console
  if (type === 'error') {
    console.error(message);
  } else if (type === 'warning') {
    console.warn(message);
  } else {
    console.log(message);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Generate default UUID if empty
  if (!uuidInput.value) {
    uuidInput.value = 'test-' + Date.now();
  }

  // Check if extension is available
  checkExtension().then(connected => {
    if (connected) {
      console.log('Extension connected successfully');
    }
  });

  // Load existing script if UUID is set
  loadScript();

  // Event listeners
  btnRecord.addEventListener('click', handleStartRecording);
  btnStop.addEventListener('click', handleStopRecording);
  btnPlay.addEventListener('click', handleStartPlayback);
  btnRerun.addEventListener('click', handleRerunPlayback);
  btnClear.addEventListener('click', handleClearScript);

  // Listen for messages from extension (bridged via content script)
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data && event.data.type === 'extensionMessage') {
      const message = event.data.message;
      debugLog(`Realtime message received: ${message.type || 'unknown'}`, 'info');

      if (message.type === 'recordingStopped') {
        if (message.uuid === currentUuid) {
          if (message.script) {
            currentScript = message.script;
            displayScript(currentScript);
          }
          handleRecordingStopped();
        }
      } else if (message.type === 'playbackStopped') {
        if (message.uuid === currentUuid) {
          handlePlaybackStopped();
        }
      }
    }
  });

  // Poll for status updates (increased frequency for better responsiveness)
  setInterval(checkStatus, 1000); // Changed from 5000ms back to 1000ms
});

async function checkExtension() {
  debugLog('Checking extension availability...', 'info');
  debugLog(`Chrome API available: ${typeof chrome !== 'undefined'}`, 'info');
  debugLog(`Chrome runtime available: ${typeof chrome !== 'undefined' && chrome.runtime}`, 'info');

  if (typeof chrome === 'undefined' || !chrome.runtime) {
    const error = 'Chrome extension API not available. Please open this page in Chrome.';
    debugLog(error, 'error');
    extensionStatusDiv.textContent = '⚠️ ' + error;
    extensionStatusDiv.className = 'extension-status';
    return false;
  }

  // If we're in extension context, chrome.runtime.id works
  if (chrome.runtime.id) {
    extensionId = chrome.runtime.id;
    debugLog(`Extension ID found: ${extensionId}`, 'success');
    extensionStatusDiv.textContent = '✅ Extension connected';
    extensionStatusDiv.className = 'extension-status connected';
    return true;
  }

  // Check if extension ID was injected by content script
  if (window.__EXTENSION_ID__) {
    extensionId = window.__EXTENSION_ID__;
    debugLog(`Extension ID found immediately: ${extensionId}`, 'success');

    // Test the connection
    try {
      debugLog('Testing connection with extension ID...', 'info');
      const testResponse = await sendMessage('getRecordingStatus', { uuid: 'test' });
      debugLog(`Extension responded: ${JSON.stringify(testResponse)}`, 'success');
      extensionStatusDiv.textContent = '✅ Extension connected';
      extensionStatusDiv.className = 'extension-status connected';
      return true;
    } catch (error) {
      debugLog(`Connection test failed: ${error.message}`, 'error');
      extensionStatusDiv.textContent = `⚠️ Extension ID found but connection failed: ${error.message}`;
      extensionStatusDiv.className = 'extension-status';
      return false;
    }
  }

  // Also check document
  if (document.__EXTENSION_ID__) {
    extensionId = document.__EXTENSION_ID__;
    debugLog(`Extension ID found on document: ${extensionId}`, 'success');

    try {
      debugLog('Testing connection with extension ID...', 'info');
      const testResponse = await sendMessage('getRecordingStatus', { uuid: 'test' });
      debugLog(`Extension responded: ${JSON.stringify(testResponse)}`, 'success');
      extensionStatusDiv.textContent = '✅ Extension connected';
      extensionStatusDiv.className = 'extension-status connected';
      return true;
    } catch (error) {
      debugLog(`Connection test failed: ${error.message}`, 'error');
      extensionStatusDiv.textContent = `⚠️ Extension ID found but connection failed: ${error.message}`;
      extensionStatusDiv.className = 'extension-status';
      return false;
    }
  }

  // Request extension ID via postMessage
  window.postMessage({ type: 'getExtensionId' }, window.location.origin);

  // Wait for content script to inject the ID
  debugLog('Waiting for extension ID injection...', 'info');
  return new Promise((resolve) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      debugLog('Timeout waiting for extension ID', 'error');
      debugLog(`window.__EXTENSION_ID__ = ${window.__EXTENSION_ID__}`, 'error');
      debugLog(`document.__EXTENSION_ID__ = ${document.__EXTENSION_ID__}`, 'error');
      extensionStatusDiv.textContent = '⚠️ Extension not detected. Make sure extension is installed and reload this page.';
      extensionStatusDiv.className = 'extension-status';
      resolve(false);
    }, 3000);

    // Listen for postMessage response
    const messageHandler = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data && event.data.type === 'extensionIdResponse' && event.data.extensionId) {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        clearInterval(checkInterval);
        window.removeEventListener('message', messageHandler);
        window.removeEventListener('extensionIdReady', eventHandler);
        extensionId = event.data.extensionId;
        debugLog(`Extension ID received via postMessage: ${extensionId}`, 'success');

        // Test the connection
        sendMessage('getRecordingStatus', { uuid: 'test' })
          .then((testResponse) => {
            debugLog(`Extension responded: ${JSON.stringify(testResponse)}`, 'success');
            extensionStatusDiv.textContent = '✅ Extension connected';
            extensionStatusDiv.className = 'extension-status connected';
            resolve(true);
          })
          .catch((error) => {
            debugLog(`Connection test failed: ${error.message}`, 'error');
            extensionStatusDiv.textContent = `⚠️ Extension ID found but connection failed: ${error.message}`;
            extensionStatusDiv.className = 'extension-status';
            resolve(false);
          });
      }
    };

    window.addEventListener('message', messageHandler);

    // Listen for extension ID ready event
    const eventHandler = (event) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(checkInterval);
      window.removeEventListener('message', messageHandler);
      window.removeEventListener('extensionIdReady', eventHandler);
      extensionId = event.detail || window.__EXTENSION_ID__ || document.__EXTENSION_ID__;
      debugLog(`Extension ID received from event: ${extensionId}`, 'success');

      // Test the connection
      sendMessage('getRecordingStatus', { uuid: 'test' })
        .then((testResponse) => {
          debugLog(`Extension responded: ${JSON.stringify(testResponse)}`, 'success');
          extensionStatusDiv.textContent = '✅ Extension connected';
          extensionStatusDiv.className = 'extension-status connected';
          resolve(true);
        })
        .catch((error) => {
          debugLog(`Connection test failed: ${error.message}`, 'error');
          extensionStatusDiv.textContent = `⚠️ Extension ID found but connection failed: ${error.message}`;
          extensionStatusDiv.className = 'extension-status';
          resolve(false);
        });
    };

    window.addEventListener('extensionIdReady', eventHandler);
    document.addEventListener('extensionIdReady', eventHandler);

    // Also check periodically if ID was set (more frequent checks)
    const checkInterval = setInterval(() => {
      const foundId = window.__EXTENSION_ID__ || document.__EXTENSION_ID__;
      if (foundId && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        clearInterval(checkInterval);
        window.removeEventListener('message', messageHandler);
        window.removeEventListener('extensionIdReady', eventHandler);
        document.removeEventListener('extensionIdReady', eventHandler);
        extensionId = foundId;
        debugLog(`Extension ID found via polling: ${extensionId}`, 'success');

        sendMessage('getRecordingStatus', { uuid: 'test' })
          .then((testResponse) => {
            debugLog(`Extension responded: ${JSON.stringify(testResponse)}`, 'success');
            extensionStatusDiv.textContent = '✅ Extension connected';
            extensionStatusDiv.className = 'extension-status connected';
            resolve(true);
          })
          .catch((error) => {
            debugLog(`Connection test failed: ${error.message}`, 'error');
            extensionStatusDiv.textContent = `⚠️ Extension ID found but connection failed: ${error.message}`;
            extensionStatusDiv.className = 'extension-status';
            resolve(false);
          });
      }
    }, 50); // Check every 50ms
  });
}

async function checkStatus() {
  const uuidInputVal = uuidInput.value.trim();
  if (!uuidInputVal || !extensionId) return;

  try {
    // Get global status from extension (the ultimate source of truth)
    const globalStatus = await sendMessage('getGlobalStatus', {});
    if (!globalStatus.success) return;

    const extIsRecording = globalStatus.isRecording;
    const extIsPlaying = globalStatus.isPlaying;
    const extRecordingUuid = globalStatus.recordingUuid;
    const extPlaybackUuid = globalStatus.playbackUuid;

    // Update local recording state
    if (extIsRecording) {
      if (!isRecording) {
        debugLog(`Recording detected: ${extRecordingUuid}`, 'info');
        isRecording = true;
        currentUuid = extRecordingUuid;
        updateStatus('recording', 'Recording...');
      }
      btnRecord.disabled = true;
      btnStop.disabled = false;
      btnPlay.disabled = true;
      btnRerun.disabled = true;
    } else {
      if (isRecording) {
        debugLog('Recording stopped detected via polling', 'info');
        isRecording = false;
        handleRecordingStopped();
      }
    }

    // Update local playback state
    if (extIsPlaying) {
      if (!isPlaying) {
        debugLog(`Playback detected: ${extPlaybackUuid}`, 'info');
        isPlaying = true;
        currentUuid = extPlaybackUuid;
        // If the UUIDs match, show playing status
        if (extPlaybackUuid === uuidInputVal) {
          updateStatus('playing', 'Playing...');
        } else {
          updateStatus('idle', `Playback In Progress (UUID: ${extPlaybackUuid})`);
        }
      }
      btnPlay.disabled = true;
      btnRerun.disabled = true;
      btnRecord.disabled = true;
    } else {
      if (isPlaying) {
        debugLog('Playback stopped detected via polling', 'info');
        isPlaying = false;
        handlePlaybackStopped();
      }
    }

    // ULTIMATE SAFETY: If extension is idle, ensure EVERYTHING is unlocked
    if (!extIsRecording && !extIsPlaying) {
      if (isRecording || isPlaying) {
        isRecording = false;
        isPlaying = false;
        handlePlaybackStopped(); // Resets both
      }

      // Force enable buttons if we have a script
      if (!isRecording && !isPlaying) {
        btnRecord.disabled = false;
        btnStop.disabled = true;
        if (currentScript || currentUuid === uuidInputVal) {
          btnPlay.disabled = false;
          btnRerun.disabled = false;
        }
      }
    }
  } catch (error) {
    debugLog(`Status check failed: ${error.message}`, 'error');
  }
}

async function handleStartRecording() {
  const url = urlInput.value.trim();
  const uuid = uuidInput.value.trim();

  if (!url) {
    showError('Please enter a URL');
    return;
  }

  if (!uuid) {
    showError('Please enter a UUID');
    return;
  }

  if (isRecording) {
    showError('Recording already in progress');
    return;
  }

  const isConnected = await checkExtension();
  if (!isConnected) {
    showError('Extension not available. Please install the extension and reload this page.');
    return;
  }

  try {
    hideError();
    currentUuid = uuid;
    isRecording = true;

    // Update UI
    updateStatus('recording', 'Recording...');
    btnRecord.disabled = true;
    btnStop.disabled = false;
    btnPlay.disabled = true;
    btnRerun.disabled = true;

    // Send message to extension
    const response = await sendMessage('startRecording', { url, uuid });

    if (response.success) {
      console.log('Recording started:', response);
    } else {
      throw new Error(response.error || 'Failed to start recording');
    }
  } catch (error) {
    showError(error.message);
    isRecording = false;
    updateStatus('idle', 'Idle');
    btnRecord.disabled = false;
    btnStop.disabled = true;
  }
}

async function handleStopRecording() {
  if (!isRecording || !currentUuid) {
    return;
  }

  try {
    hideError();
    debugLog('Stopping recording...', 'info');

    // Send message to extension
    const response = await sendMessage('stopRecording', { uuid: currentUuid });

    debugLog(`Stop recording response: ${JSON.stringify(response)}`, 'info');

    if (response.success) {
      // Get script from response (even if empty)
      const script = response.script;

      if (script) {
        debugLog(`Script received: ${script.actions?.length || 0} actions`, script.actions?.length > 0 ? 'success' : 'warning');
        currentScript = script;
        displayScript(currentScript);

        if (script.actions && script.actions.length > 0) {
          btnPlay.disabled = false;
          btnRerun.disabled = false;
        }
      } else {
        debugLog('No script in response, trying to load from storage...', 'warning');
        // Try to load from storage as fallback
        await loadScript();
      }

      // Update UI
      isRecording = false;
      updateStatus('idle', 'Recording stopped');
      btnRecord.disabled = false;
      btnStop.disabled = true;

      if (!currentScript || !currentScript.actions || currentScript.actions.length === 0) {
        debugLog('No actions recorded. Try interacting with the page next time.', 'warning');
      }
    } else {
      throw new Error(response.error || 'Failed to stop recording');
    }
  } catch (error) {
    debugLog(`Error stopping recording: ${error.message}`, 'error');
    showError(error.message);
  }
}

async function handleStartPlayback() {
  const uuid = uuidInput.value.trim();

  if (!uuid) {
    showError('Please enter a UUID');
    return;
  }

  if (isPlaying) {
    showError('Playback already in progress');
    return;
  }

  if (!currentScript || !currentScript.actions || currentScript.actions.length === 0) {
    showError('No script to play. Please record a script first.');
    return;
  }

  const isConnected = await checkExtension();
  if (!isConnected) {
    showError('Extension not available. Please install the extension and reload this page.');
    return;
  }

  try {
    hideError();
    currentUuid = uuid;
    isPlaying = true;

    // Update UI
    updateStatus('playing', 'Playing...');
    btnPlay.disabled = true;
    btnRerun.disabled = true;
    btnRecord.disabled = true;

    // Send message to extension
    const response = await sendMessage('startPlayback', {
      uuid: currentUuid,
      script: currentScript
    });

    if (response.success) {
      console.log('Playback started:', response);
    } else {
      throw new Error(response.error || 'Failed to start playback');
    }
  } catch (error) {
    showError(error.message);
    isPlaying = false;
    updateStatus('idle', 'Idle');
    btnPlay.disabled = false;
    btnRerun.disabled = false;
    btnRecord.disabled = false;
  }
}

async function handleRerunPlayback() {
  debugLog('🔄 Re-running script fresh...', 'info');

  // If already playing, stop it first
  if (isPlaying) {
    try {
      await sendMessage('stopPlayback', { uuid: currentUuid });
      isPlaying = false;
      // Wait a moment for window to close and state to reset
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
      debugLog(`Error stopping previous playback: ${e.message}`, 'warning');
    }
  }

  // Start fresh playback
  handleStartPlayback();
}

function handleClearScript() {
  currentScript = null;
  scriptContainer.textContent = 'No script recorded yet. Click "Start Recording" to begin.';
  scriptContainer.classList.add('empty');
  btnPlay.disabled = true;
  btnRerun.disabled = true;
}

function handleRecordingStopped() {
  isRecording = false;
  updateStatus('idle', 'Recording stopped');
  btnRecord.disabled = false;
  btnStop.disabled = true;

  // If script was provided in the message, use it
  // Otherwise reload from storage
  loadScript();
}

function handlePlaybackStopped() {
  debugLog('🎭 Playback stopped/completed', 'info');
  isPlaying = false;
  updateStatus('idle', 'Playback completed');

  if (currentScript) {
    btnPlay.disabled = false;
    btnRerun.disabled = false;
  }
  btnRecord.disabled = false;
}

async function loadScript() {
  const uuid = uuidInput.value.trim();
  if (!uuid) return;

  try {
    const isConnected = await checkExtension();
    if (!isConnected) return;

    const response = await sendMessage('getScript', { uuid });
    if (response.success && response.script) {
      currentScript = response.script;
      currentUuid = uuid; // Sync currentUuid here too
      displayScript(currentScript);
      btnPlay.disabled = false;
      btnRerun.disabled = false;
      debugLog(`Script for ${uuid} loaded successfully`, 'success');
    }
  } catch (error) {
    console.error('Failed to load script:', error);
  }
}

function displayScript(script) {
  if (!script || !script.actions || script.actions.length === 0) {
    scriptContainer.textContent = 'No script recorded yet. Click "Start Recording" to begin.';
    scriptContainer.classList.add('empty');
    return;
  }

  scriptContainer.classList.remove('empty');
  scriptContainer.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'action-steps';

  script.actions.forEach((action, i) => {
    const step = document.createElement('div');
    step.className = 'action-step';

    let actionText = '';
    const label = action.displayName || action.selector?.substring(0, 30) + '...';

    switch (action.type) {
      case 'click':
        actionText = `<strong>Click:</strong> ${escapeHtml(label)}`;
        break;
      case 'type':
        actionText = `<strong>Type:</strong> "${escapeHtml(action.value)}" in ${escapeHtml(label)}`;
        break;
      case 'submit':
        actionText = `<strong>Submit:</strong> ${escapeHtml(label)}`;
        break;
      case 'goto':
        actionText = `<strong>Navigate to:</strong> ${escapeHtml(action.url)}`;
        break;
      case 'scroll':
        actionText = `<strong>Scroll</strong> in ${escapeHtml(label)}`;
        break;
      case 'play':
      case 'pause':
      case 'seek':
      case 'watch':
        actionText = `<strong>Video:</strong> ${action.type} at ${action.mediaTime ? action.mediaTime.toFixed(2) + 's' : 'unknown'}`;
        break;
      default:
        actionText = `<strong>${action.type}:</strong> ${escapeHtml(label)}`;
    }

    step.innerHTML = `
      <span class="step-number">${i + 1}</span>
      <div class="step-content">
        <div class="step-title">${actionText}</div>
        <div class="step-selector">${escapeHtml(action.selector)}</div>
      </div>
    `;
    list.appendChild(step);
  });

  scriptContainer.appendChild(list);

  // Add a toggle for raw JSON
  const jsonToggle = document.createElement('details');
  jsonToggle.className = 'json-toggle';
  const summary = document.createElement('summary');
  summary.textContent = 'View Raw Script (JSON)';
  jsonToggle.appendChild(summary);

  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(script, null, 2);
  jsonToggle.appendChild(pre);

  scriptContainer.appendChild(jsonToggle);
}

function updateStatus(type, text) {
  statusDiv.className = `status ${type}`;
  statusDiv.textContent = text;
}

function showError(message) {
  errorDiv.textContent = message;
  errorDiv.classList.add('show');
  setTimeout(() => {
    errorDiv.classList.remove('show');
  }, 5000);
}

function hideError() {
  errorDiv.classList.remove('show');
  errorDiv.textContent = '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function sendMessage(action, data = {}) {
  return new Promise((resolve, reject) => {
    debugLog(`Sending message: ${action}`, 'info');

    if (typeof chrome === 'undefined' || !chrome.runtime) {
      const error = 'Chrome extension API not available. Make sure you open this page in Chrome with the extension installed.';
      debugLog(error, 'error');
      reject(new Error(error));
      return;
    }

    // If we have chrome.runtime.id, we're in extension context - use it directly
    if (chrome.runtime.id) {
      debugLog(`Using extension context (chrome.runtime.id): ${chrome.runtime.id}`, 'info');
      chrome.runtime.sendMessage(
        { action, ...data },
        (response) => {
          if (chrome.runtime.lastError) {
            debugLog(`Extension context error: ${chrome.runtime.lastError.message}`, 'error');
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          debugLog(`Extension context response: ${JSON.stringify(response)}`, 'success');
          resolve(response || {});
        }
      );
    } else {
      // We're in a web page context - MUST have extension ID
      if (!extensionId) {
        const error = 'Extension ID not found. Please reload the page to detect the extension.';
        debugLog(error, 'error');
        reject(new Error(error));
        return;
      }

      debugLog(`Sending to extension ID: ${extensionId}`, 'info');

      // For external web pages, MUST use extension ID as first argument
      chrome.runtime.sendMessage(
        extensionId,
        { action, ...data },
        (response) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            debugLog(`Error: ${errorMsg}`, 'error');
            reject(new Error(errorMsg));
            return;
          }

          debugLog(`Response: ${JSON.stringify(response)}`, 'success');
          resolve(response || {});
        }
      );
    }
  });
}

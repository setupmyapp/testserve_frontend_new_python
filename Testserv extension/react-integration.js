/**
 * React Integration Helper
 * 
 * Use this in your React app to communicate with the extension
 * 
 * Example usage:
 * 
 * import { startRecording, stopRecording, startPlayback } from './react-integration';
 * 
 * // Start recording
 * const result = await startRecording('https://example.com', 'unique-uuid-123');
 * 
 * // Stop recording and get script
 * const { script } = await stopRecording('unique-uuid-123');
 * 
 * // Send script to backend
 * await fetch('/api/save-script', {
 *   method: 'POST',
 *   body: JSON.stringify({ uuid: 'unique-uuid-123', script })
 * });
 * 
 * // Later, start playback
 * await startPlayback('unique-uuid-123', script);
 */

// Check if extension is available
function isExtensionAvailable() {
  return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
}

// Send message to extension
function sendMessage(action, data = {}) {
  return new Promise((resolve, reject) => {
    if (!isExtensionAvailable()) {
      reject(new Error('Extension not available. Make sure the extension is installed and enabled.'));
      return;
    }

    chrome.runtime.sendMessage(
      { action, ...data },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error || 'Unknown error'));
        }
      }
    );
  });
}

/**
 * Start recording user actions
 * @param {string} url - URL to open in new window
 * @param {string} uuid - Unique identifier for this recording
 * @returns {Promise<{windowId, tabId}>}
 */
export async function startRecording(url, uuid) {
  if (!url || !uuid) {
    throw new Error('URL and UUID are required');
  }

  return sendMessage('startRecording', { url, uuid });
}

/**
 * Stop recording and get the recorded script
 * @param {string} uuid - Unique identifier for the recording
 * @returns {Promise<{script}>}
 */
export async function stopRecording(uuid) {
  if (!uuid) {
    throw new Error('UUID is required');
  }

  return sendMessage('stopRecording', { uuid });
}

/**
 * Start playback of recorded actions
 * @param {string} uuid - Unique identifier for the script
 * @param {Object} script - Optional script object (if not provided, will fetch from extension storage)
 * @returns {Promise<{windowId, tabId}>}
 */
export async function startPlayback(uuid, script = null) {
  if (!uuid) {
    throw new Error('UUID is required');
  }

  return sendMessage('startPlayback', { uuid, script });
}

/**
 * Stop playback
 * @param {string} uuid - Unique identifier for the playback
 * @returns {Promise<void>}
 */
export async function stopPlayback(uuid) {
  if (!uuid) {
    throw new Error('UUID is required');
  }

  return sendMessage('stopPlayback', { uuid });
}

/**
 * Get recording status
 * @param {string} uuid - Unique identifier
 * @returns {Promise<{isRecording, windowId}>}
 */
export async function getRecordingStatus(uuid) {
  if (!uuid) {
    throw new Error('UUID is required');
  }

  return sendMessage('getRecordingStatus', { uuid });
}

/**
 * Get playback status
 * @param {string} uuid - Unique identifier
 * @returns {Promise<{isPlaying, windowId}>}
 */
export async function getPlaybackStatus(uuid) {
  if (!uuid) {
    throw new Error('UUID is required');
  }

  return sendMessage('getPlaybackStatus', { uuid });
}

/**
 * Listen for extension events
 * @param {Function} callback - Callback function that receives event data
 * @returns {Function} - Unsubscribe function
 */
export function listenToExtension(callback) {
  if (!isExtensionAvailable()) {
    console.warn('Extension not available');
    return () => {};
  }

  const listener = (message, sender, sendResponse) => {
    if (message.type) {
      callback(message);
    }
  };

  chrome.runtime.onMessage.addListener(listener);

  // Return unsubscribe function
  return () => {
    chrome.runtime.onMessage.removeListener(listener);
  };
}

// Default export
export default {
  startRecording,
  stopRecording,
  startPlayback,
  stopPlayback,
  getRecordingStatus,
  getPlaybackStatus,
  listenToExtension,
  isExtensionAvailable
};

// Background Service Worker - Manages windows and coordinates recording/playback

console.log('Background service worker script loading...');

let activeRecordings = new Map(); // uuid -> {windowId, tabId, script}
let activePlaybacks = new Map(); // uuid -> {windowId, tabId}

// Keep service worker alive
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated - service worker active');
});

// Listen for extension startup to ensure service worker is active
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension startup - service worker active');
});

// Keep service worker alive with periodic activity
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    console.log('Service worker keepalive');
  }
});

// Create a keepalive alarm
try {
  chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
  console.log('Keepalive alarm created');
} catch (e) {
  console.error('Error creating keepalive alarm:', e);
}

// Handle connections (for wakeup and persistent connections)
chrome.runtime.onConnect.addListener((port) => {
  console.log('Connection received:', port.name);

  // Keep service worker alive for any connection
  port.onMessage.addListener((msg) => {
    console.log('Message received on port:', msg);
    // Echo back to keep connection alive
    port.postMessage({ type: 'pong' });
  });

  port.onDisconnect.addListener(() => {
    console.log('Connection closed:', port.name);
  });

  // Send initial message to confirm connection
  try {
    port.postMessage({ type: 'connected' });
  } catch (e) {
    console.error('Error sending connection confirmation:', e);
  }
});

console.log('Background service worker initialized and ready');
console.log('Message listener registered');
console.log('Connection listener registered');

// Test that everything is working
console.log('Service worker is active and ready to receive messages');

// Listen for messages from external web pages (like control.html)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('Background received EXTERNAL message:', message);
  console.log('External sender:', sender);
  console.log('External sender origin:', sender.origin);
  console.log('External sender url:', sender.url);

  // Ensure we respond even if there's an error
  try {
    if (!message || !message.action) {
      console.error('Invalid external message format:', message);
      sendResponse({ success: false, error: 'Invalid message format' });
      return false;
    }

    console.log('Processing external action:', message.action);

    // Handle the message using the same logic and return its result
    return handleMessage(message, sender, sendResponse);
  } catch (error) {
    console.error('Error handling external message:', error);
    sendResponse({ success: false, error: error.message });
    return false;
  }
});

// Listen for messages from extension context (popup, content scripts)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received INTERNAL message:', message);
  console.log('Internal sender:', sender);

  // Ensure we respond even if there's an error
  try {
    if (!message || !message.action) {
      console.error('Invalid internal message format:', message);
      sendResponse({ success: false, error: 'Invalid message format' });
      return false;
    }

    console.log('Processing internal action:', message.action);

    // Handle the message using the same logic and return its result
    return handleMessage(message, sender, sendResponse);
  } catch (error) {
    console.error('Error handling internal message:', error);
    sendResponse({ success: false, error: error.message });
    return false;
  }
});

// Common message handler for both internal and external messages
function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.action) {
      case 'startRecording':
        handleStartRecording(message.url, message.uuid)
          .then(result => sendResponse({ success: true, ...result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response

      case 'stopRecording':
        handleStopRecording(message.uuid)
          .then(result => sendResponse({ success: true, ...result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'startPlayback':
        handleStartPlayback(message.uuid, message.script)
          .then(result => sendResponse({ success: true, ...result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'stopPlayback':
        handleStopPlayback(message.uuid)
          .then(result => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'playbackActionStarted':
        const playbackRec = activePlaybacks.get(message.uuid);
        if (playbackRec) {
          playbackRec.currentActionIndex = message.index;
          console.log(`🎭 Playback action [${message.index}] started on tab [${sender.tab.id}]`);
        }
        sendResponse({ success: true });
        return false;

      case 'playbackCompleted':
        console.log('🎭 Playback completed for UUID:', message.uuid);
        // Notify any external tabs (like control.html)
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {
              type: 'playbackStopped',
              uuid: message.uuid
            }).catch(() => { });
          });
        });
        handleStopPlayback(message.uuid).catch(() => { });
        sendResponse({ success: true });
        return false;

      case 'getGlobalStatus':
        const activeRecording = activeRecordings.size > 0 ? Array.from(activeRecordings.keys())[0] : null;
        const activePlayback = activePlaybacks.size > 0 ? Array.from(activePlaybacks.keys())[0] : null;
        sendResponse({
          success: true,
          recordingUuid: activeRecording,
          playbackUuid: activePlayback,
          isRecording: !!activeRecording,
          isPlaying: !!activePlayback
        });
        return false;

      case 'getRecordingStatus':
        const recording = activeRecordings.get(message.uuid);
        sendResponse({
          success: true,
          isRecording: !!recording,
          windowId: recording?.windowId
        });
        return false;

      case 'getPlaybackStatus':
        const pb = activePlaybacks.get(message.uuid);
        if (pb) {
          // Proactively verify if window still exists
          chrome.windows.get(pb.windowId, (win) => {
            if (chrome.runtime.lastError || !win) {
              console.log(`🧹 Found orphaned playback for UUID ${message.uuid} during status check. Cleaning up...`);
              handleStopPlayback(message.uuid).catch(() => { });
              sendResponse({ success: true, isPlaying: false });
            } else {
              sendResponse({
                success: true,
                isPlaying: true,
                windowId: pb.windowId
              });
            }
          });
        } else {
          sendResponse({
            success: true,
            isPlaying: false
          });
        }
        return true; // Keep channel open for async response

      case 'getScript':
        getScript(message.uuid)
          .then(script => sendResponse({ success: true, script }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;

      case 'contentScriptReady':
        console.log('✅ Content script ready on:', message.url);
        sendResponse({ success: true });
        return false;

      case 'recordedAction':
        console.log('📨 Background received recordedAction message');
        console.log('📨 UUID:', message.uuid);
        console.log('📨 Action:', message.recordedAction);
        // Forward action from content script to storage
        handleRecordedAction(message.uuid, message.recordedAction)
          .then(() => {
            console.log('✅ RecordedAction handled successfully');
            sendResponse({ success: true });
          })
          .catch(error => {
            console.error('❌ Error handling recordedAction:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case 'getScript':
        // Get script from storage
        getScript(message.uuid)
          .then(script => {
            sendResponse({ success: true, script: script });
          })
          .catch(error => {
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case 'togglePause':
        const rec = activeRecordings.get(message.uuid);
        if (rec) {
          rec.isPaused = !rec.isPaused;
          console.log(`⏸️ Recording pause state toggled to: ${rec.isPaused}`);

          // Notify the content script in the active tab
          chrome.tabs.sendMessage(rec.tabId, {
            action: 'pauseStateChanged',
            isPaused: rec.isPaused
          }).catch(() => { });

          sendResponse({ success: true, isPaused: rec.isPaused });
        } else {
          sendResponse({ success: false, error: 'No active recording found' });
        }
        return false;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
        return false;
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
    return false;
  }
}

// Handle window close events (when user closes window manually)
chrome.windows.onRemoved.addListener(async (windowId) => {
  console.log(`🪟 Window ${windowId} was removed. Cleaning up states...`);

  // Clean up recordings
  for (const [uuid, recording] of activeRecordings.entries()) {
    if (recording.windowId === windowId) {
      console.log(`🧹 Recording window closed manually for UUID: ${uuid}`);

      let script = recording.script;
      if (!script) {
        script = { uuid, url: 'unknown', actions: [], startTime: Date.now() };
      }

      // Save script before cleaning up
      await saveScript(uuid, script);
      activeRecordings.delete(uuid);

      // Notify control page(s)
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'recordingStopped',
            uuid: uuid,
            script: script,
            reason: 'window_closed'
          }).catch(() => { });
        });
      });
    }
  }

  // Clean up playbacks
  for (const [uuid, playback] of activePlaybacks.entries()) {
    if (playback.windowId === windowId) {
      console.log(`🧹 Playback window closed manually for UUID: ${uuid}`);

      activePlaybacks.delete(uuid);

      // Notify control page(s)
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'playbackStopped',
            uuid: uuid,
            reason: 'window_closed'
          }).catch(() => { });
        });
      });
    }
  }
});

// Start recording - open new window
async function handleStartRecording(url, uuid) {
  if (activeRecordings.has(uuid)) {
    throw new Error('Recording already in progress for this UUID');
  }

  // Create new browser window
  const window = await chrome.windows.create({
    url: url,
    type: 'normal',
    width: 1280,
    height: 720,
    focused: true
  });

  // Wait for tab to load
  const tabs = await chrome.tabs.query({ windowId: window.id });
  const tabId = tabs[0].id;

  // Wait for tab to be ready
  await waitForTabReady(tabId);

  // Check if we can inject scripts (some URLs like chrome:// cannot be injected)
  try {
    const tab = await chrome.tabs.get(tabId);
    const tabUrl = tab.url || '';

    // Check if URL is injectable (not chrome://, chrome-extension://, etc.)
    if (tabUrl.startsWith('chrome://') || tabUrl.startsWith('chrome-extension://') ||
      tabUrl.startsWith('edge://') || tabUrl.startsWith('about:')) {
      throw new Error(`Cannot inject scripts into ${tabUrl}. Please use a regular website URL.`);
    }

    // Note: Content script is already injected via manifest, so we don't need to inject again
    // This prevents duplicate injection errors
    console.log('📝 Content script should already be loaded via manifest');
  } catch (error) {
    console.error('❌ Error checking/injecting script:', error);
    throw error;
  }

  // Wait a bit more for the script to initialize
  await new Promise(resolve => setTimeout(resolve, 500));

  // Initialize recording in content script with retry logic
  console.log('🎬 Attempting to send initRecording message to tab:', tabId);
  let initResponse = null;
  let retries = 0;
  const maxRetries = 5;

  while (retries < maxRetries && !initResponse) {
    try {
      initResponse = await chrome.tabs.sendMessage(tabId, {
        action: 'initRecording',
        uuid: uuid,
        isPaused: false // Start unpaused by default
      });
      console.log('✅ Init recording response:', initResponse);
      break;
    } catch (error) {
      retries++;
      console.log(`⚠️ Failed to send initRecording (attempt ${retries}/${maxRetries}):`, error.message);
      if (retries < maxRetries) {
        // Wait a bit longer before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      } else {
        console.error('❌ Failed to initialize recording after', maxRetries, 'attempts');
        throw new Error(`Failed to initialize recording: ${error.message}`);
      }
    }
  }

  // Store recording state
  activeRecordings.set(uuid, {
    windowId: window.id,
    tabId: tabId,
    script: {
      uuid: uuid,
      url: url,
      actions: [],
      startTime: Date.now()
    },
    isPaused: false
  });

  // Listen for tab updates to re-initialize recording on navigation
  const tabUpdateListener = async (updatedTabId, changeInfo, updatedTab) => {
    const recording = activeRecordings.get(uuid);
    if (!recording) return;

    // Only handle tabs in our recording window
    if (updatedTab.windowId !== recording.windowId) return;

    // Only handle our current recording tab
    if (updatedTabId !== recording.tabId) return;

    // When navigation completes, re-initialize recording on the new page
    if (changeInfo.status === 'complete' && updatedTab.url) {
      console.log('🔄 Page navigated during recording, re-initializing on:', updatedTab.url);

      // Wait a bit for content script to load
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        // Get current action count to maintain index sequence
        const startIndex = recording?.script?.actions?.length || 0;

        // Re-initialize recording on the new page
        await chrome.tabs.sendMessage(updatedTabId, {
          action: 'initRecording',
          uuid: uuid,
          startIndex: startIndex,
          isPaused: recording.isPaused || false
        });
        console.log(`✅ Recording re-initialized on new page (startIndex: ${startIndex})`);
      } catch (error) {
        console.error('⚠️ Failed to re-initialize recording on new page:', error.message);
        // Don't throw - recording continues, just won't capture actions on this page
      }
    }
  };

  chrome.tabs.onUpdated.addListener(tabUpdateListener);

  // Listen for new tabs created (e.g., when clicking "WATCH NOW" opens video in new tab)
  const tabCreatedListener = async (newTab) => {
    const recording = activeRecordings.get(uuid);
    if (!recording) return;

    // Only handle new tabs in our recording window
    if (newTab.windowId !== recording.windowId) return;

    console.log('🆕 New tab created in recording window:', newTab.id);
    console.log('🆕 Previous tab ID:', recording.tabId);
    console.log('🆕 New tab URL:', newTab.url || newTab.pendingUrl);

    // Wait for the new tab to be ready
    await waitForTabReady(newTab.id);

    // Update recording to track the new tab
    const oldTabId = recording.tabId;
    recording.tabId = newTab.id;

    console.log(`🔄 Switched recording from tab ${oldTabId} to tab ${newTab.id}`);

    // Wait a bit more for content script to load
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      // Get current action count to maintain index sequence
      const startIndex = recording?.script?.actions?.length || 0;

      // Initialize recording on the new tab
      await chrome.tabs.sendMessage(newTab.id, {
        action: 'initRecording',
        uuid: uuid,
        startIndex: startIndex,
        isPaused: recording.isPaused || false
      });
      console.log(`✅ Recording initialized on new tab (startIndex: ${startIndex})`);
    } catch (error) {
      console.error('⚠️ Failed to initialize recording on new tab:', error.message);
      // Retry after a delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        const startIndex = recording?.script?.actions?.length || 0;
        await chrome.tabs.sendMessage(newTab.id, {
          action: 'initRecording',
          uuid: uuid,
          startIndex: startIndex,
          isPaused: recording.isPaused || false
        });
        console.log(`✅ Recording initialized on new tab after retry`);
      } catch (retryError) {
        console.error('❌ Failed to initialize recording on new tab after retry:', retryError.message);
      }
    }
  };

  chrome.tabs.onCreated.addListener(tabCreatedListener);

  // Store both listeners so we can remove them later
  activeRecordings.get(uuid).tabUpdateListener = tabUpdateListener;
  activeRecordings.get(uuid).tabCreatedListener = tabCreatedListener;

  return { windowId: window.id, tabId: tabId };
}

// Stop recording - save script and close window
async function handleStopRecording(uuid) {
  const recording = activeRecordings.get(uuid);
  if (!recording) {
    throw new Error('No active recording found for this UUID');
  }

  console.log('Stopping recording for UUID:', uuid);
  console.log('Recording object:', recording);
  console.log('Recording script (in-memory):', recording.script);
  console.log('Actions count (in-memory):', recording.script?.actions?.length || 0);

  // Get the script from the recording object (it's being updated in real-time)
  let script = recording.script;

  // Ensure script object exists
  if (!script) {
    console.log('No script in recording object, creating new one');
    script = {
      uuid: uuid,
      url: recording.script?.url || 'unknown',
      actions: [],
      startTime: recording.script?.startTime || Date.now()
    };
  }

  // Ensure actions array exists
  if (!script.actions) {
    console.log('No actions array, initializing empty array');
    script.actions = [];
  }

  // Also try to get from storage as backup (in case actions were saved there)
  const storedScript = await getScript(uuid);
  console.log('Stored script from storage:', storedScript);
  console.log('Stored script actions count:', storedScript?.actions?.length || 0);

  if (storedScript && storedScript.actions && storedScript.actions.length > 0) {
    // Use stored script if it has more actions
    if (!script.actions || script.actions.length < storedScript.actions.length) {
      console.log('Using stored script (has more actions)');
      script = storedScript;
    } else {
      console.log('Using in-memory script (has more actions)');
    }
  }

  console.log('Final script to return:', script);
  console.log('Final script actions count:', script.actions?.length || 0);

  // Optimize the script before saving
  if (script && script.actions) {
    console.log('Optimizing script actions...');
    console.log('Before optimization:', script.actions.length, 'actions');
    script.actions = optimizeScript(script.actions);
    console.log('After optimization:', script.actions.length, 'actions');
  }

  // Ensure script is saved to storage before cleanup
  await saveScript(uuid, script);
  console.log('Script saved to storage');

  // Close the window (if it still exists)
  if (recording.windowId) {
    try {
      // Check if window still exists before trying to close
      const windows = await chrome.windows.getAll();
      const windowExists = windows.some(w => w.id === recording.windowId);

      if (windowExists) {
        console.log('Closing window:', recording.windowId);
        await chrome.windows.remove(recording.windowId);
        console.log('Window closed successfully');
      } else {
        console.log('Window already closed (not found in windows list)');
      }
    } catch (error) {
      console.log('Error closing window (may already be closed):', error.message);
      // Window might have been closed manually, that's okay - don't throw error
    }
  }

  // Remove event listeners
  if (recording.tabUpdateListener) {
    chrome.tabs.onUpdated.removeListener(recording.tabUpdateListener);
    console.log('Removed tabUpdateListener');
  }
  if (recording.tabCreatedListener) {
    chrome.tabs.onCreated.removeListener(recording.tabCreatedListener);
    console.log('Removed tabCreatedListener');
  }

  // Clean up AFTER saving script
  activeRecordings.delete(uuid);
  console.log('Recording cleaned up');

  // Always return script object, even if empty
  return { script: script };
}

// Optimize script by removing duplicate typing actions
// DISABLED: This is now a pass-through function to ensure ALL actions are replayed
// exactly as recorded, following Playwright Codegen behavior
function optimizeScript(actions) {
  if (!actions || actions.length === 0) return [];

  const optimized = [];

  for (let i = 0; i < actions.length; i++) {
    const current = actions[i];
    const next = actions[i + 1];

    // Optimization: For 'type' actions, if the next action is a 'type' action 
    // for the SAME selector on the SAME URL, skip the current one (it's intermediate)
    if (current.type === 'type' &&
      next && next.type === 'type' &&
      current.selector === next.selector &&
      current.url === next.url) {
      continue;
    }

    optimized.push(current);
  }

  // Final pass: re-index actions to ensure they are sequential
  const finalActions = optimized.map((action, index) => ({
    ...action,
    index: index
  }));

  console.log(`✅ Script optimized: ${actions.length} -> ${finalActions.length} actions`);
  return finalActions;
}

// Start playback - open new window and execute script
async function handleStartPlayback(uuid, script) {
  if (activePlaybacks.has(uuid)) {
    throw new Error('Playback already in progress for this UUID');
  }

  // Use provided script or fetch from storage
  let playbackScript = script;
  if (!playbackScript) {
    playbackScript = await getScript(uuid);
    if (!playbackScript) {
      throw new Error('Script not found for this UUID');
    }
  }

  // Create new browser window
  const window = await chrome.windows.create({
    url: playbackScript.url,
    type: 'normal',
    width: 1280,
    height: 720,
    focused: true
  });

  // Wait for tab to load
  const tabs = await chrome.tabs.query({ windowId: window.id });
  const tabId = tabs[0].id;

  // Wait for tab to be ready
  await waitForTabReady(tabId);

  // Start playback in content script with retry logic
  console.log('🎭 Attempting to send initPlayback message to tab:', tabId);
  let initResponse = null;
  let retries = 0;
  const maxRetries = 5;

  while (retries < maxRetries && !initResponse) {
    try {
      initResponse = await chrome.tabs.sendMessage(tabId, {
        action: 'initPlayback',
        uuid: uuid,
        script: playbackScript
      });
      console.log('✅ Init playback response:', initResponse);
      break;
    } catch (error) {
      retries++;
      console.log(`⚠️ Failed to send initPlayback (attempt ${retries}/${maxRetries}):`, error.message);
      if (retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      } else {
        console.error('❌ Failed to initialize playback after', maxRetries, 'attempts');
        throw new Error(`Failed to initialize playback: ${error.message}`);
      }
    }
  }

  // Store playback state with script and current action index
  activePlaybacks.set(uuid, {
    windowId: window.id,
    tabId: tabId,
    script: playbackScript,
    currentActionIndex: 0
  });

  // Listen for tab updates to handle navigation during playback
  const tabUpdateListener = async (updatedTabId, changeInfo, updatedTab) => {
    const playback = activePlaybacks.get(uuid);
    if (!playback) return;

    // Only handle tabs in our playback window
    if (updatedTab.windowId !== playback.windowId) return;

    // Only handle our current playback tab
    if (updatedTabId !== playback.tabId) return;

    // When navigation completes during playback, resume playback on new page
    if (changeInfo.status === 'complete' && updatedTab.url) {
      console.log('🔄 Page navigated during playback, resuming on:', updatedTab.url);

      // Wait for content script to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        // Resume playback on the new page
        await chrome.tabs.sendMessage(updatedTabId, {
          action: 'initPlayback',
          uuid: uuid,
          script: playback.script,
          startFromIndex: playback.currentActionIndex + 1 // Start from the NEXT action
        });
        console.log('✅ Playback resumed on new page');
      } catch (error) {
        console.error('⚠️ Failed to resume playback on new page:', error.message);
      }
    }
  };

  chrome.tabs.onUpdated.addListener(tabUpdateListener);

  // Listen for new tabs created (e.g., when clicking "WATCH NOW" opens video in new tab)
  const tabCreatedListener = async (newTab) => {
    const playback = activePlaybacks.get(uuid);
    if (!playback) return;

    // Only handle new tabs in our playback window
    if (newTab.windowId !== playback.windowId) return;

    console.log('🆕 New tab created in playback window:', newTab.id);
    console.log('🆕 Previous tab ID:', playback.tabId);
    console.log('🆕 New tab URL:', newTab.url || newTab.pendingUrl);

    // Wait for the new tab to be ready
    await waitForTabReady(newTab.id);

    // Update playback to track the new tab
    const oldTabId = playback.tabId;
    playback.tabId = newTab.id;

    console.log(`🔄 Switched playback from tab ${oldTabId} to tab ${newTab.id}`);

    // Wait a bit more for content script to load
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      // Resume playback on the new tab
      await chrome.tabs.sendMessage(newTab.id, {
        action: 'initPlayback',
        uuid: uuid,
        script: playback.script,
        startFromIndex: playback.currentActionIndex + 1 // Start from the NEXT action
      });
      console.log(`✅ Playback resumed on new tab (from index: ${playback.currentActionIndex + 1})`);
    } catch (error) {
      console.error('⚠️ Failed to resume playback on new tab:', error.message);
      // Retry after a delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        await chrome.tabs.sendMessage(newTab.id, {
          action: 'initPlayback',
          uuid: uuid,
          script: playback.script,
          startFromIndex: playback.currentActionIndex + 1
        });
        console.log(`✅ Playback resumed on new tab after retry`);
      } catch (retryError) {
        console.error('❌ Failed to resume playback on new tab after retry:', retryError.message);
      }
    }
  };

  chrome.tabs.onCreated.addListener(tabCreatedListener);

  // Store both listeners so we can remove them later
  activePlaybacks.get(uuid).tabUpdateListener = tabUpdateListener;
  activePlaybacks.get(uuid).tabCreatedListener = tabCreatedListener;

  return { windowId: window.id, tabId: tabId };
}

// Stop playback - close window
async function handleStopPlayback(uuid) {
  const playback = activePlaybacks.get(uuid);
  if (!playback) {
    throw new Error('No active playback found for this UUID');
  }

  // Remove event listeners
  if (playback.tabUpdateListener) {
    chrome.tabs.onUpdated.removeListener(playback.tabUpdateListener);
    console.log('Removed playback tabUpdateListener');
  }
  if (playback.tabCreatedListener) {
    chrome.tabs.onCreated.removeListener(playback.tabCreatedListener);
    console.log('Removed playback tabCreatedListener');
  }

  // Close the window
  if (playback.windowId) {
    try {
      await chrome.windows.remove(playback.windowId);
    } catch (error) {
      console.log('Window may already be closed:', error.message);
    }
  }

  // Clean up
  activePlaybacks.delete(uuid);
}

// Handle recorded action from content script
async function handleRecordedAction(uuid, action) {
  console.log('📝 Received recorded action for UUID:', uuid);
  console.log('📝 Action details:', JSON.stringify(action, null, 2));

  const recording = activeRecordings.get(uuid);
  if (!recording) {
    console.warn('⚠️ No active recording found for UUID:', uuid);
    return; // Recording might have been stopped
  }

  console.log('📝 Current actions count before adding:', recording.script.actions.length);

  // Add action to script
  recording.script.actions.push(action);

  console.log('📝 New actions count after adding:', recording.script.actions.length);

  // Save to storage
  await saveScript(uuid, recording.script);
  console.log('💾 Script saved to storage');
}

// Save script to storage
async function saveScript(uuid, script) {
  await chrome.storage.local.set({
    [`script_${uuid}`]: script
  });
}


// Get script from storage
async function getScript(uuid) {
  const result = await chrome.storage.local.get([`script_${uuid}`]);
  return result[`script_${uuid}`] || null;
}

// Helper function to wait for tab to be ready
function waitForTabReady(tabId) {
  return new Promise((resolve) => {
    const checkTab = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        console.log('📋 Tab status:', tab.status, 'for tab:', tabId);
        if (tab.status === 'complete') {
          // Additional wait for content scripts to be ready
          console.log('⏳ Waiting 1 second for content scripts to load...');
          setTimeout(resolve, 1000);
        } else {
          const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              console.log('⏳ Tab complete, waiting 1 second for content scripts to load...');
              // Additional wait for content scripts to be ready
              setTimeout(resolve, 1000);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        }
      } catch (error) {
        console.error('Error checking tab status:', error);
        // Fallback: wait a bit and resolve
        setTimeout(resolve, 2000);
      }
    };
    checkTab();
  });
}

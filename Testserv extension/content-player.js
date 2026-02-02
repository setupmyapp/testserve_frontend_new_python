// Content Script - Plays back recorded actions
console.log('🎭 Content player script loaded on:', window.location.href);

let isPlayingPlayer = false;
let currentUuidPlayer = null;
let playbackScriptPlayer = null;
let currentActionIndexPlayer = 0;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Player received message:', message.action);
  if (message.action === 'initPlayback') {
    console.log('🎭 Starting playback with UUID:', message.uuid);
    console.log('🎭 Script has', message.script?.actions?.length || 0, 'actions');
    console.log('🎭 Start from index:', message.startFromIndex || 0);
    startPlayback(message.uuid, message.script, message.startFromIndex || 0);
    sendResponse({ success: true });
    return true; // Keep channel open
  } else if (message.action === 'stopPlayback') {
    stopPlayback();
    sendResponse({ success: true });
    return false;
  }
  return false;
});

async function startPlayback(uuid, script, startIndex = 0) {
  if (isPlayingPlayer) {
    console.warn('⚠️ Playback already in progress');
    return;
  }

  console.log('🎭 ===== STARTING PLAYBACK =====');
  console.log('🎭 UUID:', uuid);
  console.log('🎭 URL:', window.location.href);
  console.log('🎭 Actions count:', script.actions ? script.actions.length : 0);

  isPlayingPlayer = true;
  currentUuidPlayer = uuid;
  playbackScriptPlayer = script;
  currentActionIndexPlayer = startIndex;

  // Wait for page to be ready (smart detection, no hardcoded delays)
  await waitForPageReady();

  console.log('✅ Page ready, starting action execution');
  // Execute actions
  await executeActions();
}

function stopPlayback() {
  if (!isPlayingPlayer) return;

  isPlayingPlayer = false;
  currentUuidPlayer = null;
  playbackScriptPlayer = null;
  currentActionIndexPlayer = 0;
  console.log('Playback stopped');
}

async function executeActions() {
  if (!playbackScriptPlayer || !playbackScriptPlayer.actions) {
    console.error('❌ No actions to execute');
    stopPlayback();
    return;
  }

  const finishedUuid = currentUuidPlayer;

  try {
    console.log(`🎭 Executing ${playbackScriptPlayer.actions.length} actions...`);
    console.log(`🎭 Starting from index: ${currentActionIndexPlayer}`);
    console.log(`🎭 Current URL: ${window.location.href}`);

    for (let i = currentActionIndexPlayer; i < playbackScriptPlayer.actions.length; i++) {
      if (!isPlayingPlayer) {
        console.log('⏹️ Playback stopped by user');
        updateStatusToast(null, 'Stopped');
        break;
      }

      const action = playbackScriptPlayer.actions[i];
      currentActionIndexPlayer = i;
      const totalActions = playbackScriptPlayer.actions.length;

      // Notify background that this action is starting
      chrome.runtime.sendMessage({
        action: 'playbackActionStarted',
        uuid: finishedUuid,
        index: i
      }).catch(() => { });

      console.log(`🎭 ========================================`);
      console.log(`🎭 [${i + 1}/${totalActions}] Executing: ${action.type}`);

      // Update visual toast
      updateStatusToast(`${i + 1}/${totalActions}`, action.type);

      // Skip mandatory delay and highlighting for video media actions to maintain timing accuracy
      const isVideoAction = ['play', 'pause', 'seek', 'watch'].includes(action.type);

      let elementLabel = '';

      if (!isVideoAction) {
        // Add mandatory delay between actions for visibility (requested by user)
        console.log(`⏳ Waiting 1 seconds before execution...`);

        // Attempt to highlight the element briefly AND get its label
        let elementToHighlight = null;
        if (action.selector && action.selector !== 'window' && action.selector !== 'document') {
          try {
            // Just a peek to get info
            elementToHighlight = await waitForElement(action.selector, action, 1000).catch(() => null);
            if (elementToHighlight) {
              highlightElement(elementToHighlight);
              elementLabel = getElementLabel(elementToHighlight);
            }
          } catch (e) {
            // Silently ignore highlight errors
          }
        }

        // Update toast with label if found
        updateStatusToast(`${i + 1}/${totalActions}`, action.type, false, elementLabel);

        await wait(1000);
        if (elementToHighlight) removeHighlight(elementToHighlight);
      } else {
        // for video actions, try to get label without waiting
        // or just use generic text
        updateStatusToast(`${i + 1}/${totalActions}`, action.type, false, elementLabel);
      }

      // Check for OTP checkpoint
      if (action.type === 'otp_checkpoint') {
        console.log('🔐 OTP checkpoint detected - waiting for manual OTP entry...');
        await waitForOtpEntry();
        console.log('✅ OTP verified - continuing playback');
        coinue;
      }

      // Check for OTP page (Dynamic detection)
      if (isOtpPageVisible()) {
        console.log('🔐 OTP detected dynamically - pausing script for automation...');
        await waitForOtpEntry();
      }

      // Check for PIN popup
      if (isPinPopupVisible()) {
        await waitForPinEntry();
      }

      try {
        await executeAction(action);
        console.log(`✅ Action ${i + 1} completed successfully`);
      } catch (error) {
        // Handle OTP interrupt
        if (error.message === 'OTP_DETECTED') {
          console.log('⚡ OTP Interrupt caught! Automatic handling started...');
          await waitForOtpEntry();
          // After returning from automation, we assume OTP is done.
          // We should SKIP the current action because it was likely the "failure" to find a normal element
          // OR it was the OTP input itself.
          console.log('⏭️ Skipping current action because OTP was handled automatically.');
          continue;
        }

        const isVideoClick = action.type === 'click' &&
          (action.selector.includes('video') ||
            action.selector.includes('player') ||
            action.selector.includes('control'));

        if (isVideoClick) {
          console.warn(`⚠️ Skipped optional video click action ${i + 1}:`, error.message);
        } else {
          console.error(`❌ Error executing action ${i + 1}:`, error.message);
          updateStatusToast(`${i + 1}/${totalActions}`, `Error: ${action.type}`, true);
        }
        console.log('⏭️ Continuing with next action...');
      }
    }
  } catch (err) {
    console.error('❌ Critical error in executeActions loop:', err);
  } finally {
    console.log('🎭 ===== PLAYBACK COMPLETED =====');
    stopPlayback();

    // Small delay to ensure all messages are delivered in order
    await wait(100);

    // Notify background script
    chrome.runtime.sendMessage({
      action: 'playbackCompleted',
      uuid: finishedUuid
    }).catch(() => { });
  }
}

async function executeAction(action) {
  console.log('Executing action:', action.type, action.selector);

  switch (action.type) {
    case 'click':
      await executeClick(action.selector, action);
      break;

    case 'type':
      await executeType(action.selector, action.value);
      break;

    case 'select':
      await executeSelect(action.selector, action.value);
      break;

    case 'check':
      await executeCheck(action.selector, true);
      break;

    case 'uncheck':
      await executeCheck(action.selector, false);
      break;

    case 'submit':
      await executeSubmit(action.selector);
      break;

    case 'navigate':
      // Navigation is handled by URL change
      console.log('🧭 Navigation action - current URL:', window.location.href);
      console.log('🧭 Target URL:', action.value);
      if (action.value && action.value !== window.location.href) {
        console.log('🧭 Navigating to:', action.value);
        // Note: Navigation will cause page reload, so playback will stop
        // The background script should handle re-initializing playback on new page
        window.location.href = action.value;
        // Wait a bit before the page unloads
        await wait(500);
      } else {
        console.log('🧭 Already on target URL, skipping navigation');
      }
      break;

    case 'keypress':
      await executeKeyPress(action.selector, action.value);
      break;

    case 'focus':
      await executeFocus(action.selector);
      break;

    case 'scroll':
      await executeScroll(action.selector, action.value);
      break;

    case 'seek':
      await executeSeek(action.selector, action.value);
      break;

    case 'play':
      await executePlay(action.selector, action.value);
      break;

    case 'pause':
      await executePause(action.selector, action.value);
      break;

    case 'watch':
      await executeWatch(action.value);
      break;

    case 'otp_checkpoint':
      // OTP checkpoint is handled in executeActions loop
      // This case is here to avoid "unknown action" warning
      console.log('🔐 OTP checkpoint (handled in main loop)');
      break;

    default:
      console.warn('Unknown action type:', action.type);
  }
}

function matchesAction(element, action) {
  if (!element || !action) return true; // Can't validate without action metadata

  // 1. Tag name check
  if (action.tagName && element.tagName !== action.tagName) {
    console.log(`❌ Tag mismatch: expected ${action.tagName}, got ${element.tagName}`);
    return false;
  }

  // 2. Text content check (for non-input elements)
  if (action.text && action.text.length > 0 && action.text.length < 50 &&
    element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA' && element.tagName !== 'SELECT') {
    const elementText = element.textContent?.trim() || "";
    // Check if recorded text is a substring (robust to minor dynamic changes)
    if (!elementText.toLowerCase().includes(action.text.toLowerCase()) &&
      !action.text.toLowerCase().includes(elementText.toLowerCase())) {
      console.log(`❌ Text mismatch: expected something like "${action.text}", got "${elementText}"`);
      return false;
    }
  }

  // 3. Name attribute check
  if (action.name && element.getAttribute('name') !== action.name) return false;

  return true;
}

async function waitForElement(selector, action = null, timeout = 15000) {

  const startTime = Date.now();

  // Ensure selector is a string (handle case where it might be an object from old recordings)
  let primarySelector = selector;
  if (typeof selector !== 'string') {
    if (selector && selector.value) {
      primarySelector = selector.value;
    } else {
      primarySelector = String(selector);
    }
  }

  console.log(`🔍 Waiting for element: ${primarySelector}`);

  // Build list of selector strategies to try
  const strategies = [primarySelector];

  // Add fallback strategies from action metadata
  if (action) {
    if (action.dataTestId) {
      strategies.push(`[data-testid="${action.dataTestId}"]`);
    }
    if (action.ariaLabel) {
      strategies.push(`[aria-label="${action.ariaLabel}"]`);
    }
    if (action.text && action.text.length < 100) {
      // Try XPath with text content - find element by tag and text
      const tagName = action.tagName || '*';
      const xpath = `//${tagName}[contains(text(), "${action.text.substring(0, 50).replace(/"/g, '\\"')}")]`;
      strategies.push({ type: 'xpath', value: xpath });
    }
    if (action.role && action.text) {
      const xpath = `//*[@role="${action.role}" and contains(text(), "${action.text.substring(0, 50).replace(/"/g, '\\"')}")]`;
      strategies.push({ type: 'xpath', value: xpath });
    }
  }

  console.log(`🔍 Trying ${strategies.length} selector strategies...`);

  while (Date.now() - startTime < timeout) {
    // Try each strategy
    for (const strategy of strategies) {
      let element = null;

      if (typeof strategy === 'string') {
        // Auto-detect XPath strings
        if (strategy.startsWith('/') || strategy.startsWith('//') || strategy.startsWith('(/')) {
          try {
            const result = document.evaluate(
              strategy,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            element = result.singleNodeValue;
          } catch (e) {
            console.warn(`⚠️ Invalid XPath: ${strategy}`, e);
          }
        } else {
          // CSS selector
          try {
            element = document.querySelector(strategy);
          } catch (e) {
            console.warn(`⚠️ Invalid CSS selector: ${strategy}`, e);
          }
        }
      } else if (strategy && strategy.type === 'xpath') {
        // XPath selector
        try {
          const result = document.evaluate(
            strategy.value,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          element = result.singleNodeValue;
        } catch (e) {
          console.warn(`⚠️ Invalid XPath: ${strategy.value}`, e);
        }
      }

      if (element) {
        // Validation logic
        if (action) {
          const style = window.getComputedStyle(element);
          const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';

          if (isVisible && matchesAction(element, action)) {
            console.log(`✅ Element found and validated using strategy: ${typeof strategy === 'string' ? strategy : (strategy.type || 'xpath')}`);
            return element;
          } else {
            console.warn(`⚠️ Element found by strategy but failed validation or visibility check. Continuing...`);
            element = null; // Reset and continue to next strategy
          }
        } else {
          // No action metadata, just return the element
          return element;
        }
      }
    }
    // Poll with short interval
    await wait(50);
  }

  console.error(`❌ Element not found with any strategy (timeout: ${timeout}ms)`);
  console.error(`❌ Primary selector: ${primarySelector}`);
  console.error(`❌ Tried ${strategies.length} strategies`);
  throw new Error(`Element not found: ${primarySelector} (timeout: ${timeout}ms)`);
}

async function executeClick(selector, action = null) {
  console.log(`🖱️ Executing click on: ${selector}`);

  // If this action is related to video, ensure controls are visible first
  if (action && (action.videoState || selector.includes('video') || selector.includes('player-wrapper'))) {
    await ensureControlsVisible();
  }

  const element = await waitForElementInteractable(selector, action);

  // Element is already scrolled into view and verified as clickable by waitForElementInteractable
  console.log('🖱️ Clicking element...');
  element.click();
  console.log('✅ Click executed');
}

async function executeType(selector, value) {
  console.log(`⌨️ Executing type on: ${selector}, value: ${value}`);
  const element = await waitForElement(selector);

  if (element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA') {
    throw new Error(`Element is not an input: ${selector}`);
  }

  // Focus the element
  console.log('🎯 Focusing element...');
  element.focus();

  // Clear existing value
  element.value = '';

  // Set new value (instant in playback, no character-by-character delay)
  console.log(`⌨️ Typing: "${value}"`);
  if (value) {
    element.value = value;
    // Trigger input and change events
    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    element.dispatchEvent(inputEvent);
  }

  // Trigger final change event
  const changeEvent = new Event('change', { bubbles: true, cancelable: true });
  element.dispatchEvent(changeEvent);

  console.log('✅ Typing completed');
}

async function executeSelect(selector, value) {
  const element = await waitForElement(selector);

  if (element.tagName !== 'SELECT') {
    throw new Error(`Element is not a select: ${selector}`);
  }

  element.value = value;

  // Trigger change event
  const changeEvent = new Event('change', { bubbles: true });
  element.dispatchEvent(changeEvent);
}

async function executeCheck(selector, checked) {
  const element = await waitForElement(selector);

  if (element.type !== 'checkbox' && element.type !== 'radio') {
    throw new Error(`Element is not a checkbox/radio: ${selector}`);
  }

  if (element.checked !== checked) {
    element.checked = checked;

    // Trigger change event
    const changeEvent = new Event('change', { bubbles: true });
    element.dispatchEvent(changeEvent);
  }
}

async function executeSubmit(selector) {
  const element = await waitForElement(selector);

  if (element.tagName !== 'FORM') {
    throw new Error(`Element is not a form: ${selector}`);
  }

  element.submit();
}

async function executeKeyPress(selector, key) {
  let element;

  if (selector === 'document') {
    element = document;
  } else {
    element = await waitForElement(selector);
  }

  const keyEvent = new KeyboardEvent('keydown', {
    key: key,
    bubbles: true,
    cancelable: true
  });

  element.dispatchEvent(keyEvent);
}

async function executeFocus(selector) {
  const element = await waitForElement(selector);
  element.focus();
}

async function executeScroll(selector, value) {
  console.log(`📜 Executing scroll on: ${selector}`);

  if (selector === 'window') {
    // Window scroll
    window.scrollTo(value.x, value.y);
    console.log(`✅ Scrolled window to (${value.x}, ${value.y})`);
  } else {
    // Element scroll
    const element = await waitForElement(selector);
    element.scrollLeft = value.x;
    element.scrollTop = value.y;
    console.log(`✅ Scrolled element to (${value.x}, ${value.y})`);
  }
}

async function executeSeek(selector, value) {
  console.log(`🔍 Executing seek to: ${value}`);
  const video = await waitForElement(selector || 'video');
  if (video && video.tagName === 'VIDEO') {
    video.currentTime = value;
    console.log(`✅ Seeked video to ${value}`);

    // Check if seek action triggered a PIN popup
    await wait(500); // Brief wait for popup to appear
    if (isPinPopupVisible()) {
      await waitForPinEntry();
    }
  } else {
    console.warn('⚠️ Could not find video element for seek');
  }
}

async function executePlay(selector, value) {
  console.log(`▶️ Executing play at: ${value}`);
  const video = await waitForElement(selector || 'video');
  if (video && video.tagName === 'VIDEO') {
    if (value !== undefined) video.currentTime = value;

    // Ensure muted to bypass autoplay policy if needed, 
    // though we try to play unmuted first
    try {
      await video.play();
      console.log(`✅ Video playing at ${video.currentTime}`);
    } catch (e) {
      console.warn('⚠️ Play failed, trying muted...', e.message);
      video.muted = true;
      try {
        await video.play();
        console.log('✅ Video playing (muted)');
      } catch (e2) {
        console.error('❌ Direct play failed even after muted. Attempting UI click...');
        // Fallback: try to click a generic play button if one is found
        const playBtn = document.querySelector('.play-button, .player-control-play, [aria-label*="Play"]');
        if (playBtn) playBtn.click();
      }
    }

    // Check if play action triggered a PIN popup
    await wait(500); // Brief wait for popup to appear
    if (isPinPopupVisible()) {
      await waitForPinEntry();
      // Retry play after PIN entry
      try {
        await video.play();
        console.log('✅ Video resumed after PIN entry');
      } catch (e) {
        console.warn('⚠️ Retry play failed, trying UI click...');
        const playBtn = document.querySelector('.play-button, .player-control-play, [aria-label*="Play"]');
        if (playBtn) playBtn.click();
      }
    }
  }
}

async function executePause(selector, value) {
  console.log(`⏸️ Executing pause at: ${value}`);
  const video = await waitForElement(selector || 'video');
  if (video && video.tagName === 'VIDEO') {
    if (value !== undefined) video.currentTime = value;
    video.pause();
    console.log(`✅ Video paused at ${video.currentTime}`);
  }
}

async function syncVideoState(state) {
  // Function deprecated - we now use explicit play/pause/seek actions
  console.log('🔄 syncVideoState called but deprecated');
}

async function ensureControlsVisible() {
  console.log('👀 Ensuring video controls are visible...');

  // Find the video player container or video itself
  const target = document.querySelector('.player-wrapper') ||
    document.querySelector('.kaltura-player-container') ||
    document.querySelector('video');

  if (!target) return;

  // Simulate mouse movement over the player container
  const rect = target.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  // Dispatch mousemove events to "wake up" the controls
  const events = [
    new MouseEvent('mousemove', { bubbles: true, clientX: centerX, clientY: centerY }),
    new MouseEvent('mousemove', { bubbles: true, clientX: centerX + 10, clientY: centerY + 10 }),
    new MouseEvent('mouseenter', { bubbles: true, clientX: centerX, clientY: centerY })
  ];

  events.forEach(event => target.dispatchEvent(event));

  // Wait a moment for the controls overlay to appear
  await wait(500);
}

// Smart page ready detection without hardcoded delays
async function waitForPageReady() {
  console.log('⏳ Waiting for page to be ready...');

  // Wait for document ready state
  if (document.readyState !== 'complete') {
    await new Promise(resolve => {
      if (document.readyState === 'complete') {
        resolve();
      } else {
        window.addEventListener('load', resolve, { once: true });
      }
    });
  }

  console.log('✅ Document loaded');

  // Wait for DOM to stabilize (no mutations for 100ms)
  await waitForDOMStable();

  console.log('✅ Page ready');
}

// Wait for DOM to stop mutating (indicates dynamic content has loaded)
async function waitForDOMStable(timeout = 5000) {
  const startTime = Date.now();
  let lastMutationTime = startTime;

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      lastMutationTime = Date.now();
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: false
    });

    const checkStability = setInterval(() => {
      const now = Date.now();
      const timeSinceLastMutation = now - lastMutationTime;
      const totalTime = now - startTime;

      // Consider stable if no mutations for 100ms OR timeout reached
      if (timeSinceLastMutation > 100 || totalTime > timeout) {
        clearInterval(checkStability);
        observer.disconnect();
        console.log(`✅ DOM stable (waited ${totalTime}ms)`);
        resolve();
      }
    }, 50);
  });
}

// Wait for element to be interactable (visible, enabled, and in a clickable state)
async function waitForElementInteractable(selector, action = null, timeout = 15000) {
  console.log(`🔍 Waiting for element to be interactable: ${selector}`);

  const element = await waitForElement(selector, action, timeout);
  const startTime = Date.now();

  // Poll until element is interactable
  while (Date.now() - startTime < timeout) {
    const rect = element.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0;
    const isInViewport = rect.top >= 0 && rect.top < window.innerHeight &&
      rect.left >= 0 && rect.left < window.innerWidth;
    const isEnabled = !element.disabled &&
      element.getAttribute('aria-disabled') !== 'true' &&
      !element.hasAttribute('disabled');
    const computedStyle = window.getComputedStyle(element);
    const isDisplayed = computedStyle.display !== 'none' &&
      computedStyle.visibility !== 'hidden' &&
      computedStyle.opacity !== '0';

    if (isVisible && isEnabled && isDisplayed) {
      // Scroll into view if needed
      if (!isInViewport) {
        console.log('📜 Scrolling element into view...');
        element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
        await wait(100); // Small wait for scroll to complete
      }

      console.log('✅ Element is interactable');
      return element;
    }

    await wait(50); // Poll every 50ms
  }

  console.warn('⚠️ Element found but may not be fully interactable, proceeding anyway');
  return element;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// PIN Popup Detection - Detects the "Rated Content" modal on mewatch.sg
function isPinPopupVisible() {
  // Check for modal with "Rated Content" text
  const modals = document.querySelectorAll('.modal-manager, [role="dialog"], [class*="modal"]');

  for (const modal of modals) {
    const text = modal.textContent || '';
    // Look for specific PIN popup text
    if (text.includes('Rated Content') && text.includes('Control PIN')) {
      const style = window.getComputedStyle(modal);
      const isVisible = style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0';
      if (isVisible) {
        console.log('🔒 PIN popup detected');
        return true;
      }
    }
  }
  return false;
}

// Wait for PIN popup to disappear (manual entry by user)
async function waitForPinEntry() {
  console.log('🔒 PIN required - waiting for manual entry...');
  console.log('👉 Please enter the PIN on the site interface');

  // Update status toast to inform user
  updateStatusToast('⏸️', 'PIN Required - Enter Manually', false);

  // Poll until PIN popup disappears
  while (isPinPopupVisible()) {
    await wait(200); // Check every 200ms
  }

  console.log('✅ PIN popup cleared - resuming playback');

  // Wait a bit for the site to stabilize after PIN entry
  await wait(1000);
}

// ===== OTP PAGE DETECTION & PLAYBACK HANDLING =====

// Detect if full-page OTP screen is visible
function isOtpPageVisible() {
  console.log('🔍 Checking for OTP page...');
  const bodyText = (document.body?.textContent || '').toLowerCase();

  // Check for various OTP indicators
  const hasOtpHeader = bodyText.includes('otp verification') ||
    bodyText.includes('one-time password') ||
    bodyText.includes('enter the code');

  if (!hasOtpHeader) {
    // console.log('❌ No OTP header text found');
    return false;
  }

  // Also verify there's an input field for the code
  const input = document.querySelector('input[placeholder*="code" i], input[placeholder*="OTP" i], input[name*="code" i], input[name*="otp" i]');
  const hasInput = !!input;

  if (hasInput) {
    console.log('🔐 OTP page detected (Header + Input found)');
    return true;
  }

  // Fallback: Check for verify button if input logic misses
  const verifyBtn = document.querySelector('button, input[type="submit"], [role="button"]');
  if (verifyBtn && (verifyBtn.innerText || verifyBtn.value || '').toLowerCase().match(/verify|next|submit/)) {
    console.log('🔐 OTP page detected (Header + Verify Button found)');
    return true;
  }

  return false;
}

// Wait for OTP page to disappear (manual or auto)
async function waitForOtpEntry() {
  console.log('🔐 OTP verification required - triggering automation...');
  updateStatusToast('🤖', 'Auto-verifying OTP...', false);

  // Attempt partial automation
  try {
    console.log('📨 Requesting Gmail OTP from background...');

    // Request background to handle Gmail flow (opens tab, gets OTP, closes tab)
    // We set a long timeout because this involves network and UI steps
    const response = await sendMessageWithTimeout({ action: 'openGmailAndGetOtp' }, 60000);

    if (response && response.success && response.otp) {
      console.log('✅ Received OTP:', response.otp);
      updateStatusToast('⚡', 'Entering OTP...', false);

      await enterOtp(response.otp);

      // Wait for page to transition/verify
      await wait(2000);

      // Check if we are still on OTP page
      if (!isOtpPageVisible()) {
        console.log('✅ OTP verified successfully (auto)!');
        updateStatusToast('✅', 'OTP Verified', false);
        await wait(1000);
        return;
      } else {
        console.warn('⚠️ OTP entered but page did not transition. Verification might have failed.');
      }
    } else {
      console.warn('⚠️ OTP Automation failed or timed out:', response ? response.error : 'No response');
    }
  } catch (error) {
    console.error('❌ Error during OTP automation:', error);
  }

  // Fallback to manual entry if automation didn't fully resolve it
  if (isOtpPageVisible()) {
    console.log('👉 Automation finished/failed - waiting for manual entry...');
    updateStatusToast('⏸️', 'Manual OTP Required', false);

    // Poll until OTP page disappears
    while (isOtpPageVisible()) {
      await wait(500);
    }
    console.log('✅ OTP manually verified - resuming playback');
  } else {
    console.log('✅ OTP verified - resuming playback');
  }

  // Wait a bit for the site to stabilize after OTP verification
  await wait(1000);
}

// Helper to enter OTP into the page
async function enterOtp(otp) {
  console.log('⌨️ Attempting to enter OTP:', otp);

  // Strategy 1: Find single input field (most common)
  // Look for common attributes based on screenshot "Enter the code*"
  const singleInput = document.querySelector('input[placeholder*="code" i], input[placeholder*="OTP" i], input[name="code"], input[name="otp"], input[autocomplete="one-time-code"]');

  if (singleInput) {
    console.log('🎯 Found single input field:', singleInput);
    singleInput.focus();
    singleInput.value = otp;
    singleInput.dispatchEvent(new Event('input', { bubbles: true }));
    singleInput.dispatchEvent(new Event('change', { bubbles: true }));

    await wait(500);

    // Find Next/Verify button
    // Screenshot shows "Next" button
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"], input[type="submit"]'));
    const targetBtn = buttons.find(b => {
      const text = (b.textContent || b.value || '').trim().toLowerCase();
      return text === 'next' || text === 'verify' || text === 'submit' || text === 'continue';
    });

    if (targetBtn) {
      console.log('🖱️ Clicking verification button:', targetBtn);
      targetBtn.click();
    } else {
      console.log('⚠️ Could not find specific Verify/Next button, trying Enter key...');
      singleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    return;
  }

  // Strategy 2: Split input fields (Digit boxes)
  const inputs = Array.from(document.querySelectorAll('input')).filter(i => {
    // Basic heuristic for digit inputs: short max length, often grouped
    return i.offsetParent !== null && (i.maxLength === 1 || i.style.width === '40px' || i.className.includes('digit'));
  });

  if (inputs.length >= 4 && inputs.length <= 8) {
    console.log(`🎯 Found ${inputs.length} digit fields`);
    const chars = otp.split('');
    chars.forEach((char, i) => {
      if (inputs[i]) {
        inputs[i].focus();
        inputs[i].value = char;
        inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
        inputs[i].dispatchEvent(new Event('keyup', { bubbles: true }));
      }
    });
    // Triggers are often auto-on-fill for these, but we wait and see
  } else {
    console.warn('⚠️ Could not identify OTP input field(s)');
  }
}

function sendMessageWithTimeout(msg, timeout) {
  return new Promise((resolve, reject) => {
    let responded = false;

    chrome.runtime.sendMessage(msg, (response) => {
      if (responded) return;
      responded = true;
      if (chrome.runtime.lastError) {
        // Background might not have a handler yet if not reloaded, but we assume it has
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });

    setTimeout(() => {
      if (!responded) {
        responded = true;
        resolve({ success: false, error: 'Timeout waiting for background request' });
      }
    }, timeout);
  });
}

// Execute watch duration
async function executeWatch(duration) {
  console.log(`⏱️ Watching for ${duration.toFixed(2)} seconds...`);

  // Ensure video is playing
  const video = document.querySelector('video');
  if (video) {
    if (video.paused) {
      console.log('▶️ Resuming video for watch segment...');
      try {
        await video.play();
      } catch (e) {
        console.warn('⚠️ Could not auto-play video:', e);
      }
    }
  } else {
    console.warn('⚠️ No video element found for watch command');
  }

  // Visual feedback
  updateStatusToast('▶️', `Watching: ${duration.toFixed(1)}s`, false);

  // Wait for the duration
  await wait(duration * 1000);

  console.log('✅ Watch duration completed');
}

// Helper to get a human-readable label for an element
function getElementLabel(element) {
  if (!element) return '';

  // 1. Text Content (trimmed and truncated)
  const text = (element.innerText || element.textContent || '').trim();
  if (text.length > 0) {
    // If text is too long (e.g., paragraph), truncate it
    return text.length > 25 ? `"${text.substring(0, 25)}..."` : `"${text}"`;
  }

  // 2. Aria Label
  const ariaLabel = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby');
  if (ariaLabel) return `"${ariaLabel}"`;

  // 3. Form Attributes
  const placeholder = element.getAttribute('placeholder');
  if (placeholder) return `"${placeholder}"`;

  const value = element.value;
  if (value && typeof value === 'string' && value.length > 0 && value.length < 20) return `"${value}"`;

  const name = element.getAttribute('name');
  if (name) return `"${name}"`;

  // 4. Media Attributes
  const alt = element.getAttribute('alt');
  if (alt) return `"${alt}"`;

  const title = element.getAttribute('title');
  if (title) return `"${title}"`;

  // 5. Fallback: Tag + ID/Class
  let label = element.tagName.toLowerCase();
  if (element.id) label += `#${element.id}`;
  else if (element.className && typeof element.className === 'string') {
    const cleanClass = element.className.split(' ')[0];
    if (cleanClass) label += `.${cleanClass}`;
  }

  return label;
}

// Visual Feedback Helpers
function updateStatusToast(progress, status, isError = false, label = '') {
  let toast = document.getElementById('playback-status-toast');

  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'playback-status-toast';
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      background: rgba(30, 30, 35, 0.95);
      color: white;
      border-radius: 12px;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      font-size: 14px;
      font-weight: 500;
      z-index: 999999;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      gap: 12px;
      transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      transform: translateY(0);
      cursor: move;
      user-select: none;
    `;

    // Drag functionality
    let isDragging = false;
    let offsetX, offsetY;

    toast.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - toast.getBoundingClientRect().left;
      offsetY = e.clientY - toast.getBoundingClientRect().top;
      toast.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;
      toast.style.left = `${x}px`;
      toast.style.top = `${y}px`;
      toast.style.right = 'auto';
      // Persist position for future updates
      toast.dataset.posX = x;
      toast.dataset.posY = y;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        toast.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      }
    });

    document.body.appendChild(toast);
  } else {
    // If it already exists and has been moved, restore its position
    if (toast.dataset.posX && toast.dataset.posY) {
      toast.style.left = `${toast.dataset.posX}px`;
      toast.style.top = `${toast.dataset.posY}px`;
      toast.style.right = 'auto';
    }
  }

  if (progress === null) {
    toast.style.transform = 'translateY(-100px)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
    return;
  }

  const icon = isError ? '❌' : '🎭';
  const color = isError ? '#ff4b2b' : '#3d8bff';

  let statusText = status.charAt(0).toUpperCase() + status.slice(1);
  if (label) {
    statusText = `${statusText}: <span style="font-weight:700; color: #fff;">${label}</span>`;
  }

  toast.innerHTML = `
    <div style="background: ${color}; width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 12px ${color};"></div>
    <div style="display: flex; flex-direction: column;">
      <span style="font-size: 10px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px;">Playback ${progress}</span>
      <span style="display: flex; gap: 4px; color: rgba(255,255,255,0.9);">${statusText}</span>
    </div>
  `;
}

function highlightElement(element) {
  if (!element) return;
  element._originalTransition = element.style.transition;
  element._originalOutline = element.style.outline;
  element._originalBoxShadow = element.style.boxShadow;

  element.style.transition = 'all 0.3s ease';
  element.style.outline = '4px solid #3d8bff';
  element.style.outlineOffset = '2px';
  element.style.boxShadow = '0 0 20px rgba(61, 139, 255, 0.5)';
}

function removeHighlight(element) {
  if (!element) return;
  element.style.outline = element._originalOutline || '';
  element.style.boxShadow = element._originalBoxShadow || '';
  setTimeout(() => {
    element.style.transition = element._originalTransition || '';
  }, 300);
}

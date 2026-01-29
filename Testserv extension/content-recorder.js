// Content Script - Records user actions on the page
// Prevent multiple injections by wrapping everything in an IIFE
(function () {
  'use strict';

  // Check if script already loaded (prevents duplicate execution)
  if (window.__RECORDING_SCRIPT_LOADED__) {
    console.log('⚠️ Content recorder script already loaded, skipping duplicate');
    return; // Exit early to prevent redeclaration
  }
  window.__RECORDING_SCRIPT_LOADED__ = true;

  console.log('🎬 Content recorder script loaded on:', window.location.href);
  console.log('🎬 Script ready to receive messages');

  let isRecordingRecorder = false;
  let isPausedRecorder = false;
  let currentUuidRecorder = null;
  let actionIndexRecorder = 0;
  let listenersAttached = false;
  let controlUI = null;

  // Track last mousedown to deduplicate with click events
  let lastMouseDownTime = 0;
  let lastMouseDownTarget = null;

  // PIN popup tracking - prevents recording sensitive data
  let isPinPopupActive = false;
  let pinPopupCheckInterval = null;

  // OTP page tracking - prevents recording sensitive OTP input
  let isOtpPageActive = false;
  let otpPageCheckInterval = null;

  // Video watch time tracking
  let lastVideoPlayStartTime = 0;
  let isVideoPlayingRecorder = false;

  // Notify background that content script is ready
  try {
    chrome.runtime.sendMessage({
      action: 'contentScriptReady',
      url: window.location.href
    }).catch(() => {
      // Ignore errors - background might not be listening for this
    });
  } catch (e) {
    // Ignore errors
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Content script received message:', message);
    if (message.action === 'initRecording') {
      console.log('🎬 Starting/Resuming recording with UUID:', message.uuid);
      isPausedRecorder = message.isPaused || false;
      startRecording(message.uuid, message.startIndex || 0);
      sendResponse({ success: true });
      return true; // Keep channel open for async response
    }
    if (message.action === 'pauseStateChanged') {
      console.log('⏸️ Pause state changed:', message.isPaused);
      isPausedRecorder = message.isPaused;
      updateControlUI();
      sendResponse({ success: true });
      return true;
    }
    return false;
  });

  function startRecording(uuid, startIndex = 0) {
    if (isRecordingRecorder) {
      console.warn('⚠️ Recording already in progress, stopping previous recording');
      stopRecording();
    }

    console.log('🎬 ===== STARTING/RESUMING RECORDING =====');
    console.log('🎬 UUID:', uuid);
    console.log('🎬 Start Index:', startIndex);
    console.log('🎬 URL:', window.location.href);

    isRecordingRecorder = true;
    currentUuidRecorder = uuid;
    actionIndexRecorder = startIndex;

    // Clear any leftover pending actions from localStorage for this session
    try {
      localStorage.removeItem(`pending_actions_${uuid}`);
    } catch (e) { }

    // Attach event listeners
    attachRecordingListeners();

    // Inject Record/Pause UI
    injectControlUI();

    // Start PIN popup monitoring
    startPinMonitoring();

    // Start OTP page monitoring
    startOtpMonitoring();

    console.log('🎬 ===== RECORDING STARTED SUCCESSFULLY =====');
    console.log('🎬 Try clicking or typing on the page to test');
  }

  function stopRecording() {
    if (!isRecordingRecorder) return;

    isRecordingRecorder = false;
    removeRecordingListeners();
    stopPinMonitoring();
    stopOtpMonitoring();
    removeControlUI();
    console.log('Recording stopped for UUID:', currentUuidRecorder);
    currentUuidRecorder = null;
  }

  function attachRecordingListeners() {
    // Prevent duplicate attachment
    if (listenersAttached) {
      console.warn('⚠️ Listeners already attached, skipping');
      return;
    }

    console.log('🎧 Attaching recording event listeners');
    console.log('🎧 Document ready state:', document.readyState);
    console.log('🎧 Document body exists:', !!document.body);

    // Wait for document to be ready if needed
    if (document.readyState === 'loading') {
      console.log('⏳ Document still loading, waiting...');
      document.addEventListener('DOMContentLoaded', () => {
        console.log('✅ DOM content loaded, attaching listeners now');
        attachListenersNow();
      });
    } else {
      attachListenersNow();
    }

    function attachListenersNow() {
      // Click events - use mousedown for earlier capture (before navigation)
      // This ensures we catch clicks that cause navigation
      document.addEventListener('mousedown', handleMouseDown, true);
      document.addEventListener('click', handleClick, true);
      console.log('✅ Click listeners attached (mousedown + click)');

      // Input events
      document.addEventListener('input', handleInput, true);
      document.addEventListener('change', handleChange, true);
      console.log('✅ Input/Change listeners attached');

      // Form submission - capture phase to catch before navigation
      document.addEventListener('submit', handleSubmit, true);
      console.log('✅ Submit listener attached');

      // Navigation
      window.addEventListener('beforeunload', handleNavigation);
      console.log('✅ Navigation listener attached');

      // Keyboard events - especially Enter key for form submission
      document.addEventListener('keydown', handleKeyDown, true);
      document.addEventListener('keypress', handleKeyPress, true);
      console.log('✅ Keydown/Keypress listeners attached');

      // Focus events
      document.addEventListener('focus', handleFocus, true);
      console.log('✅ Focus listener attached');

      // Scroll events (both window and element)
      window.addEventListener('scroll', handleScroll, true);
      document.addEventListener('scroll', handleScroll, true);
      console.log('✅ Scroll listeners attached');

      // Video events
      document.addEventListener('seeking', handleVideoEvent, true);
      document.addEventListener('play', handleVideoEvent, true);
      document.addEventListener('pause', handleVideoEvent, true);
      console.log('✅ Video listeners attached (seeking, play, pause)');

      listenersAttached = true;
      console.log('🎧 All recording listeners attached successfully');
      console.log('🎧 Recording is now ACTIVE - ready to capture actions');
      console.log('🎧 TEST: Try clicking anywhere on this page!');
    }
  }

  function removeRecordingListeners() {
    if (!listenersAttached) {
      return;
    }

    console.log('🔌 Removing recording event listeners');
    document.removeEventListener('mousedown', handleMouseDown, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('input', handleInput, true);
    document.removeEventListener('change', handleChange, true);
    document.removeEventListener('submit', handleSubmit, true);
    window.removeEventListener('beforeunload', handleNavigation);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('keypress', handleKeyPress, true);
    document.removeEventListener('focus', handleFocus, true);
    window.removeEventListener('scroll', handleScroll, true);
    document.removeEventListener('scroll', handleScroll, true);
    document.removeEventListener('seeking', handleVideoEvent, true);
    document.removeEventListener('play', handleVideoEvent, true);
    document.removeEventListener('pause', handleVideoEvent, true);
    listenersAttached = false;
    console.log('🔌 All listeners removed');
  }

  function recordAction(action) {
    if (!isRecordingRecorder) {
      console.log('Not recording, ignoring action:', action.type);
      return;
    }

    if (isPausedRecorder) {
      console.log('⏸️ Recording is paused, skipping action:', action.type);
      return;
    }

    if (!currentUuidRecorder) {
      console.error('No UUID set, cannot record action');
      return;
    }

    // 🔒 PRIVACY: Skip recording during PIN popup to protect sensitive data
    if (isPinPopupActive) {
      console.log('🔒 PIN popup active - skipping action recording for privacy:', action.type);
      return;
    }

    // 🔒 PRIVACY: Skip recording during OTP page to protect sensitive data
    if (isOtpPageActive) {
      console.log('🔒 OTP page active - skipping action recording for privacy:', action.type);
      return;
    }

    // Always include full XPath as the primary selector for simplicity as requested
    const xpath = action.element ? getFullXPath(action.element) : null;

    // Generate a human-readable name for the element
    const displayName = action.element ? getBestElementLabel(action.element) : null;

    // Record action without delays or timestamps (Playwright-style)
    const recordedAction = {
      index: actionIndexRecorder++,
      type: action.type,
      selector: xpath || action.selector,
      displayName: displayName,
      value: action.value,
      url: window.location.href
    };

    // Copy additional metadata if present (for better validation/matching)
    if (action.text !== undefined) recordedAction.text = action.text;
    if (action.ariaLabel !== undefined) recordedAction.ariaLabel = action.ariaLabel;
    if (action.dataTestId !== undefined) recordedAction.dataTestId = action.dataTestId;
    if (action.role !== undefined) recordedAction.role = action.role;
    if (action.tagName !== undefined) recordedAction.tagName = action.tagName;
    if (action.name !== undefined) recordedAction.name = action.name;

    console.log('📝 Full action:', JSON.stringify(recordedAction, null, 2));

    // Send to background script directly (no localStorage)
    chrome.runtime.sendMessage({
      action: 'recordedAction',
      uuid: currentUuidRecorder,
      recordedAction: recordedAction
    })
      .then(() => {
        console.log('✅ Action sent successfully to background:', recordedAction.type);
      })
      .catch(err => {
        console.error('❌ Failed to send action to background:', err.message);
        // Note: Action may be lost during navigation, but this prevents duplicates
      });
  }

  function getElementSelector(element) {
    if (!element || !element.tagName) return null;

    // Use absolute XPath as the only selector strategy as requested
    return getFullXPath(element);
  }

  function getFullXPath(element) {
    if (!element || element.nodeType !== 1) return null;

    if (element === document.documentElement) return '/html';
    if (element === document.body) return '/html/body';

    const path = [];
    let current = element;

    while (current && current !== document.documentElement) {
      const tagName = current.tagName.toLowerCase();

      if (current === document.body) {
        path.unshift('body');
        break;
      }

      let index = 1;
      let sibling = current.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1 && sibling.tagName === current.tagName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      path.unshift(`${tagName}[${index}]`);
      current = current.parentNode;
    }

    return '/html/' + path.join('/');
  }

  function handleMouseDown(event) {
    if (!isRecordingRecorder) return;

    // Ignore right-click and middle-click
    if (event.button !== 0) return;

    // Skip video-related clicks - we record video events separately
    if (event.target.tagName === 'VIDEO' ||
      event.target.closest('.player-wrapper') ||
      event.target.closest('[class*="player"]') ||
      event.target.closest('[class*="video-control"]')) {
      console.log('⏭️ Skipping click on video control - will record video event instead');
      return;
    }

    console.log('🖱️ MouseDown event fired on:', event.target.tagName);

    // Store mousedown info for deduplication
    lastMouseDownTime = Date.now();
    lastMouseDownTarget = event.target;

    // Record mousedown as click immediately (before possible navigation)
    // This ensures we catch navigation-causing clicks
    const selector = getElementSelector(event.target);
    if (!selector) return;

    const textContent = event.target.textContent?.trim();
    const ariaLabel = event.target.getAttribute('aria-label');
    const dataTestId = event.target.getAttribute('data-testid');
    const role = event.target.getAttribute('role');
    const tagName = event.target.tagName;
    const name = event.target.getAttribute('name');

    console.log('🖱️ Recording mousedown as click:', selector);

    recordAction({
      type: 'click',
      selector: typeof selector === 'string' ? selector : (selector?.value || String(selector)),
      value: null,
      text: textContent && textContent.length < 100 ? textContent : null,
      ariaLabel: ariaLabel || null,
      dataTestId: dataTestId || null,
      role: role || null,
      tagName: tagName || null,
      name: name || null,
      element: event.target
    });
  }

  function handleClick(event) {
    console.log('🖱️ Click event fired! isRecordingRecorder:', isRecordingRecorder);

    if (!isRecordingRecorder) {
      console.log('⚠️ Not recording, ignoring click');
      return;
    }

    if (!currentUuidRecorder) {
      console.error('❌ No UUID set, cannot record click');
      return;
    }

    // Deduplicate with mousedown - if we just recorded a mousedown on same element, skip click
    const timeSinceMouseDown = Date.now() - lastMouseDownTime;
    if (lastMouseDownTarget === event.target && timeSinceMouseDown < 100) {
      console.log('⏭️ Skipping click (already recorded as mousedown)');
      return;
    }

    // Skip video-related clicks - we record video events separately
    const isVideoElement = event.target.tagName === 'VIDEO' ||
      event.target.closest('.player-wrapper') ||
      event.target.closest('[class*="player"]') ||
      event.target.closest('[class*="video-control"]') ||
      event.target.closest('[class*="vjs-"]') || // Video.js
      event.target.closest('[class*="jwplayer"]'); // JW Player

    const buttonText = (event.target.textContent || event.target.value || '').toLowerCase();
    const isVideoButtonText = buttonText.includes('play') ||
      buttonText.includes('pause') ||
      buttonText.includes('resume') ||
      buttonText.includes('seek') ||
      buttonText.includes('replay');

    if (isVideoElement || (event.target.tagName === 'BUTTON' && isVideoButtonText)) {
      console.log('⏭️ Skipping click on video control - will record video event instead');
      return;
    }

    console.log('🖱️ Click event detected on:', event.target);
    console.log('🖱️ Element tag:', event.target.tagName);
    console.log('🖱️ Element text:', event.target.textContent?.substring(0, 50));
    console.log('🖱️ Element aria-label:', event.target.getAttribute('aria-label'));
    console.log('🖱️ Element data-testid:', event.target.getAttribute('data-testid'));

    const selector = getElementSelector(event.target);
    console.log('🖱️ Generated selector:', selector);

    if (!selector) {
      console.warn('⚠️ Could not generate selector for element:', event.target);
      return;
    }

    // Store additional info for better element finding during playback
    const textContent = event.target.textContent?.trim();
    const ariaLabel = event.target.getAttribute('aria-label');
    const dataTestId = event.target.getAttribute('data-testid');
    const role = event.target.getAttribute('role');
    const name = event.target.getAttribute('name');

    console.log('🖱️ Recording click action with selector:', selector);

    // Ensure selector is always a string
    const selectorString = typeof selector === 'string' ? selector : (selector?.value || String(selector));

    recordAction({
      type: 'click',
      selector: selectorString,
      value: null,
      // Additional metadata for better element finding
      text: textContent && textContent.length < 100 ? textContent : null,
      ariaLabel: ariaLabel || null,
      dataTestId: dataTestId || null,
      role: role || null,
      tagName: event.target.tagName || null,
      name: name || null,
      element: event.target
    });
  }

  function handleInput(event) {
    if (!isRecordingRecorder) return;
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      const selector = getElementSelector(event.target);
      if (!selector) return;

      recordAction({
        type: 'type',
        selector: selector,
        value: event.target.value,
        name: event.target.getAttribute('name'),
        tagName: event.target.tagName,
        element: event.target
      });
    }
  }

  function handleChange(event) {
    if (!isRecordingRecorder) return;

    const element = event.target;
    const selector = getElementSelector(element);
    if (!selector) return;

    let value = null;

    if (element.tagName === 'SELECT') {
      value = element.value;
      recordAction({
        type: 'select',
        selector: selector,
        value: value
      });
    } else if (element.type === 'checkbox' || element.type === 'radio') {
      recordAction({
        type: element.checked ? 'check' : 'uncheck',
        selector: selector,
        value: element.checked,
        element: element
      });
    }
  }

  function handleSubmit(event) {
    if (!isRecordingRecorder) return;

    const selector = getElementSelector(event.target);
    if (!selector) return;

    recordAction({
      type: 'submit',
      selector: selector,
      value: null,
      element: event.target
    });
  }

  function handleNavigation(event) {
    if (!isRecordingRecorder) return;

    // Record watch duration if video was playing when navigating away
    if (isVideoPlayingRecorder) {
      const watchDuration = (Date.now() - lastVideoPlayStartTime) / 1000;
      if (watchDuration > 0.1) {
        console.log(`⏱️ Recording final watch duration before navigation: ${watchDuration.toFixed(2)}s`);

        recordAction({
          type: 'watch',
          selector: 'video', // Generic fallback
          value: watchDuration
        });
      }
    }

    recordAction({
      type: 'navigate',
      selector: null,
      value: window.location.href
    });
  }

  function handleKeyDown(event) {
    if (!isRecordingRecorder) return;

    // Record special keys
    if (event.key === 'Enter' && event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') {
      const selector = getElementSelector(event.target);
      if (selector) {
        recordAction({
          type: 'keypress',
          selector: selector,
          value: event.key,
          element: event.target
        });
      }
    } else if (event.key === 'Escape') {
      recordAction({
        type: 'keypress',
        selector: 'document',
        value: event.key
      });
    }
  }

  function handleKeyPress(event) {
    if (!isRecordingRecorder) return;

    // Handle Enter key on form elements (triggers submission)
    if (event.key === 'Enter') {
      const target = event.target;

      // Check if this is in a form context
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') {
        // Find parent form
        let form = target.closest('form');

        if (form || target.type === 'submit') {
          console.log('⏎ Enter key on form element - recording as click/submit');
          const selector = getElementSelector(target);

          if (selector) {
            recordAction({
              type: 'click',
              selector: typeof selector === 'string' ? selector : (selector?.value || String(selector)),
              value: null,
              text: target.textContent?.trim() || null,
              ariaLabel: target.getAttribute('aria-label') || null,
              dataTestId: target.getAttribute('data-testid') || null,
              role: target.getAttribute('role') || null,
              tagName: target.tagName || null,
              element: target
            });
          }
        }
      }
    }
  }

  function handleFocus(event) {
    if (!isRecordingRecorder) return;

    // Record focus for important elements
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      const selector = getElementSelector(event.target);
      if (selector) {
        recordAction({
          type: 'focus',
          selector: selector,
          value: null,
          element: event.target
        });
      }
    }
  }

  // Throttle scroll events to avoid recording too many actions
  let scrollTimeout = null;
  let lastScrollTarget = null;
  let lastScrollPosition = { x: 0, y: 0 };

  function handleScroll(event) {
    if (!isRecordingRecorder) return;

    const target = event.target;

    // Clear previous timeout
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }

    // Throttle scroll events - only record after scrolling stops for 200ms
    scrollTimeout = setTimeout(() => {
      let scrollX, scrollY, selector;

      // Check if this is window/document scroll
      if (target === document || target === window || target === document.documentElement || target === document.body) {
        scrollX = window.scrollX || window.pageXOffset;
        scrollY = window.scrollY || window.pageYOffset;
        selector = 'window';
      } else {
        // Element scroll
        scrollX = target.scrollLeft;
        scrollY = target.scrollTop;
        selector = getElementSelector(target);

        if (!selector) return;
      }

      // Only record if scroll position actually changed
      if (lastScrollTarget !== selector ||
        lastScrollPosition.x !== scrollX ||
        lastScrollPosition.y !== scrollY) {

        lastScrollTarget = selector;
        lastScrollPosition = { x: scrollX, y: scrollY };

        console.log('📜 Recording scroll:', selector, { x: scrollX, y: scrollY });

        recordAction({
          type: 'scroll',
          selector: selector,
          value: { x: scrollX, y: scrollY },
          element: target !== window && target !== document ? target : null
        });
      }
    }, 200);
  }

  function handleVideoEvent(event) {
    if (!isRecordingRecorder) return;

    const video = event.target;
    if (video.tagName !== 'VIDEO') return;

    // Track watch duration
    if (event.type === 'play') {
      lastVideoPlayStartTime = Date.now();
      isVideoPlayingRecorder = true;
      console.log(`▶️ Video started playing at ${video.currentTime}`);
    }
    else if (event.type === 'pause' || event.type === 'seeking') {
      if (isVideoPlayingRecorder) {
        const watchDuration = (Date.now() - lastVideoPlayStartTime) / 1000;
        if (watchDuration > 0.1) { // Only record if it's more than a flicker
          console.log(`⏱️ Recording watch duration: ${watchDuration.toFixed(2)}s`);
          recordAction({
            type: 'watch',
            selector: getElementSelector(video),
            value: watchDuration,
            element: video
          });
        }

        if (event.type === 'pause') {
          isVideoPlayingRecorder = false;
        } else {
          // For 'seeking', it might continue playing, so we refresh the start time
          lastVideoPlayStartTime = Date.now();
        }
      }
    }

    // Record 'seeking', 'play', and 'pause' as primary actions with timestamps
    if (event.type === 'seeking' || event.type === 'play' || event.type === 'pause') {
      const actionType = event.type === 'seeking' ? 'seek' : event.type;

      console.log(`🎥 Recording video event: ${actionType} at ${video.currentTime}`);

      recordAction({
        type: actionType,
        selector: getElementSelector(video),
        value: video.currentTime,
        element: video
      });
    }
  }

  // ===== PIN POPUP DETECTION & PRIVACY PROTECTION =====

  // Detect if PIN popup is visible
  function isPinPopupVisibleRecorder() {
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
          return true;
        }
      }
    }
    return false;
  }

  // Start monitoring for PIN popup
  function startPinMonitoring() {
    console.log('🔒 Starting PIN popup monitoring for privacy protection');

    // Check immediately
    checkPinPopup();

    // Poll every 200ms for PIN popup
    pinPopupCheckInterval = setInterval(checkPinPopup, 200);
  }

  // Stop monitoring for PIN popup
  function stopPinMonitoring() {
    if (pinPopupCheckInterval) {
      clearInterval(pinPopupCheckInterval);
      pinPopupCheckInterval = null;
      console.log('🔒 Stopped PIN popup monitoring');
    }
  }

  // Check for PIN popup and update state
  function checkPinPopup() {
    const pinVisible = isPinPopupVisibleRecorder();

    // PIN popup just appeared
    if (pinVisible && !isPinPopupActive) {
      console.log('🔒 PIN popup appeared - PAUSING recording for privacy');
      console.log('🔒 No actions will be recorded until PIN is cleared');
      isPinPopupActive = true;
    }
    // PIN popup just disappeared
    else if (!pinVisible && isPinPopupActive) {
      console.log('✅ PIN popup cleared - RESUMING recording');
      isPinPopupActive = false;
    }
  }

  // ===== OTP PAGE DETECTION & PRIVACY PROTECTION =====

  // Detect if full-page OTP screen is visible
  function isOtpPageVisibleRecorder() {
    // Check for "Enter your 6-digit OTP" text anywhere on the page
    const bodyText = document.body?.textContent || '';
    const hasOtpText = bodyText.includes('Enter your 6-digit OTP');

    if (!hasOtpText) return false;

    // Also verify there's a Verify button visible (confirms it's an active OTP form)
    const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]');
    let hasVerifyButton = false;

    for (const btn of buttons) {
      const btnText = (btn.textContent || btn.value || '').toLowerCase();
      if (btnText.includes('verify')) {
        const style = window.getComputedStyle(btn);
        const isVisible = style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0';
        if (isVisible) {
          hasVerifyButton = true;
          break;
        }
      }
    }

    if (hasOtpText && hasVerifyButton) {
      console.log('🔐 OTP page detected (OTP text + Verify button)');
      return true;
    }

    return false;
  }

  // Start monitoring for OTP page
  function startOtpMonitoring() {
    console.log('🔐 Starting OTP page monitoring for privacy protection');

    // Check immediately
    checkOtpPage();

    // Poll every 200ms for OTP page
    otpPageCheckInterval = setInterval(checkOtpPage, 200);
  }

  // Stop monitoring for OTP page
  function stopOtpMonitoring() {
    if (otpPageCheckInterval) {
      clearInterval(otpPageCheckInterval);
      otpPageCheckInterval = null;
      console.log('🔐 Stopped OTP page monitoring');
    }
  }

  // Check for OTP page and update state
  function checkOtpPage() {
    const otpVisible = isOtpPageVisibleRecorder();

    // OTP page just appeared
    if (otpVisible && !isOtpPageActive) {
      console.log('🔐 OTP page appeared - PAUSING recording for privacy');
      console.log('🔐 No actions will be recorded until OTP is verified');
      console.log('🔐 Recording OTP checkpoint marker...');

      // Record a special checkpoint marker
      recordOtpCheckpoint();

      isOtpPageActive = true;
    }
    // OTP page just disappeared (verification complete)
    else if (!otpVisible && isOtpPageActive) {
      console.log('✅ OTP page cleared - RESUMING recording');
      isOtpPageActive = false;
    }
  }

  // Record OTP checkpoint marker (special action type)
  function recordOtpCheckpoint() {
    if (!isRecordingRecorder || !currentUuidRecorder) return;

    const checkpointAction = {
      index: actionIndexRecorder++,
      type: 'otp_checkpoint',
      selector: null,
      value: 'Enter your 6-digit OTP',
      url: window.location.href
    };

    console.log('🔐 Recording OTP checkpoint:', checkpointAction);

    // Send checkpoint to background
    chrome.runtime.sendMessage({
      action: 'recordedAction',
      uuid: currentUuidRecorder,
      recordedAction: checkpointAction
    })
      .then(() => {
        console.log('✅ OTP checkpoint sent successfully');
      })
      .catch(err => {
        console.error('❌ Failed to send OTP checkpoint:', err.message);
      });
  }

  // ===== RECORD / PAUSE CONTROL UI =====

  function injectControlUI() {
    if (controlUI) return;

    console.log('🎨 Injecting Record / Pause control UI');

    controlUI = document.createElement('div');
    controlUI.id = 'antigravity-recorder-control';
    Object.assign(controlUI.style, {
      position: 'fixed',
      top: '10px',
      right: '10px',
      zIndex: '2147483647',
      backgroundColor: '#f44336',
      color: 'white',
      padding: '8px 16px',
      borderRadius: '24px',
      cursor: 'move',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '14px',
      fontWeight: 'bold',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      userSelect: 'none',
      transition: 'background-color 0.2s, transform 0.1s'
    });

    updateControlUI();

    // DRAGGING LOGIC
    let isDragging = false;
    let startX, startY;
    let initialRight, initialTop;
    let hasMoved = false;

    controlUI.onmousedown = (e) => {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = controlUI.getBoundingClientRect();
      initialRight = window.innerWidth - rect.right;
      initialTop = rect.top;

      controlUI.style.transition = 'none'; // Disable transition during drag

      document.onmousemove = (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          hasMoved = true;
        }

        const newRight = initialRight - dx;
        const newTop = initialTop + dy;

        controlUI.style.right = `${newRight}px`;
        controlUI.style.top = `${newTop}px`;
      };

      document.onmouseup = () => {
        isDragging = false;
        controlUI.style.transition = 'background-color 0.2s, transform 0.1s';
        document.onmousemove = null;
        document.onmouseup = null;
      };

      // Prevent text selection
      e.preventDefault();
    };

    controlUI.onclick = (e) => {
      // Only toggle if it wasn't a drag operation
      if (!hasMoved) {
        togglePause();
      }
      e.stopPropagation();
      e.preventDefault();
    };

    document.documentElement.appendChild(controlUI);
  }

  function updateControlUI() {
    if (!controlUI) return;

    if (isPausedRecorder) {
      controlUI.innerHTML = '<span>⏸️</span> Paused / Resume';
      controlUI.style.backgroundColor = '#ff9800';
    } else {
      controlUI.innerHTML = '<span>🔴</span> Recording / Pause';
      controlUI.style.backgroundColor = '#f44336';
    }
  }

  function removeControlUI() {
    if (controlUI) {
      controlUI.remove();
      controlUI = null;
    }
  }

  function togglePause() {
    chrome.runtime.sendMessage({
      action: 'togglePause',
      uuid: currentUuidRecorder
    }).then(response => {
      if (response && response.success) {
        isPausedRecorder = response.isPaused;
        updateControlUI();
        console.log(`⏸️ Recording ${isPausedRecorder ? 'PAUSED' : 'RESUMED'}`);
      }
    }).catch(err => {
      console.error('❌ Failed to toggle pause:', err);
    });
  }

  function getBestElementLabel(el) {
    if (!el) return null;

    // 1. Try common label attributes
    const labelAttrs = ['aria-label', 'title', 'placeholder', 'alt'];
    for (const attr of labelAttrs) {
      const val = el.getAttribute(attr);
      if (val && val.trim()) return val.trim();
    }

    // 2. Try text content for non-input elements or buttons
    if (el.tagName !== 'INPUT' || (el.type === 'button' || el.type === 'submit')) {
      const text = el.innerText || el.textContent;
      if (text && text.trim() && text.trim().length < 100) {
        return text.trim();
      }
    }

    // 3. Try value for button-like inputs
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit' || el.type === 'reset')) {
      if (el.value && el.value.trim()) return el.value.trim();
    }

    // 4. Try linked label for inputs
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) {
        const labelText = label.innerText || label.textContent;
        if (labelText && labelText.trim()) return labelText.trim();
      }
    }

    // 5. Try parent label
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const labelText = parentLabel.innerText || parentLabel.textContent;
      if (labelText && labelText.trim()) return labelText.trim();
    }

    // 6. Fallback to name attribute or type
    return el.getAttribute('name') || el.id || el.tagName.toLowerCase();
  }

})(); // End of IIFE to prevent duplicate execution

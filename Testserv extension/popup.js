// Popup script - shows extension status

const statusDiv = document.getElementById('status');
const extensionIdSpan = document.getElementById('extensionId');
const detailsDiv = document.getElementById('details');
const testBtn = document.getElementById('testBtn');

// Get extension ID
const extensionId = chrome.runtime.id;
extensionIdSpan.textContent = extensionId || 'Not available';

console.log('Popup opened, extension ID:', extensionId);

// Test service worker
async function testServiceWorker() {
  detailsDiv.textContent = 'Testing...';
  statusDiv.className = 'status inactive';
  statusDiv.textContent = '⏳ Testing Service Worker...';
  
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'getRecordingStatus', uuid: 'test' },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });
    
    statusDiv.className = 'status active';
    statusDiv.textContent = '✅ Service Worker: ACTIVE';
    detailsDiv.textContent = `Response: ${JSON.stringify(response)}`;
    console.log('Service worker test successful:', response);
  } catch (error) {
    statusDiv.className = 'status inactive';
    statusDiv.textContent = '❌ Service Worker: ERROR';
    detailsDiv.textContent = `Error: ${error.message}`;
    console.error('Service worker test failed:', error);
  }
}

// Test on load
testServiceWorker();

// Test on button click
testBtn.addEventListener('click', testServiceWorker);

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Popup received message:', message);
  if (message.type === 'serviceWorkerStatus') {
    if (message.active) {
      statusDiv.className = 'status active';
      statusDiv.textContent = '✅ Service Worker: ACTIVE';
    } else {
      statusDiv.className = 'status inactive';
      statusDiv.textContent = '❌ Service Worker: INACTIVE';
    }
  }
});

// Update status every 2 seconds
setInterval(testServiceWorker, 2000);

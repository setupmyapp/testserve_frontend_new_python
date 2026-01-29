# Record & Playback Testing Extension

A Chrome extension for recording user actions and playing them back for automated testing.

## Features

- ✅ Record user actions (clicks, inputs, form submissions, navigation)
- ✅ Playback recorded actions in a new browser window
- ✅ Store scripts locally
- ✅ Standalone HTML control page
- ✅ UUID-based script management

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select this extension directory

## Usage

### Using the Control Page

1. Open `control.html` in your browser (you can open it directly from the extension folder)
2. Enter the URL you want to record/play
3. Enter a unique UUID (or use the auto-generated one)
4. Click "Start Recording" - a new browser window will open
5. Interact with the page in the new window
6. Click "Stop Recording" - the script will appear in the control page
7. Click "Play Script" to replay the recorded actions

### Control Page Features

- **Start Recording**: Opens a new browser window and starts recording all actions
- **Stop Recording**: Stops recording and displays the script in JSON format
- **Play Script**: Opens a new browser window and replays the recorded actions
- **Clear Script**: Clears the displayed script

## Usage

### In Your React App

1. Copy `react-integration.js` to your React project
2. Import the functions:

```javascript
import { startRecording, stopRecording, startPlayback } from './react-integration';
```

3. Start recording:

```javascript
// Generate a unique UUID
const uuid = 'test-' + Date.now();

// Start recording
await startRecording('https://example.com', uuid);
```

4. Stop recording and get script:

```javascript
// Stop recording
const { script } = await stopRecording(uuid);

// Send to backend
await fetch('/api/save-script', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ uuid, script })
});
```

5. Playback later:

```javascript
// Fetch script from backend
const response = await fetch(`/api/get-script/${uuid}`);
const { script } = await response.json();

// Start playback
await startPlayback(uuid, script);
```

## Script Format

The recorded script has the following structure:

```json
{
  "uuid": "unique-id",
  "url": "https://example.com",
  "actions": [
    {
      "index": 0,
      "type": "click",
      "selector": "#button",
      "value": null,
      "delay": 1000,
      "timestamp": 1234567890,
      "url": "https://example.com"
    },
    {
      "index": 1,
      "type": "type",
      "selector": "#input",
      "value": "Hello World",
      "delay": 500,
      "timestamp": 1234568390,
      "url": "https://example.com"
    }
  ],
  "startTime": 1234567890
}
```

## Action Types

- `click` - Click on an element
- `type` - Type text into an input/textarea
- `select` - Select an option in a dropdown
- `check` - Check a checkbox
- `uncheck` - Uncheck a checkbox
- `submit` - Submit a form
- `navigate` - Navigate to a URL
- `keypress` - Press a key
- `focus` - Focus on an element

## Architecture

- **background.js** - Service worker that manages windows and coordinates recording/playback
- **content-recorder.js** - Records user actions on the page
- **content-player.js** - Plays back recorded actions
- **react-integration.js** - Helper functions for React app integration

## Permissions

The extension requires:
- `windows` - To create new browser windows
- `tabs` - To manage tabs
- `storage` - To store recorded scripts
- `scripting` - To inject content scripts
- `activeTab` - To access active tab
- `<all_urls>` - To work on any website

## Notes

- Scripts are stored in Chrome's local storage
- Each recording/playback uses a unique UUID
- The extension opens a new browser window (not tab) for isolation
- Selectors are generated automatically and may need adjustment for dynamic content

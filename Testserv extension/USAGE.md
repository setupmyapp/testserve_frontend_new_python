# How to Use the Control Page

## Quick Start

1. **Install the Extension**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (top right toggle)
   - Click "Load unpacked"
   - Select the extension folder

2. **Open the Control Page**
   
   ⚠️ **IMPORTANT:** You MUST run a local server. Opening the file directly won't work due to Chrome security restrictions.
   
   **Option A: Use the provided script (Easiest)**
   - On Mac/Linux: Run `./start-server.sh` in the extension folder
   - On Windows: Double-click `start-server.bat`
   - Then open `http://localhost:8000/control.html` in Chrome
   
   **Option B: Manual server setup**
   - Open terminal/command prompt in the extension folder
   - Run: `python3 -m http.server 8000` (or `python -m http.server 8000`)
   - Or with Node.js: `npx http-server -p 8000`
   - Then open `http://localhost:8000/control.html` in Chrome

3. **Use the Control Page**
   - Enter a URL (e.g., `https://example.com`)
   - Enter a UUID (or use the auto-generated one)
   - Click "Start Recording" - a new browser window opens
   - Interact with the page in that window
   - Click "Stop Recording" - see the script appear
   - Click "Play Script" to replay the actions

## Troubleshooting

- **"Extension not detected"**: Make sure the extension is installed and enabled in `chrome://extensions/`
- **Messages not working**: Try reloading the control page after installing the extension
- **Script not showing**: Make sure you clicked "Stop Recording" before the script appears

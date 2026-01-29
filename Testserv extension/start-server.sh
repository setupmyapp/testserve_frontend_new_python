#!/bin/bash

# Simple HTTP server to run the control page
# This allows the extension to communicate with the control page

echo "Starting local server..."
echo "Open http://localhost:8000/control.html in Chrome"
echo "Press Ctrl+C to stop the server"
echo ""

# Check if Python 3 is available
if command -v python3 &> /dev/null; then
    python3 -m http.server 8000
# Check if Python 2 is available
elif command -v python &> /dev/null; then
    python -m SimpleHTTPServer 8000
else
    echo "Python not found. Please install Python or use Node.js:"
    echo "  npx http-server -p 8000"
    exit 1
fi

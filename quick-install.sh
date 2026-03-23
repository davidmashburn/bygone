#!/bin/bash

echo "🛠️  One-line VS Code extension setup..."

# Check if we're in VS Code CLI context
if command -v code &> /dev/null; then
    echo "✅ VS Code CLI found"
else
    echo "❌ VS Code CLI not found. Install it from VS Code: Shell Command: Install 'code' command in PATH"
    exit 1
fi

# Install dependencies and compile
npm install && npm run compile

if [ $? -eq 0 ]; then
    echo "🚀 Starting extension in development mode..."
    code --install-extension . --force
    echo "✅ Extension installed! Restart VS Code to use it."
else
    echo "❌ Build failed"
    exit 1
fi
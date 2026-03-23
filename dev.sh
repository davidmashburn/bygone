#!/bin/bash

echo "🔧 Quick dev mode - Run extension in development environment..."

# Step 1: Install dependencies if not already installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Step 2: Compile TypeScript
echo "🔨 Compiling TypeScript..."
npm run compile

if [ $? -ne 0 ]; then
    echo "❌ Failed to compile TypeScript"
    exit 1
fi

echo "✅ Ready for development!"
echo ""
echo "🚀 To run the extension:"
echo "   1. Open this folder in VS Code"
echo "   2. Press F5 (or Run → Start Debugging)"
echo "   3. This will open a new VS Code window with your extension loaded"
echo ""
echo "🧪 To test the extension:"
echo "   1. In the new VS Code window, press Ctrl+Shift+P"
echo "   2. Type 'Melden: Compare Files'"
echo "   3. Select two files to compare with bezier curve connections"
echo ""
echo "💡 Tip: Use the Step Over/Continue buttons in the debug toolbar to reload changes"
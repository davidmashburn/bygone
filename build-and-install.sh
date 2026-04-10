#!/bin/bash

echo "🚀 Building and Installing Bygone VS Code Extension..."

# Step 1: Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Step 2: Compile TypeScript
echo "🔨 Compiling TypeScript..."
npm run compile

if [ $? -ne 0 ]; then
    echo "❌ Failed to compile TypeScript"
    exit 1
fi

# Step 3: Create extension package
echo "📦 Creating extension package..."
npx vsce package

if [ $? -ne 0 ]; then
    echo "⚠️  vsce not found, installing it..."
    npm install -g vsce
    npx vsce package
fi

echo "✅ Build completed successfully!"

# Step 4: Show installation options
echo ""
echo "🎯 Extension built! Choose an installation method:"
echo ""
echo "Option 1: Install from VSIX file"
echo "   1. Open VS Code"
echo "   2. Press Ctrl+Shift+P"
echo "   3. Type 'Extensions: Install from VSIX'"
echo "   4. Select the .vsix file in this directory"
echo ""
echo "Option 2: Run in development mode"
echo "   1. Open this folder in VS Code"
echo "   2. Press F5 to launch extension development host"
echo ""
echo "Option 3: Install globally (requires code CLI)"
echo "   code --install-extension bygone-*.vsix"
echo ""

# List created files
echo "📁 Build artifacts:"
ls -la *.vsix 2>/dev/null || echo "   (No VSIX file created)"
echo ""
echo "📁 Compiled files:"
ls -la out/
echo ""
echo "📁 Media assets:"
ls -la media/

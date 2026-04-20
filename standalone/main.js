const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { buildTwoWayDiffModel } = require('../src/diffEngine.ts');
const { GitHistoryService } = require('../src/gitHistory.ts');
const { createJavaScriptSampleFilePair } = require('../src/sampleFiles.ts');
const { buildMultiDirectoryComparison } = require('../src/directoryDiff.ts');

const APP_NAME = 'Bygone';
const HELP_URL = 'https://github.com/davidmashburn/bygone';
const gitHistoryService = new GitHistoryService();
const launchArguments = parseLaunchArgs(getCliArgs());
const smokeTestMode = launchArguments.kind === 'smoke';
const shouldUseSingleInstanceLock = launchArguments.kind === 'empty';

app.setName(APP_NAME);
if (typeof app.setAppUserModelId === 'function') {
    app.setAppUserModelId('com.davidmashburn.bygone');
}

const singleInstanceLock = shouldUseSingleInstanceLock ? app.requestSingleInstanceLock() : true;

let mainWindow;
let hostReady = false;
let pendingMessage;
let closingForSave = false;
let fileWatchers = [];
let session = createEmptySession();
let smokeTimeout;
let pendingOpenPaths = [];

if (!singleInstanceLock) {
    app.quit();
}

app.whenReady().then(async () => {
    createMainWindow();
    installApplicationMenu();
    await openInitialLaunchTarget();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        installApplicationMenu();
        await openInitialLaunchTarget();
    }
});

if (shouldUseSingleInstanceLock) {
    app.on('second-instance', (_event, argv) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
        }

        void routeLaunchTarget(parseLaunchArgs(getCliArgsFromArgv(argv)));
    });
}

app.on('open-file', (event, filePath) => {
    event.preventDefault();
    pendingOpenPaths.push(filePath);

    if (app.isReady()) {
        if (!mainWindow) {
            createMainWindow();
            installApplicationMenu();
        }

        void routePendingOpenPaths();
    }
});

ipcMain.on('bygone:renderer-message', async (_event, message) => {
    await handleRendererMessage(message);
});

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 960,
        minWidth: 960,
        minHeight: 640,
        show: !smokeTestMode,
        title: APP_NAME,
        webPreferences: {
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'standalone-preload.js')
        }
    });

    hostReady = false;
    pendingMessage = undefined;
    void mainWindow.loadFile(path.join(__dirname, '..', 'standalone', 'index.html'));

    if (smokeTestMode) {
        smokeTimeout = setTimeout(() => {
            console.error('Bygone smoke test timed out before renderer became ready.');
            process.exitCode = 1;
            app.exit(1);
        }, 10000);
    }

    mainWindow.webContents.on('did-finish-load', () => {
        if (smokeTestMode) {
            console.log('Bygone standalone window finished loading.');
        }
    });

    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (smokeTestMode) {
            console.log(`Renderer console [${level}] ${sourceId}:${line} ${message}`);
        }
    });

    mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
        console.error(`Bygone standalone load failed (${code}): ${description}`);
        if (smokeTestMode) {
            process.exitCode = 1;
            app.exit(1);
        }
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error(`Bygone renderer process exited: ${details.reason}`);
        if (smokeTestMode) {
            process.exitCode = 1;
            app.exit(1);
        }
    });

    mainWindow.on('close', async (event) => {
        if (closingForSave || !hasUnsavedChanges()) {
            return;
        }

        event.preventDefault();
        const choice = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['Save All', 'Discard', 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            message: 'You have unsaved Bygone edits.',
            detail: 'Save both panes before closing, discard changes, or cancel.'
        });

        if (choice.response === 0) {
            const saved = await saveAllDirtySides();
            if (!saved) {
                return;
            }

            closingForSave = true;
            mainWindow.close();
            return;
        }

        if (choice.response === 1) {
            closingForSave = true;
            mainWindow.close();
        }
    });

    mainWindow.on('closed', () => {
        clearWatchers();
        mainWindow = undefined;
        session = createEmptySession();
        closingForSave = false;
        clearTimeout(smokeTimeout);
        smokeTimeout = undefined;
    });
}

function installApplicationMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Compare Files…',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => { void openCompareFilesDialog(); }
                },
                {
                    label: 'Compare Directories…',
                    accelerator: 'CmdOrCtrl+Shift+O',
                    click: () => { void openCompareDirectoriesDialog(); }
                },
                {
                    label: 'Compare Three Files (Prototype)…',
                    click: () => { void openCompareThreeFilesDialog(); }
                },
                {
                    label: 'Compare Three Directories (Prototype)…',
                    click: () => { void openCompareThreeDirectoriesDialog(); }
                },
                {
                    label: 'Compare File History…',
                    accelerator: 'CmdOrCtrl+Shift+H',
                    click: () => { void openHistoryDialog(); }
                },
                {
                    label: 'Compare Test Files',
                    accelerator: 'CmdOrCtrl+Shift+T',
                    click: () => { void compareTestFiles(); }
                },
                { type: 'separator' },
                {
                    label: 'Save Left',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => { void saveSide('left'); }
                },
                {
                    label: 'Save Right',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: () => { void saveSide('right'); }
                },
                {
                    label: 'Reload Left',
                    click: () => { void reloadSide('left'); }
                },
                {
                    label: 'Reload Right',
                    click: () => { void reloadSide('right'); }
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'History',
            submenu: [
                {
                    label: 'Older Commit',
                    accelerator: 'Alt+Left',
                    click: () => { void navigateHistory('back'); }
                },
                {
                    label: 'Newer Commit',
                    accelerator: 'Alt+Right',
                    click: () => { void navigateHistory('forward'); }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Bygone on GitHub',
                    click: () => { void shell.openExternal(HELP_URL); }
                },
                {
                    label: 'Install VS Code Extension',
                    click: async () => {
                        await shell.openExternal('vscode:extension/davidmashburn.bygone');
                    }
                }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openInitialLaunchTarget() {
    if (pendingOpenPaths.length > 0) {
        await routePendingOpenPaths();
        return;
    }

    await routeLaunchTarget(launchArguments);
}

async function routeLaunchTarget(launchTarget) {
    if (launchTarget.kind === 'empty') {
        return;
    }

    if (launchTarget.kind === 'diff') {
        await openPathPair(launchTarget.leftPath, launchTarget.rightPath, 'diff');
        return;
    }

    if (launchTarget.kind === 'directory') {
        await openPathPair(launchTarget.leftPath, launchTarget.rightPath, 'directory');
        return;
    }

    if (launchTarget.kind === 'multi-directory') {
        await openDirectories(launchTarget.paths);
        return;
    }

    if (launchTarget.kind === 'pair') {
        await openPathPair(launchTarget.leftPath, launchTarget.rightPath, 'auto');
        return;
    }

    if (launchTarget.kind === 'history') {
        await openHistory(launchTarget.filePath);
        return;
    }

    if (launchTarget.kind === 'multi-diff') {
        await openMultiDiff(launchTarget.paths);
        return;
    }

    if (launchTarget.kind === 'test' || launchTarget.kind === 'smoke') {
        await compareTestFiles();
    }
}

function getCliArgs() {
    return getCliArgsFromArgv(process.argv);
}

function getCliArgsFromArgv(argv) {
    const args = process.defaultApp ? argv.slice(2) : argv.slice(1);
    return args[0]?.endsWith('standalone-main.js') ? args.slice(1) : args;
}

function parseLaunchArgs(args) {
    if (args[0] === '--diff' && args.length >= 3) {
        return { kind: 'diff', leftPath: args[1], rightPath: args[2] };
    }

    if (args[0] === '--dir' && args.length >= 3) {
        return { kind: 'directory', leftPath: args[1], rightPath: args[2] };
    }

    if (args[0] === '--dir3' && args.length >= 4) {
        return { kind: 'multi-directory', paths: args.slice(1, 4) };
    }

    if (args[0] === '--diff3' && args.length >= 4) {
        return { kind: 'multi-diff', paths: args.slice(1, 4) };
    }

    if (args[0] === '--history' && args.length >= 2) {
        return { kind: 'history', filePath: args[1] };
    }

    if (args[0] === '--test') {
        return { kind: 'test' };
    }

    if (args[0] === '--smoke-test') {
        return { kind: 'smoke' };
    }

    if (args.length >= 2 && !args[0].startsWith('--')) {
        return { kind: 'pair', leftPath: args[0], rightPath: args[1] };
    }

    return { kind: 'empty' };
}

async function routePendingOpenPaths() {
    const paths = pendingOpenPaths;
    pendingOpenPaths = [];
    await openDroppedFiles(paths);
}

async function handleRendererMessage(message) {
    if (!message || typeof message !== 'object') {
        return;
    }

    if (message.type === 'ready') {
        hostReady = true;

        if (pendingMessage) {
            postToRenderer(pendingMessage);
            pendingMessage = undefined;
        } else {
            await sendCurrentSession();
        }
        return;
    }

    if (message.type === 'recomputeDiff' && session.mode === 'diff') {
        session.left.content = message.leftContent;
        session.right.content = message.rightContent;
        session.left.dirty = session.left.content !== session.left.savedContent;
        session.right.dirty = session.right.content !== session.right.savedContent;
        await sendCurrentDiff();
        return;
    }

    if (message.type === 'openDroppedFiles' && Array.isArray(message.paths)) {
        await openDroppedFiles(message.paths);
        return;
    }

    if (message.type === 'openDirectoryEntry' && typeof message.relativePath === 'string') {
        await openDirectoryEntry(message.relativePath);
        return;
    }

    if (message.type === 'historyBack') {
        await navigateHistory('back');
        return;
    }

    if (message.type === 'historyForward') {
        await navigateHistory('forward');
    }
}

async function openCompareFilesDialog() {
    if (!mainWindow) {
        return;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select two files to compare',
        properties: ['openFile', 'multiSelections']
    });

    if (result.canceled || result.filePaths.length < 2) {
        return;
    }

    await openDiff(result.filePaths[0], result.filePaths[1]);
}

async function openDroppedFiles(paths) {
    const normalizedPaths = paths
        .filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
        .map((candidate) => path.resolve(candidate))
        .filter((candidate, index, all) => all.indexOf(candidate) === index);

    if (normalizedPaths.length === 1) {
        await openHistory(normalizedPaths[0]);
        return;
    }

    if (normalizedPaths.length === 2) {
        await openPathPair(normalizedPaths[0], normalizedPaths[1], 'auto');
        return;
    }

    if (normalizedPaths.length === 3) {
        const kinds = normalizedPaths.map((candidate) => getPathKind(candidate));
        if (kinds.every((kind) => kind === 'directory')) {
            await openDirectories(normalizedPaths);
            return;
        }

        if (kinds.every((kind) => kind === 'file')) {
            await openMultiDiff(normalizedPaths);
            return;
        }

        await showInfo('Drop three files for 3-panel diff or three directories for directory compare.');
        return;
    }

    await showInfo('Drop one file for history, two files or directories for compare, or three files/directories for 3-panel compare.');
}

async function openHistoryDialog() {
    if (!mainWindow) {
        return;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select file for git history',
        properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
        return;
    }

    await openHistory(result.filePaths[0]);
}

async function openCompareThreeFilesDialog() {
    if (!mainWindow) {
        return;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select three files to compare',
        properties: ['openFile', 'multiSelections']
    });

    if (result.canceled || result.filePaths.length < 3) {
        return;
    }

    await openMultiDiff(result.filePaths.slice(0, 3));
}

async function openCompareThreeDirectoriesDialog() {
    if (!mainWindow) {
        return;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select three directories to compare',
        properties: ['openDirectory', 'multiSelections']
    });

    if (result.canceled || result.filePaths.length < 3) {
        return;
    }

    await openDirectories(result.filePaths.slice(0, 3));
}

async function openCompareDirectoriesDialog() {
    if (!mainWindow) {
        return;
    }

    const left = await dialog.showOpenDialog(mainWindow, {
        title: 'Select left directory to compare',
        properties: ['openDirectory']
    });

    if (left.canceled || left.filePaths.length === 0) {
        return;
    }

    const right = await dialog.showOpenDialog(mainWindow, {
        title: 'Select right directory to compare',
        properties: ['openDirectory']
    });

    if (right.canceled || right.filePaths.length === 0) {
        return;
    }

    await openDirectories([left.filePaths[0], right.filePaths[0]]);
}

async function openDirectory(leftDir, rightDir) {
    await openDirectories([leftDir, rightDir]);
}

async function openDirectories(dirs) {
    const resolvedDirs = dirs.map((dir) => path.resolve(dir));
    if (resolvedDirs.length < 2 || !resolvedDirs.every((dir) => getPathKind(dir) === 'directory')) {
        await showInfo('Directory compare requires directories.');
        return;
    }

    session = {
        mode: 'directory',
        left: createSideState(resolvedDirs[0], ''),
        right: createSideState(resolvedDirs[1], ''),
        history: null,
        directory: {
            dirs: resolvedDirs,
            labels: resolvedDirs.map((dir) => path.basename(dir))
        },
        multi: null
    };

    clearWatchers();
    await sendCurrentDirectoryDiff();
}

async function sendCurrentDirectoryDiff() {
    if (session.mode !== 'directory' || !session.directory) {
        return;
    }

    const entries = buildMultiDirectoryComparison(session.directory.dirs);

    postOrQueue({
        type: 'showDirectoryDiff',
        leftLabel: session.directory.labels[0],
        rightLabel: session.directory.labels[1],
        labels: session.directory.labels,
        entries
    });

    updateWindowTitle(session.directory.labels.join(' ↔ '));
}

async function openDiff(leftPath, rightPath) {
    const resolvedLeft = path.resolve(leftPath);
    const resolvedRight = path.resolve(rightPath);
    const leftContent = readFileContent(resolvedLeft);
    const rightContent = readFileContent(resolvedRight);

    session = {
        mode: 'diff',
        left: createSideState(resolvedLeft, leftContent),
        right: createSideState(resolvedRight, rightContent),
        history: null,
        directory: null,
        multi: null
    };

    updateWatchers();
    await sendCurrentDiff();
}

async function openHistory(filePath) {
    const resolvedPath = path.resolve(filePath);
    let entries;

    try {
        entries = gitHistoryService.buildFileHistory(resolvedPath);
    } catch (error) {
        await showError(`Error loading file history: ${getErrorMessage(error)}`);
        return;
    }

    if (entries.length === 0) {
        await showInfo('No git history with parents was found for that file.');
        return;
    }

    session = {
        mode: 'history',
        left: createSideState('', ''),
        right: createSideState('', ''),
        history: {
            filePath: resolvedPath,
            entries,
            index: 0
        },
        directory: null,
        multi: null
    };

    clearWatchers();
    await sendCurrentHistoryEntry();
}

async function openPathPair(leftPath, rightPath, expectedMode) {
    const resolvedLeft = path.resolve(leftPath);
    const resolvedRight = path.resolve(rightPath);
    const leftKind = getPathKind(resolvedLeft);
    const rightKind = getPathKind(resolvedRight);

    if (expectedMode === 'directory') {
        if (leftKind === 'directory' && rightKind === 'directory') {
            await openDirectories([resolvedLeft, resolvedRight]);
            return;
        }

        await showInfo('Directory compare requires two directories.');
        return;
    }

    if (expectedMode === 'diff') {
        if (leftKind === 'file' && rightKind === 'file') {
            await openDiff(resolvedLeft, resolvedRight);
            return;
        }

        await showInfo('File compare requires two files.');
        return;
    }

    if (leftKind === 'directory' && rightKind === 'directory') {
        await openDirectories([resolvedLeft, resolvedRight]);
        return;
    }

    if (leftKind === 'file' && rightKind === 'file') {
        await openDiff(resolvedLeft, resolvedRight);
        return;
    }

    await showInfo('Select two files for diff or two directories for directory compare.');
}

async function openMultiDiff(filePaths) {
    const resolvedPaths = filePaths.map((filePath) => path.resolve(filePath));
    if (resolvedPaths.length < 3 || !resolvedPaths.every((filePath) => getPathKind(filePath) === 'file')) {
        await showInfo('Three-file compare requires three files.');
        return;
    }

    session = {
        mode: 'multi-diff',
        left: createSideState('', ''),
        right: createSideState('', ''),
        history: null,
        directory: null,
        multi: {
            files: resolvedPaths.map((filePath) => ({
                path: filePath,
                label: path.basename(filePath),
                content: readFileContent(filePath)
            }))
        }
    };

    clearWatchers();
    await sendCurrentMultiDiff();
}

async function openDirectoryEntry(relativePath) {
    if (session.mode !== 'directory' || !session.directory || relativePath.endsWith('/')) {
        return;
    }

    const files = session.directory.dirs
        .map((dir) => path.join(dir, relativePath))
        .filter((filePath) => getPathKind(filePath) === 'file');

    if (files.length < 2) {
        await showInfo('That entry only exists on one side.');
        return;
    }

    if (files.length === 2) {
        await openDiff(files[0], files[1]);
        return;
    }

    await openMultiDiff(files);
}

async function sendCurrentMultiDiff() {
    if (session.mode !== 'multi-diff' || !session.multi) {
        return;
    }

    const panels = session.multi.files.map((file) => ({
        label: file.label,
        content: file.content
    }));

    postOrQueue({
        type: 'showMultiDiff',
        panels,
        pairs: panels.slice(0, -1).map((panel, index) => ({
            leftIndex: index,
            rightIndex: index + 1,
            diffModel: buildTwoWayDiffModel(panel.content, panels[index + 1].content)
        }))
    });

    updateWindowTitle(panels.map((panel) => panel.label).join(' ↔ '));
}

async function sendCurrentSession() {
    if (session.mode === 'diff') {
        await sendCurrentDiff();
        return;
    }

    if (session.mode === 'history') {
        await sendCurrentHistoryEntry();
        return;
    }

    if (session.mode === 'directory') {
        await sendCurrentDirectoryDiff();
        return;
    }

    if (session.mode === 'multi-diff') {
        await sendCurrentMultiDiff();
    }
}

async function compareTestFiles() {
    const sampleFiles = createJavaScriptSampleFilePair();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-'));
    const leftPath = path.join(directory, sampleFiles.leftFileName);
    const rightPath = path.join(directory, sampleFiles.rightFileName);

    fs.writeFileSync(leftPath, sampleFiles.leftContent, 'utf8');
    fs.writeFileSync(rightPath, sampleFiles.rightContent, 'utf8');

    await openDiff(leftPath, rightPath);
}

async function sendCurrentDiff() {
    if (session.mode !== 'diff') {
        return;
    }

    const diffModel = buildTwoWayDiffModel(session.left.content, session.right.content);
    const message = {
        type: 'showDiff',
        file1: session.left.label,
        file2: session.right.label,
        leftContent: session.left.content,
        rightContent: session.right.content,
        diffModel,
        history: null
    };

    postOrQueue(message);
    updateWindowTitle(`${session.left.label} ↔ ${session.right.label}`);

    if (mainWindow && !mainWindow.isDestroyed()) {
        setTimeout(() => {
            void mainWindow.webContents.executeJavaScript(`(() => ({
                fileInfo: document.getElementById('file-info')?.textContent,
                file1: document.getElementById('file1-header')?.textContent,
                file2: document.getElementById('file2-header')?.textContent
            }))()`)
                .then((snapshot) => {
                    if (smokeTestMode) {
                        finalizeSmokeTest(snapshot);
                    }
                })
                .catch((error) => {
                    if (smokeTestMode) {
                        console.error(`Bygone smoke test failed: ${getErrorMessage(error)}`);
                        process.exitCode = 1;
                        app.exit(1);
                    }
                });
        }, 400);
    }
}

async function sendCurrentHistoryEntry() {
    if (session.mode !== 'history' || !session.history) {
        return;
    }

    const entry = session.history.entries[session.history.index];
    const fileName = path.basename(session.history.filePath);
    const diffModel = buildTwoWayDiffModel(entry.leftContent, entry.rightContent);

    postOrQueue({
        type: 'showDiff',
        file1: entry.leftLabel,
        file2: entry.rightLabel,
        leftContent: entry.leftContent,
        rightContent: entry.rightContent,
        diffModel,
        history: {
            fileName,
            canGoBack: session.history.index < session.history.entries.length - 1,
            canGoForward: session.history.index > 0,
            positionLabel: `${session.history.index + 1} / ${session.history.entries.length}`,
            leftCommitLabel: `${entry.parentCommit.slice(0, 7)} ${entry.parentSummary}`.trim(),
            leftTimestamp: entry.parentTimestamp,
            rightCommitLabel: `${entry.shortCommit} ${entry.summary}`.trim(),
            rightTimestamp: entry.timestamp
        }
    });

    updateWindowTitle(`${fileName} History`);
}

async function navigateHistory(direction) {
    if (session.mode !== 'history' || !session.history) {
        return;
    }

    if (direction === 'back' && session.history.index < session.history.entries.length - 1) {
        session.history.index += 1;
    } else if (direction === 'forward' && session.history.index > 0) {
        session.history.index -= 1;
    } else {
        return;
    }

    await sendCurrentHistoryEntry();
}

async function saveSide(side) {
    if (session.mode !== 'diff') {
        return;
    }

    const target = session[side];
    let targetPath = target.path;

    if (!targetPath) {
        if (!mainWindow) {
            return;
        }

        const result = await dialog.showSaveDialog(mainWindow, {
            title: `Save ${side === 'left' ? 'left' : 'right'} file`,
            defaultPath: `${target.label || side}.txt`
        });

        if (result.canceled || !result.filePath) {
            return false;
        }

        targetPath = result.filePath;
    }

    fs.writeFileSync(targetPath, target.content, 'utf8');
    target.path = targetPath;
    target.label = path.basename(targetPath);
    target.savedContent = target.content;
    target.dirty = false;
    updateWatchers();
    await sendCurrentDiff();
    return true;
}

async function saveAllDirtySides() {
    if (session.mode !== 'diff') {
        return true;
    }

    if (session.left.dirty) {
        const result = await saveSide('left');
        if (!result) {
            return false;
        }
    }

    if (session.right.dirty) {
        const result = await saveSide('right');
        if (!result) {
            return false;
        }
    }

    return true;
}

async function reloadSide(side) {
    if (session.mode !== 'diff') {
        return;
    }

    const target = session[side];
    if (!target.path) {
        return;
    }

    const freshContent = readFileContent(target.path);
    target.content = freshContent;
    target.savedContent = freshContent;
    target.dirty = false;
    await sendCurrentDiff();
}

function updateWatchers() {
    clearWatchers();

    if (session.mode !== 'diff') {
        return;
    }

    for (const side of ['left', 'right']) {
        const target = session[side];
        if (!target.path || !fs.existsSync(target.path)) {
            continue;
        }

        const watcher = fs.watch(target.path, () => {
            void handleExternalFileChange(side);
        });
        fileWatchers.push(watcher);
    }
}

function clearWatchers() {
    fileWatchers.forEach((watcher) => watcher.close());
    fileWatchers = [];
}

async function handleExternalFileChange(side) {
    if (session.mode !== 'diff' || !mainWindow) {
        return;
    }

    const target = session[side];
    if (!target.path || !fs.existsSync(target.path)) {
        return;
    }

    const latestContent = readFileContent(target.path);
    if (latestContent === target.savedContent) {
        return;
    }

    const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Reload', 'Keep Current'],
        defaultId: 0,
        cancelId: 1,
        message: `${target.label} changed on disk.`,
        detail: target.dirty
            ? 'Reloading will discard unsaved Bygone edits for this pane.'
            : 'Reload the changed file into Bygone?'
    });

    if (choice.response === 0) {
        target.content = latestContent;
        target.savedContent = latestContent;
        target.dirty = false;
        await sendCurrentDiff();
    } else {
        target.savedContent = latestContent;
        target.dirty = target.content !== target.savedContent;
        await sendCurrentDiff();
    }
}

function updateWindowTitle(title) {
    if (!mainWindow) {
        return;
    }

    const dirtySuffix = hasUnsavedChanges() ? ' • Unsaved' : '';
    mainWindow.setTitle(`${APP_NAME} — ${title}${dirtySuffix}`);
}

function postOrQueue(message) {
    pendingMessage = message;

    if (hostReady) {
        postToRenderer(message);
    }
}

function postToRenderer(message) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    mainWindow.webContents.send('bygone:host-message', message);
}

function hasUnsavedChanges() {
    return session.mode === 'diff' && (session.left.dirty || session.right.dirty);
}

function createEmptySession() {
    return {
        mode: 'empty',
        left: createSideState('', ''),
        right: createSideState('', ''),
        history: null,
        directory: null,
        multi: null
    };
}

function createSideState(filePath, content) {
    return {
        path: filePath,
        label: filePath ? path.basename(filePath) : '',
        content,
        savedContent: content,
        dirty: false
    };
}

function readFileContent(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function getPathKind(filePath) {
    try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            return 'directory';
        }
        if (stats.isFile()) {
            return 'file';
        }
    } catch {
        return 'missing';
    }

    return 'missing';
}

async function showInfo(message) {
    if (!mainWindow) {
        return;
    }

    await dialog.showMessageBox(mainWindow, {
        type: 'info',
        message
    });
}

async function showError(message) {
    if (!mainWindow) {
        return;
    }

    await dialog.showMessageBox(mainWindow, {
        type: 'error',
        message
    });
}

function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function finalizeSmokeTest(snapshot) {
    clearTimeout(smokeTimeout);
    smokeTimeout = undefined;

    const passed = Boolean(
        snapshot
        && snapshot.fileInfo === 'Comparing test-file-1.js and test-file-2.js'
        && snapshot.file1 === 'test-file-1.js'
        && snapshot.file2 === 'test-file-2.js'
    );

    if (!passed) {
        console.error(`Bygone smoke test failed: unexpected diff DOM snapshot ${JSON.stringify(snapshot)}`);
        process.exitCode = 1;
        app.exit(1);
        return;
    }

    app.quit();
}

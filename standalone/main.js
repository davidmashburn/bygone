const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { buildTwoWayDiffModel } = require('../src/diffEngine.ts');
const { GitHistoryService } = require('../src/gitHistory.ts');
const { createJavaScriptSampleFilePair } = require('../src/sampleFiles.ts');
const { buildMultiDirectoryComparison } = require('../src/directoryDiff.ts');

const APP_NAME = 'Bygone';
const HELP_URL = 'https://github.com/davidmashburn/bygone';
const DEFAULT_GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const parsedGitMaxBufferBytes = Number.parseInt(process.env.BYGONE_GIT_MAX_BUFFER_BYTES || '', 10);
const GIT_MAX_BUFFER_BYTES = Number.isFinite(parsedGitMaxBufferBytes) && parsedGitMaxBufferBytes > 0
    ? parsedGitMaxBufferBytes
    : DEFAULT_GIT_MAX_BUFFER_BYTES;
const DEFAULT_DIRECTORY_HISTORY_CACHE_SIZE = 3;
const parsedDirectoryHistoryCacheSize = Number.parseInt(process.env.BYGONE_DIR_HISTORY_CACHE_SIZE || '', 10);
const DIRECTORY_HISTORY_CACHE_SIZE = Number.isFinite(parsedDirectoryHistoryCacheSize) && parsedDirectoryHistoryCacheSize > 0
    ? parsedDirectoryHistoryCacheSize
    : DEFAULT_DIRECTORY_HISTORY_CACHE_SIZE;
const commandLineToolPath = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'Microsoft', 'WindowsApps', 'bygone.cmd')
    : '/usr/local/bin/bygone';
const gitHistoryService = new GitHistoryService();
const launchArguments = parseLaunchArgs(getCliArgs());
const smokeTestMode = launchArguments.kind === 'smoke';
const captureOutputPath = launchArguments.capturePath ? path.resolve(launchArguments.capturePath) : null;
const captureMode = Boolean(captureOutputPath);
const launchWindowWidth = Number.isFinite(launchArguments.windowWidth) ? launchArguments.windowWidth : 1500;
const launchWindowHeight = Number.isFinite(launchArguments.windowHeight) ? launchArguments.windowHeight : 960;
const shouldUseSingleInstanceLock = app.isPackaged && launchArguments.kind === 'empty';

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
let historyIncludeStagedPreference = false;
let historySkipUnchangedPreference = false;
let captureScheduled = false;
let nextMultiPanelId = 1;

if (!singleInstanceLock) {
    app.quit();
}

app.whenReady().then(async () => {
    createMainWindow();
    installApplicationMenu();
    initializeAutoUpdates();
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
        width: launchWindowWidth,
        height: launchWindowHeight,
        minWidth: 960,
        minHeight: 640,
        show: !smokeTestMode,
        title: APP_NAME,
        webPreferences: {
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'standalone-preload.js')
        }
    });

    hostReady = false;
    pendingMessage = undefined;
    void mainWindow.loadFile(path.join(__dirname, '..', 'standalone', 'index.html'));

    if (smokeTestMode || captureMode) {
        smokeTimeout = setTimeout(() => {
            console.error(`Bygone ${captureMode ? 'capture' : 'smoke test'} timed out before renderer became ready.`);
            process.exitCode = 1;
            app.exit(1);
        }, 10000);
    }

    mainWindow.webContents.on('did-finish-load', () => {
        if (smokeTestMode || captureMode) {
            console.log('Bygone standalone window finished loading.');
        }
    });

    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (smokeTestMode || captureMode) {
            console.log(`Renderer console [${level}] ${sourceId}:${line} ${message}`);
        }
    });

    mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
        console.error(`Bygone standalone load failed (${code}): ${description}`);
        if (smokeTestMode || captureMode) {
            process.exitCode = 1;
            app.exit(1);
        }
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error(`Bygone renderer process exited: ${details.reason}`);
        if (smokeTestMode || captureMode) {
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
        captureScheduled = false;
    });
}

function installApplicationMenu() {
    const isMultiDiff = session.mode === 'multi-diff';
    const fileActionItems = isMultiDiff
        ? [
            {
                label: 'Save Active File',
                accelerator: 'CmdOrCtrl+S',
                click: () => { void saveSide('left'); }
            },
            {
                label: 'Save All',
                accelerator: 'CmdOrCtrl+Shift+S',
                click: () => { void saveAllDirtySides(); }
            },
            {
                label: 'Reload Active File',
                click: () => { void reloadSide('left'); }
            }
        ]
        : [
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
                label: 'Save All',
                click: () => { void saveAllDirtySides(); }
            },
            {
                label: 'Reload Left',
                click: () => { void reloadSide('left'); }
            },
            {
                label: 'Reload Right',
                click: () => { void reloadSide('right'); }
            }
        ];

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
                    label: 'Compare Multiple Files…',
                    click: () => { void openCompareMultiFilesDialog(); }
                },
                { type: 'separator' },
                {
                    label: 'Add Panel to Left…',
                    click: () => { void addPanelFromMenu('left'); }
                },
                {
                    label: 'Add Panel to Right…',
                    click: () => { void addPanelFromMenu('right'); }
                },
                {
                    label: 'Remove Active Panel',
                    click: () => { void removeActivePanelFromMenu(); }
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
                ...fileActionItems,
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
                {
                    label: 'Back to Directory',
                    accelerator: 'CmdOrCtrl+[',
                    click: () => { void returnToDirectoryView(); }
                },
                { type: 'separator' },
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
                },
                {
                    label: 'Install Command Line Tools…',
                    click: () => { void installCommandLineTools(); }
                },
                {
                    label: 'Check for Updates…',
                    click: () => { void checkForUpdates(true); }
                }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function installCommandLineTools() {
    const launcher = buildCommandLineLauncher();

    try {
        fs.mkdirSync(path.dirname(commandLineToolPath), { recursive: true });
        fs.writeFileSync(commandLineToolPath, launcher.content, 'utf8');
        fs.chmodSync(commandLineToolPath, 0o755);
        await showInfo(`Installed command line tool at ${commandLineToolPath}`);
    } catch (error) {
        await showError(
            `Could not install command line tool at ${commandLineToolPath}.\n\n`
            + `Run this manually:\n${launcher.manualCommand}\n\n`
            + getErrorMessage(error)
        );
    }
}

function buildCommandLineLauncher() {
    if (process.platform === 'darwin') {
        return {
            content: '#!/usr/bin/env sh\nexec open -W -a "Bygone" --args --cwd "$PWD" "$@"\n',
            manualCommand: `sudo tee ${shellQuote(commandLineToolPath)} >/dev/null <<'EOF'\n#!/usr/bin/env sh\nexec open -W -a "Bygone" --args --cwd "$PWD" "$@"\nEOF\nsudo chmod +x ${shellQuote(commandLineToolPath)}`
        };
    }

    if (process.platform === 'win32') {
        const exePath = process.execPath;
        return {
            content: `@echo off\r\n"${exePath}" --cwd "%CD%" %*\r\n`,
            manualCommand: `Create ${commandLineToolPath} with:\r\n@echo off\r\n"${exePath}" --cwd "%CD%" %*`
        };
    }

    const executablePath = process.env.APPIMAGE || process.execPath;
    return {
        content: `#!/usr/bin/env sh\nexec ${shellQuote(executablePath)} --cwd "$PWD" "$@"\n`,
        manualCommand: `sudo tee ${shellQuote(commandLineToolPath)} >/dev/null <<'EOF'\n#!/usr/bin/env sh\nexec ${shellQuote(executablePath)} --cwd "$PWD" "$@"\nEOF\nsudo chmod +x ${shellQuote(commandLineToolPath)}`
    };
}

function initializeAutoUpdates() {
    if (!app.isPackaged || smokeTestMode) {
        return;
    }

    void checkForUpdates(false);
}

async function checkForUpdates(showNoUpdateMessage) {
    let updater;
    try {
        ({ autoUpdater: updater } = require('electron-updater'));
    } catch {
        if (showNoUpdateMessage) {
            await showInfo('Auto-update support is not bundled in this build yet.');
        }
        return;
    }

    updater.autoDownload = true;
    updater.on('update-downloaded', () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return;
        }

        dialog.showMessageBox(mainWindow, {
            type: 'info',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0,
            cancelId: 1,
            message: 'A Bygone update is ready.',
            detail: 'Restart Bygone to install the update.'
        }).then((choice) => {
            if (choice.response === 0) {
                updater.quitAndInstall();
            }
        });
    });

    try {
        const result = await updater.checkForUpdates();
        if (showNoUpdateMessage && !result?.updateInfo) {
            await showInfo('No update information was found.');
        }
    } catch (error) {
        if (showNoUpdateMessage) {
            await showError(`Could not check for updates: ${getErrorMessage(error)}`);
        }
    }
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

    if (launchTarget.kind === 'directory-history') {
        await openDirectoryHistory(launchTarget.dirPath, Boolean(launchTarget.includeStaged));
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
        await openHistory(launchTarget.filePath, Boolean(launchTarget.includeStaged));
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
    const { cwd, launchArgs } = normalizeLaunchArgs(args);
    const includeStaged = launchArgs.includes('--include-staged') || launchArgs.includes('--staged');
    let capturePath = null;
    let windowWidth = null;
    let windowHeight = null;
    const filteredArgs = [];

    for (let index = 0; index < launchArgs.length; index += 1) {
        const arg = launchArgs[index];
        if (arg === '--include-staged' || arg === '--staged') {
            continue;
        }
        if (arg === '--capture' && typeof launchArgs[index + 1] === 'string') {
            capturePath = resolveLaunchPath(launchArgs[index + 1], cwd);
            index += 1;
            continue;
        }
        if (arg === '--window-width' && typeof launchArgs[index + 1] === 'string') {
            const parsedWidth = Number.parseInt(launchArgs[index + 1], 10);
            if (Number.isFinite(parsedWidth) && parsedWidth > 0) {
                windowWidth = parsedWidth;
            }
            index += 1;
            continue;
        }
        if (arg === '--window-height' && typeof launchArgs[index + 1] === 'string') {
            const parsedHeight = Number.parseInt(launchArgs[index + 1], 10);
            if (Number.isFinite(parsedHeight) && parsedHeight > 0) {
                windowHeight = parsedHeight;
            }
            index += 1;
            continue;
        }
        filteredArgs.push(arg);
    }

    if (filteredArgs.length === 0) {
        return { kind: 'directory-history', dirPath: cwd, includeStaged, capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs[0] === '--diff' && filteredArgs.length >= 2) {
        if (filteredArgs.length === 2) {
            return { kind: 'multi-diff', paths: filteredArgs.slice(1).map((candidate) => resolveLaunchPath(candidate, cwd)), capturePath, windowWidth, windowHeight };
        }

        if (filteredArgs.length === 3) {
            return { kind: 'diff', leftPath: resolveLaunchPath(filteredArgs[1], cwd), rightPath: resolveLaunchPath(filteredArgs[2], cwd), capturePath, windowWidth, windowHeight };
        }

        return { kind: 'multi-diff', paths: filteredArgs.slice(1).map((candidate) => resolveLaunchPath(candidate, cwd)), capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs[0] === '--dir' && filteredArgs.length >= 3) {
        return { kind: 'directory', leftPath: resolveLaunchPath(filteredArgs[1], cwd), rightPath: resolveLaunchPath(filteredArgs[2], cwd), capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs[0] === '--dir3' && filteredArgs.length >= 4) {
        return { kind: 'multi-directory', paths: filteredArgs.slice(1, 4).map((candidate) => resolveLaunchPath(candidate, cwd)), capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs[0] === '--diff3' && filteredArgs.length >= 4) {
        return { kind: 'multi-diff', paths: filteredArgs.slice(1, 4).map((candidate) => resolveLaunchPath(candidate, cwd)), capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs[0] === '--history' && filteredArgs.length >= 2) {
        return { kind: 'history', filePath: resolveLaunchPath(filteredArgs[1], cwd), includeStaged, capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs[0] === '--dir-history' && filteredArgs.length >= 2) {
        return { kind: 'directory-history', dirPath: resolveLaunchPath(filteredArgs[1], cwd), includeStaged, capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs[0] === '--test') {
        return { kind: 'test', capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs[0] === '--smoke-test') {
        return { kind: 'smoke', capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs.length === 1 && !filteredArgs[0].startsWith('--')) {
        const targetPath = resolveLaunchPath(filteredArgs[0], cwd);
        return getPathKind(targetPath) === 'directory'
            ? { kind: 'directory-history', dirPath: targetPath, includeStaged, capturePath, windowWidth, windowHeight }
            : { kind: 'history', filePath: targetPath, includeStaged, capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs.length >= 2 && !filteredArgs[0].startsWith('--')) {
        if (filteredArgs.length === 2) {
            return { kind: 'pair', leftPath: resolveLaunchPath(filteredArgs[0], cwd), rightPath: resolveLaunchPath(filteredArgs[1], cwd), capturePath, windowWidth, windowHeight };
        }

        return { kind: 'multi-diff', paths: filteredArgs.map((candidate) => resolveLaunchPath(candidate, cwd)), capturePath, windowWidth, windowHeight };
    }

    return { kind: 'directory-history', dirPath: cwd, includeStaged, capturePath, windowWidth, windowHeight };
}

function normalizeLaunchArgs(args) {
    const launchArgs = [...args];
    let cwd = process.cwd();
    const cwdIndex = launchArgs.indexOf('--cwd');

    if (cwdIndex !== -1 && typeof launchArgs[cwdIndex + 1] === 'string') {
        cwd = path.resolve(launchArgs[cwdIndex + 1]);
        launchArgs.splice(cwdIndex, 2);
    }

    return { cwd, launchArgs };
}

function resolveLaunchPath(candidate, cwd) {
    return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
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

    if (message.type === 'recomputeDiff' && session.mode === 'history') {
        await updateEditableHistoryDiff(message.leftContent, message.rightContent);
        return;
    }

    if (message.type === 'recomputeDiff' && session.mode === 'directory-history') {
        await updateEditableDirectoryHistoryDiff(message.leftContent, message.rightContent);
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

    if (message.type === 'selectHistoryEntry' && Number.isInteger(message.index)) {
        await selectHistoryEntry(message.index);
        return;
    }

    if (message.type === 'returnToDirectory') {
        await returnToDirectoryView();
        return;
    }

    if (message.type === 'navigateFile' && (message.direction === 'previous' || message.direction === 'next')) {
        await navigateSiblingFile(message.direction);
        return;
    }

    if (message.type === 'multiSetActivePanel' && typeof message.panelId === 'string') {
        setActiveMultiPanel(message.panelId);
        return;
    }

    if (message.type === 'multiSetActivePair' && Number.isInteger(message.pairIndex)) {
        setActiveMultiPair(message.pairIndex);
        return;
    }

    if (message.type === 'multiAddPanel'
        && typeof message.anchorPanelId === 'string'
        && (message.side === 'left' || message.side === 'right')) {
        await addMultiPanel(message.anchorPanelId, message.side);
        return;
    }

    if (message.type === 'multiRemovePanel' && typeof message.panelId === 'string') {
        await removeMultiPanel(message.panelId);
        return;
    }

    if (message.type === 'multiUpdatePanelContent'
        && typeof message.panelId === 'string'
        && typeof message.content === 'string'
        && session.mode === 'multi-diff'
        && session.multi) {
        const panel = session.multi.files.find((entry) => entry.id === message.panelId);
        if (panel) {
            panel.content = message.content;
            panel.dirty = panel.content !== panel.savedContent;
            updateWindowTitle(session.multi.files.map((file) => file.label).join(' ↔ ') || 'Multi-Panel Compare');
        }
        return;
    }

    if (message.type === 'historyBack') {
        await navigateHistory('back');
        return;
    }

    if (message.type === 'historyForward') {
        await navigateHistory('forward');
        return;
    }

    if (message.type === 'historyToggleStaged' && typeof message.includeStaged === 'boolean') {
        await updateHistoryIncludeStaged(message.includeStaged);
        return;
    }

    if (message.type === 'historyToggleSkipUnchanged' && typeof message.skipUnchanged === 'boolean') {
        await updateHistorySkipUnchanged(message.skipUnchanged);
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
        const targetPath = normalizedPaths[0];
        if (getPathKind(targetPath) === 'directory') {
            await openDirectoryHistory(targetPath, historyIncludeStagedPreference);
        } else {
            await openHistory(targetPath, historyIncludeStagedPreference);
        }
        return;
    }

    if (normalizedPaths.length === 2) {
        await openPathPair(normalizedPaths[0], normalizedPaths[1], 'auto');
        return;
    }

    if (normalizedPaths.length >= 3) {
        const kinds = normalizedPaths.map((candidate) => getPathKind(candidate));
        if (kinds.every((kind) => kind === 'directory')) {
            if (normalizedPaths.length === 3) {
                await openDirectories(normalizedPaths);
            } else {
                await showInfo('Directory compare currently supports two or three directories.');
            }
            return;
        }

        if (kinds.every((kind) => kind === 'file')) {
            await openMultiDiff(normalizedPaths);
            return;
        }

        await showInfo('Drop only files for multi-panel diff, or only directories for directory compare.');
        return;
    }

    await showInfo('Drop one file for history, two files or directories for compare, or three or more files for multi-panel compare.');
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

    await openHistory(result.filePaths[0], historyIncludeStagedPreference);
}

async function openCompareMultiFilesDialog() {
    if (!mainWindow) {
        return;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select files to compare',
        properties: ['openFile', 'multiSelections']
    });

    if (result.canceled || result.filePaths.length < 1) {
        return;
    }

    if (result.filePaths.length === 2) {
        await openDiff(result.filePaths[0], result.filePaths[1]);
        return;
    }

    await openMultiDiff(result.filePaths);
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
        multi: null,
        dirHistory: null
    };

    clearWatchers();
    await sendCurrentDirectoryDiff();
}

async function openDirectoryHistory(dirPath, includeStaged = historyIncludeStagedPreference) {
    const resolvedDir = path.resolve(dirPath);
    if (getPathKind(resolvedDir) !== 'directory') {
        await showInfo('Directory history requires a directory.');
        return;
    }

    let historyState;
    try {
        historyState = buildDirectoryHistory(resolvedDir, includeStaged);
    } catch (error) {
        await showError(`Error loading directory history: ${getErrorMessage(error)}`);
        return;
    }

    if (historyState.entries.length === 0) {
        await showInfo('No git history with parents was found for that directory.');
        return;
    }

    session = {
        mode: 'directory-history',
        left: createSideState('', ''),
        right: createSideState('', ''),
        history: null,
        directory: null,
        multi: null,
        dirHistory: historyState
    };

    clearWatchers();
    historyIncludeStagedPreference = Boolean(includeStaged);
    historySkipUnchangedPreference = Boolean(historyState.skipUnchanged);
    await sendCurrentDirectoryHistoryEntry();
}

function buildDirectoryHistory(resolvedDir, includeStaged = false) {
    const repoRoot = fs.realpathSync(runGit(['rev-parse', '--show-toplevel'], resolvedDir));
    const realDir = fs.realpathSync(resolvedDir);
    const relativeDir = path.relative(repoRoot, realDir).replace(/\\/g, '/');
    const displayName = path.basename(realDir) || path.basename(repoRoot);
    const commitRecords = parseGitHistoryRecords(runGit(
        ['log', '--format=%H%x09%h%x09%cI%x09%s', '--', relativeDir || '.'],
        repoRoot
    ));
    const entries = [];

    if (includeStaged) {
        const workingTreeEntry = buildWorkingTreeDirectoryHistoryEntry(repoRoot, relativeDir, displayName, true);
        if (workingTreeEntry) {
            entries.push(workingTreeEntry);
        }
        const stagedEntry = buildStagedDirectoryHistoryEntry(repoRoot, relativeDir, displayName);
        if (stagedEntry) {
            entries.push(stagedEntry);
        }
    } else {
        const workingTreeEntry = buildWorkingTreeDirectoryHistoryEntry(repoRoot, relativeDir, displayName, false);
        if (workingTreeEntry) {
            entries.push(workingTreeEntry);
        }
    }

    for (const commit of commitRecords) {
        const parentCommit = readPrimaryParent(repoRoot, commit.commit);
        if (!parentCommit) {
            continue;
        }

        entries.push({
            commit: commit.commit,
            parentCommit,
            shortCommit: commit.shortCommit,
            summary: commit.summary,
            timestamp: commit.timestamp,
            parentSummary: readCommitSummary(repoRoot, parentCommit),
            parentTimestamp: readCommitTimestamp(repoRoot, parentCommit),
            labels: [`${displayName} @ ${parentCommit.slice(0, 7)}`, `${displayName} @ ${commit.shortCommit}`]
        });
    }

    return {
        repoRoot,
        relativeDir,
        dirPath: realDir,
        displayName,
        includeStaged,
        skipUnchanged: Boolean(historySkipUnchangedPreference),
        entries,
        index: 0,
        viewRelativePath: null,
        materializedOrder: []
    };
}

function buildWorkingTreeDirectoryHistoryEntry(repoRoot, relativeDir, displayName, includeStaged) {
    const headCommit = readHeadCommit(repoRoot);
    const hasChanges = includeStaged
        ? hasUnstagedDirectoryChanges(repoRoot, relativeDir)
        : hasWorkingTreeDirectoryChanges(repoRoot, relativeDir);
    if (!hasChanges) {
        return undefined;
    }

    return {
        commit: 'WORKTREE',
        parentCommit: includeStaged ? 'INDEX' : headCommit,
        shortCommit: 'Working Tree',
        summary: '',
        timestamp: '',
        parentSummary: includeStaged || !headCommit ? '' : readCommitSummary(repoRoot, headCommit),
        parentTimestamp: includeStaged || !headCommit ? '' : readCommitTimestamp(repoRoot, headCommit),
        labels: [`${displayName} @ ${includeStaged ? 'Staged' : 'HEAD'}`, `${displayName} @ Working Tree`]
    };
}

function buildStagedDirectoryHistoryEntry(repoRoot, relativeDir, displayName) {
    const headCommit = readHeadCommit(repoRoot);
    if (!hasStagedDirectoryChanges(repoRoot, relativeDir)) {
        return undefined;
    }

    return {
        commit: 'INDEX',
        parentCommit: headCommit,
        shortCommit: 'Staged',
        summary: '',
        timestamp: '',
        parentSummary: headCommit ? readCommitSummary(repoRoot, headCommit) : '',
        parentTimestamp: headCommit ? readCommitTimestamp(repoRoot, headCommit) : '',
        labels: [`${displayName} @ HEAD`, `${displayName} @ Staged`]
    };
}

function hasWorkingTreeDirectoryChanges(repoRoot, relativeDir) {
    return runGit(['status', '--porcelain', '--', relativeDir || '.'], repoRoot).trim().length > 0;
}

function hasStagedDirectoryChanges(repoRoot, relativeDir) {
    const output = runGit(['status', '--porcelain', '--', relativeDir || '.'], repoRoot);
    return output.split('\n').some((line) => line.length >= 1 && line[0] !== ' ' && line[0] !== '?');
}

function hasUnstagedDirectoryChanges(repoRoot, relativeDir) {
    const output = runGit(['status', '--porcelain', '--', relativeDir || '.'], repoRoot);
    return output.split('\n').some((line) => line.length >= 2 && line[1] !== ' ');
}

function materializeGitTree(repoRoot, relativeDir, targetRoot, commit = 'HEAD') {
    let files;
    if (commit === 'INDEX') {
        const lsArgs = ['ls-files', '-z', '--'];
        if (relativeDir) {
            lsArgs.push(relativeDir);
        }
        files = execFileSync('git', lsArgs, {
            cwd: repoRoot,
            encoding: 'utf8',
            maxBuffer: GIT_MAX_BUFFER_BYTES
        })
            .split('\0')
            .filter((filePath) => filePath.length > 0);
    } else {
        const lsArgs = ['ls-tree', '-r', '-z', '--name-only', commit];
        if (relativeDir) {
            lsArgs.push('--', relativeDir);
        }

        files = execFileSync('git', lsArgs, {
            cwd: repoRoot,
            encoding: 'utf8',
            maxBuffer: GIT_MAX_BUFFER_BYTES
        })
            .split('\0')
            .filter((filePath) => filePath.length > 0);
    }

    for (const relativeFile of files) {
        const targetFile = path.join(targetRoot, relativeFile);
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.writeFileSync(targetFile, readGitBlob(repoRoot, commit === 'INDEX' ? '' : commit, relativeFile));
    }
}

function materializeWorkingTree(repoRoot, relativeDir, targetRoot) {
    const lsArgs = ['ls-files', '-co', '-z', '--exclude-standard'];
    if (relativeDir) {
        lsArgs.push('--', relativeDir);
    }

    const files = execFileSync('git', lsArgs, {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: GIT_MAX_BUFFER_BYTES
    })
        .split('\0')
        .filter((filePath) => filePath.length > 0);

    for (const relativeFile of files) {
        const sourceFile = path.join(repoRoot, relativeFile);
        if (getPathKind(sourceFile) !== 'file') {
            continue;
        }

        const targetFile = path.join(targetRoot, relativeFile);
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.copyFileSync(sourceFile, targetFile);
    }
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
    scheduleCaptureIfNeeded();
}

async function sendCurrentDirectoryHistoryEntry() {
    if (session.mode !== 'directory-history' || !session.dirHistory) {
        return;
    }

    const normalizedIndex = normalizeHistoryIndex(getVisibleDirectoryHistoryIndices(session.dirHistory), session.dirHistory.index);
    if (normalizedIndex !== null) {
        session.dirHistory.index = normalizedIndex;
    }

    let entry;
    try {
        entry = ensureDirectoryHistoryEntryMaterialized(session.dirHistory, session.dirHistory.index);
    } catch (error) {
        await showError(`Error loading directory history entry: ${getErrorMessage(error)}`);
        return;
    }

    const history = buildDirectoryHistoryViewState(session.dirHistory, entry);

    if (session.dirHistory.viewRelativePath) {
        const relativePath = session.dirHistory.viewRelativePath;
        const files = entry.dirs.map((dir) => path.join(dir, relativePath));
        const leftExists = getPathKind(files[0]) === 'file';
        const rightExists = getPathKind(files[1]) === 'file';

        if (!leftExists && !rightExists) {
            session.dirHistory.viewRelativePath = null;
            await showInfo('That entry does not exist on either side for this history step.');
            await sendCurrentDirectoryHistoryEntry();
            return;
        }

        const leftContent = leftExists ? readFileContent(files[0]) : '';
        const rightContent = entry.editedFiles?.[relativePath] ?? (rightExists ? readFileContent(files[1]) : '');
        const leftLabel = `${entry.labels[0]} / ${relativePath}${leftExists ? '' : ' (missing)'}`;
        const rightLabel = `${entry.labels[1]} / ${relativePath}${rightExists ? '' : ' (missing)'}`;

        postOrQueue({
            type: 'showDiff',
            file1: leftLabel,
            file2: rightLabel,
            leftContent,
            rightContent,
            diffModel: buildTwoWayDiffModel(leftContent, rightContent),
            fileNavigation: buildDirectoryHistoryFileNavigationState(session.dirHistory, entry),
            canReturnToDirectory: true,
            editableSides: buildHistoryEditableSides(entry),
            history: {
                ...history,
                fileName: relativePath
            }
        });

        updateWindowTitle(`${relativePath} Directory History`);
        scheduleCaptureIfNeeded();
        return;
    }

    const entries = buildMultiDirectoryComparison(entry.dirs);

    postOrQueue({
        type: 'showDirectoryDiff',
        leftLabel: entry.labels[0],
        rightLabel: entry.labels[1],
        labels: entry.labels,
        entries,
        history
    });

    updateWindowTitle(`${session.dirHistory.displayName} Directory History`);
    scheduleCaptureIfNeeded();
}

function buildDirectoryHistoryViewState(dirHistory, entry) {
    const visibleIndices = getVisibleDirectoryHistoryIndices(dirHistory);
    const visiblePosition = visibleIndices.indexOf(dirHistory.index);
    return {
        fileName: dirHistory.displayName,
        canGoBack: visiblePosition >= 0 && visiblePosition < visibleIndices.length - 1,
        canGoForward: visiblePosition > 0,
        positionLabel: visibleIndices.length > 0 ? `${visiblePosition + 1} / ${visibleIndices.length}` : `0 / 0`,
        leftCommitLabel: `${entry.parentCommit?.slice(0, 7) ?? ''} ${entry.parentSummary}`.trim(),
        leftTimestamp: entry.parentTimestamp,
        rightCommitLabel: `${entry.shortCommit} ${entry.summary}`.trim(),
        rightTimestamp: entry.timestamp,
        includeStaged: Boolean(dirHistory.includeStaged),
        skipUnchanged: Boolean(dirHistory.skipUnchanged),
        rail: buildDirectoryHistoryRailState(dirHistory, entry)
    };
}

function buildDirectoryHistoryRailState(dirHistory, entry) {
    if (!dirHistory || !entry?.dirs) {
        return undefined;
    }

    const historyItems = getVisibleDirectoryHistoryIndices(dirHistory).map((index) => {
        const historyEntry = dirHistory.entries[index];
        return ({
            label: `${historyEntry.shortCommit} ${historyEntry.summary}`.trim() || historyEntry.shortCommit,
            meta: historyEntry.timestamp,
            active: index === dirHistory.index,
            kind: 'history-entry',
            index
        });
    });

    const changedFiles = buildMultiDirectoryComparison(entry.dirs)
        .filter((directoryEntry) => directoryEntry.status !== 'same' && !directoryEntry.isDirectory)
        .map((directoryEntry) => ({
            label: directoryEntry.relativePath,
            meta: directoryEntry.status === 'modified'
                ? 'modified'
                : directoryEntry.status === 'left-only'
                    ? 'left only'
                    : directoryEntry.status === 'right-only'
                        ? 'right only'
                        : directoryEntry.status,
            active: dirHistory.viewRelativePath === directoryEntry.relativePath,
            status: directoryEntry.status === 'modified'
                ? 'modified'
                : directoryEntry.status === 'left-only'
                    ? 'left-only'
                    : directoryEntry.status === 'right-only'
                        ? 'right-only'
                        : undefined,
            kind: 'directory-entry',
            relativePath: directoryEntry.relativePath
        }));

    return {
        activeTabId: 'history',
        tabs: [
            { id: 'history', label: 'History' },
            { id: 'changed-files', label: 'Changed Files' }
        ],
        itemsByTab: {
            history: historyItems,
            'changed-files': changedFiles
        }
    };
}

function getVisibleFileHistoryIndices(historyState) {
    if (!historyState?.entries?.length) {
        return [];
    }

    if (!historyState.skipUnchanged) {
        return historyState.entries.map((_entry, index) => index);
    }

    return historyState.entries
        .map((entry, index) => (entry.leftContent !== entry.rightContent ? index : -1))
        .filter((index) => index >= 0);
}

function getVisibleDirectoryHistoryIndices(dirHistory) {
    if (!dirHistory?.entries?.length) {
        return [];
    }

    if (!dirHistory.skipUnchanged || !dirHistory.viewRelativePath) {
        return dirHistory.entries.map((_entry, index) => index);
    }

    return dirHistory.entries
        .map((entry, index) => {
            const materialized = ensureDirectoryHistoryEntryMaterialized(dirHistory, index);
            const changed = buildMultiDirectoryComparison(materialized.dirs).some((directoryEntry) => (
                !directoryEntry.isDirectory
                && directoryEntry.relativePath === dirHistory.viewRelativePath
                && directoryEntry.status !== 'same'
            ));
            return changed ? index : -1;
        })
        .filter((index) => index >= 0);
}

function normalizeHistoryIndex(indices, currentIndex) {
    if (!indices.length) {
        return null;
    }

    if (indices.includes(currentIndex)) {
        return currentIndex;
    }

    for (const index of indices) {
        if (index >= currentIndex) {
            return index;
        }
    }

    return indices[indices.length - 1];
}

function ensureDirectoryHistoryEntryMaterialized(dirHistory, index) {
    const entry = dirHistory.entries[index];
    if (!entry) {
        throw new Error(`No directory history entry at index ${index}`);
    }

    if (entry.dirs && entry.dirs.every((dirPath) => getPathKind(dirPath) === 'directory')) {
        markDirectoryHistoryEntryUsed(dirHistory, index);
        return entry;
    }

    const leftRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-dir-left-'));
    const rightRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-dir-right-'));

    if (entry.commit === 'WORKTREE') {
        materializeGitTree(dirHistory.repoRoot, dirHistory.relativeDir, leftRoot, entry.parentCommit);
        materializeWorkingTree(dirHistory.repoRoot, dirHistory.relativeDir, rightRoot);
    } else if (entry.commit === 'INDEX') {
        materializeGitTree(dirHistory.repoRoot, dirHistory.relativeDir, leftRoot, entry.parentCommit);
        materializeGitTree(dirHistory.repoRoot, dirHistory.relativeDir, rightRoot, 'INDEX');
    } else {
        materializeGitTree(dirHistory.repoRoot, dirHistory.relativeDir, leftRoot, entry.parentCommit);
        materializeGitTree(dirHistory.repoRoot, dirHistory.relativeDir, rightRoot, entry.commit);
    }

    const leftDir = path.join(leftRoot, dirHistory.relativeDir);
    const rightDir = path.join(rightRoot, dirHistory.relativeDir);

    fs.mkdirSync(leftDir, { recursive: true });
    fs.mkdirSync(rightDir, { recursive: true });

    entry.dirs = [leftDir, rightDir];
    entry.materializedRoots = [leftRoot, rightRoot];

    markDirectoryHistoryEntryUsed(dirHistory, index);
    evictDirectoryHistoryEntries(dirHistory, index);
    return entry;
}

function markDirectoryHistoryEntryUsed(dirHistory, index) {
    if (!Array.isArray(dirHistory.materializedOrder)) {
        dirHistory.materializedOrder = [];
    }

    dirHistory.materializedOrder = dirHistory.materializedOrder.filter((value) => value !== index);
    dirHistory.materializedOrder.push(index);
}

function evictDirectoryHistoryEntries(dirHistory, activeIndex) {
    const keepIndexes = new Set([activeIndex]);
    const materializedIndexes = [];

    for (let index = 0; index < dirHistory.entries.length; index += 1) {
        const entry = dirHistory.entries[index];
        if (entry.dirs) {
            materializedIndexes.push(index);
        }

        if (entry.commit === 'WORKTREE' && (entry.rightDirty || (entry.editedFiles && Object.keys(entry.editedFiles).length > 0))) {
            keepIndexes.add(index);
        }
    }

    if (materializedIndexes.length <= DIRECTORY_HISTORY_CACHE_SIZE) {
        return;
    }

    for (const candidateIndex of [...(dirHistory.materializedOrder || [])]) {
        if (materializedIndexes.length <= DIRECTORY_HISTORY_CACHE_SIZE) {
            break;
        }

        if (keepIndexes.has(candidateIndex)) {
            continue;
        }

        const candidate = dirHistory.entries[candidateIndex];
        if (!candidate?.dirs) {
            continue;
        }

        releaseDirectoryHistoryEntry(candidate);
        const candidatePosition = materializedIndexes.indexOf(candidateIndex);
        if (candidatePosition !== -1) {
            materializedIndexes.splice(candidatePosition, 1);
        }
    }

    dirHistory.materializedOrder = (dirHistory.materializedOrder || []).filter((index) => Boolean(dirHistory.entries[index]?.dirs));
}

function releaseDirectoryHistoryEntry(entry) {
    if (Array.isArray(entry?.materializedRoots)) {
        for (const rootPath of entry.materializedRoots) {
            try {
                fs.rmSync(rootPath, { recursive: true, force: true });
            } catch {
                // Best effort cleanup.
            }
        }
    } else if (Array.isArray(entry?.dirs)) {
        for (const dirPath of entry.dirs) {
            try {
                fs.rmSync(dirPath, { recursive: true, force: true });
            } catch {
                // Best effort cleanup.
            }
        }
    }

    delete entry.dirs;
    delete entry.materializedRoots;
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
        multi: null,
        dirHistory: null
    };

    updateWatchers();
    await sendCurrentDiff();
}

async function openHistory(filePath, includeStaged = historyIncludeStagedPreference) {
    const resolvedPath = path.resolve(filePath);
    let entries;

    try {
        entries = gitHistoryService.buildFileHistory(resolvedPath, includeStaged);
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
            index: 0,
            includeStaged: Boolean(includeStaged),
            skipUnchanged: Boolean(historySkipUnchangedPreference)
        },
        directory: null,
        multi: null,
        dirHistory: null
    };

    clearWatchers();
    historyIncludeStagedPreference = Boolean(includeStaged);
    historySkipUnchangedPreference = Boolean(session.history.skipUnchanged);
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
    if (resolvedPaths.length < 1 || !resolvedPaths.every((filePath) => getPathKind(filePath) === 'file')) {
        await showInfo('Multi-file compare requires one or more files.');
        return;
    }

    const files = resolvedPaths.map((filePath) => createMultiPanelState(filePath));

    session = {
        mode: 'multi-diff',
        left: createSideState('', ''),
        right: createSideState('', ''),
        history: null,
        directory: null,
        multi: {
            sourceKind: 'normal',
            files,
            activePanelId: files[0]?.id ?? null,
            activePairIndex: files.length > 1 ? 0 : null,
            historySource: null
        },
        dirHistory: null
    };

    clearWatchers();
    updateWatchers();
    await sendCurrentMultiDiff();
}

function normalizeMultiPairIndex(activePairIndex, panelCount) {
    if (panelCount < 2) {
        return null;
    }

    if (!Number.isInteger(activePairIndex)) {
        return 0;
    }

    return Math.max(0, Math.min(activePairIndex, panelCount - 2));
}

function getMultiPanelIndexById(panelId) {
    if (session.mode !== 'multi-diff' || !session.multi) {
        return -1;
    }

    return session.multi.files.findIndex((file) => file.id === panelId);
}

function setActiveMultiPanel(panelId) {
    if (session.mode !== 'multi-diff' || !session.multi) {
        return false;
    }

    const panelIndex = getMultiPanelIndexById(panelId);
    if (panelIndex < 0) {
        return false;
    }

    session.multi.activePanelId = session.multi.files[panelIndex].id;
    if (session.multi.files.length > 1) {
        session.multi.activePairIndex = normalizeMultiPairIndex(
            session.multi.activePairIndex ?? Math.max(0, panelIndex - 1),
            session.multi.files.length
        );
    } else {
        session.multi.activePairIndex = null;
    }
    return true;
}

function setActiveMultiPair(pairIndex) {
    if (session.mode !== 'multi-diff' || !session.multi) {
        return false;
    }

    const normalizedIndex = normalizeMultiPairIndex(pairIndex, session.multi.files.length);
    if (normalizedIndex === null) {
        session.multi.activePairIndex = null;
        return false;
    }

    session.multi.activePairIndex = normalizedIndex;
    if (!session.multi.activePanelId || getMultiPanelIndexById(session.multi.activePanelId) < 0) {
        session.multi.activePanelId = session.multi.files[normalizedIndex].id;
    }
    return true;
}

async function addMultiPanel(anchorPanelId, side) {
    if (session.mode !== 'multi-diff' || !session.multi) {
        return;
    }

    const anchorIndex = getMultiPanelIndexById(anchorPanelId);
    if (anchorIndex < 0) {
        return;
    }

    if (session.multi.sourceKind === 'history' && session.multi.historySource) {
        await addHistoryPanelToMulti(side);
        return;
    }

    const panel = createBlankMultiPanelState();
    const insertIndex = side === 'left' ? anchorIndex : anchorIndex + 1;
    session.multi.files.splice(insertIndex, 0, panel);
    session.multi.activePanelId = panel.id;
    session.multi.activePairIndex = normalizeMultiPairIndex(
        side === 'left' ? insertIndex : insertIndex - 1,
        session.multi.files.length
    );
    updateWatchers();
    await sendCurrentMultiDiff();
}

async function addHistoryPanelToMulti(side) {
    if (session.mode !== 'multi-diff' || !session.multi?.historySource) {
        return;
    }

    const source = session.multi.historySource;
    if (side === 'left') {
        const leftmostPanel = session.multi.files[0];
        if (!leftmostPanel || leftmostPanel.historySide !== 'left' || !Number.isInteger(leftmostPanel.historyEntryIndex)) {
            return;
        }

        const olderIndex = getHistoryNeighborIndex(source, leftmostPanel.historyEntryIndex, 'older');
        if (olderIndex === null) {
            return;
        }

        const panel = createHistoryMultiPanelState(source.entries[olderIndex], olderIndex, 'left', source.filePath);
        session.multi.files.unshift(panel);
        session.multi.activePanelId = panel.id;
        session.multi.activePairIndex = normalizeMultiPairIndex(0, session.multi.files.length);
    } else {
        const rightmostPanel = session.multi.files[session.multi.files.length - 1];
        if (!rightmostPanel || rightmostPanel.historySide !== 'right' || !Number.isInteger(rightmostPanel.historyEntryIndex)) {
            return;
        }

        const newerIndex = getHistoryNeighborIndex(source, rightmostPanel.historyEntryIndex, 'newer');
        if (newerIndex === null) {
            return;
        }

        const panel = createHistoryMultiPanelState(source.entries[newerIndex], newerIndex, 'right', source.filePath);
        session.multi.files.push(panel);
        session.multi.activePanelId = panel.id;
        session.multi.activePairIndex = normalizeMultiPairIndex(session.multi.files.length - 2, session.multi.files.length);
    }

    updateWatchers();
    await sendCurrentMultiDiff();
}

async function removeMultiPanel(panelId) {
    if (session.mode !== 'multi-diff' || !session.multi || session.multi.files.length <= 1) {
        return;
    }

    const panelIndex = getMultiPanelIndexById(panelId);
    if (panelIndex < 0) {
        return;
    }

    session.multi.files.splice(panelIndex, 1);
    const nextPanelIndex = Math.min(panelIndex, session.multi.files.length - 1);
    session.multi.activePanelId = session.multi.files[nextPanelIndex]?.id ?? null;
    session.multi.activePairIndex = normalizeMultiPairIndex(
        session.multi.activePairIndex ?? Math.max(0, nextPanelIndex - 1),
        session.multi.files.length
    );
    updateWatchers();
    await sendCurrentMultiDiff();
}

async function addPanelFromMenu(side) {
    if (session.mode === 'history' && session.history) {
        await openHistoryAsMultiPanel(side);
        return;
    }

    if (session.mode !== 'multi-diff' || !session.multi?.activePanelId) {
        return;
    }

    await addMultiPanel(session.multi.activePanelId, side);
}

async function removeActivePanelFromMenu() {
    if (session.mode !== 'multi-diff' || !session.multi?.activePanelId) {
        return;
    }

    await removeMultiPanel(session.multi.activePanelId);
}

async function openHistoryAsMultiPanel(side) {
    if (session.mode !== 'history' || !session.history) {
        return;
    }

    const currentEntry = session.history.entries[session.history.index];
    if (!currentEntry) {
        return;
    }

    const files = [
        createHistoryMultiPanelState(currentEntry, session.history.index, 'left', session.history.filePath),
        createHistoryMultiPanelState(currentEntry, session.history.index, 'right', session.history.filePath)
    ];
    let extended = false;

    if (side === 'left') {
        const olderIndex = getHistoryNeighborIndex(session.history, session.history.index, 'older');
        if (olderIndex !== null) {
            files.unshift(createHistoryMultiPanelState(session.history.entries[olderIndex], olderIndex, 'left', session.history.filePath));
            extended = true;
        }
    } else {
        const newerIndex = getHistoryNeighborIndex(session.history, session.history.index, 'newer');
        if (newerIndex !== null) {
            files.push(createHistoryMultiPanelState(session.history.entries[newerIndex], newerIndex, 'right', session.history.filePath));
            extended = true;
        }
    }

    if (!extended) {
        return;
    }

    session = {
        mode: 'multi-diff',
        left: createSideState('', ''),
        right: createSideState('', ''),
        history: null,
        directory: null,
        multi: {
            sourceKind: 'history',
            files,
            activePanelId: side === 'left' ? files[0]?.id ?? null : files[files.length - 1]?.id ?? null,
            activePairIndex: side === 'left'
                ? normalizeMultiPairIndex(0, files.length)
                : normalizeMultiPairIndex(files.length - 2, files.length),
            historySource: {
                filePath: session.history.filePath,
                entries: session.history.entries,
                includeStaged: session.history.includeStaged,
                skipUnchanged: session.history.skipUnchanged
            }
        },
        dirHistory: null
    };

    clearWatchers();
    updateWatchers();
    await sendCurrentMultiDiff();
}

async function openDirectoryEntry(relativePath) {
    if (session.mode === 'directory-history' && session.dirHistory && !relativePath.endsWith('/')) {
        session.dirHistory.viewRelativePath = relativePath;
        const normalizedIndex = normalizeHistoryIndex(getVisibleDirectoryHistoryIndices(session.dirHistory), session.dirHistory.index);
        if (normalizedIndex !== null) {
            session.dirHistory.index = normalizedIndex;
        }
        await sendCurrentDirectoryHistoryEntry();
        return;
    }

    if (session.mode !== 'directory' || !session.directory || relativePath.endsWith('/')) {
        return;
    }

    if (session.directory.dirs.length === 2) {
        await openDirectoryFileDiff(session.directory.dirs, session.directory.labels, relativePath);
        return;
    }

    const files = session.directory.dirs
        .map((dir) => path.join(dir, relativePath))
        .filter((filePath) => getPathKind(filePath) === 'file');

    if (files.length === 2) {
        await openDiff(files[0], files[1]);
        return;
    }

    await openMultiDiff(files);
}

async function openDirectoryFileDiff(dirs, labels, relativePath) {
    const leftPath = path.join(dirs[0], relativePath);
    const rightPath = path.join(dirs[1], relativePath);
    const leftExists = getPathKind(leftPath) === 'file';
    const rightExists = getPathKind(rightPath) === 'file';

    if (!leftExists && !rightExists) {
        await showInfo('That entry does not exist on either side.');
        return;
    }

    const leftContent = leftExists ? readFileContent(leftPath) : '';
    const rightContent = rightExists ? readFileContent(rightPath) : '';
    const left = createSideState(leftExists ? leftPath : '', leftContent);
    const right = createSideState(rightExists ? rightPath : '', rightContent);

    left.label = `${labels[0]} / ${relativePath}${leftExists ? '' : ' (missing)'}`;
    right.label = `${labels[1]} / ${relativePath}${rightExists ? '' : ' (missing)'}`;

    session = {
        mode: 'diff',
        left,
        right,
        history: null,
        directory: null,
        multi: null,
        dirHistory: null,
        returnDirectory: {
            dirs: [...dirs],
            labels: [...labels],
            relativePath
        }
    };

    updateWatchers();
    await sendCurrentDiff();
}

async function returnToDirectoryView() {
    if (session.mode === 'directory-history' && session.dirHistory?.viewRelativePath) {
        session.dirHistory.viewRelativePath = null;
        await sendCurrentDirectoryHistoryEntry();
        return;
    }

    if (session.mode === 'diff' && session.returnDirectory) {
        const { dirs, labels } = session.returnDirectory;

        session = {
            mode: 'directory',
            left: createSideState(dirs[0], ''),
            right: createSideState(dirs[1], ''),
            history: null,
            directory: {
                dirs,
                labels
            },
            multi: null,
            dirHistory: null,
            returnDirectory: null
        };

        clearWatchers();
        await sendCurrentDirectoryDiff();
        return;
    }

    await showInfo('No directory view to return to.');
}

function buildChangedFileEntries(entries) {
    return entries.filter((directoryEntry) => directoryEntry.status !== 'same' && !directoryEntry.isDirectory);
}

function buildStandaloneFileNavigationState() {
    if (session.mode !== 'diff' || !session.returnDirectory?.relativePath) {
        return {
            canGoPrevious: false,
            canGoNext: false
        };
    }

    const entries = buildChangedFileEntries(buildMultiDirectoryComparison(session.returnDirectory.dirs));
    const currentIndex = entries.findIndex((entry) => entry.relativePath === session.returnDirectory.relativePath);

    return {
        canGoPrevious: currentIndex > 0,
        canGoNext: currentIndex >= 0 && currentIndex < entries.length - 1
    };
}

function buildDirectoryHistoryFileNavigationState(dirHistory, entry) {
    if (!dirHistory?.viewRelativePath) {
        return {
            canGoPrevious: false,
            canGoNext: false
        };
    }

    const entries = buildChangedFileEntries(buildMultiDirectoryComparison(entry.dirs));
    const currentIndex = entries.findIndex((directoryEntry) => directoryEntry.relativePath === dirHistory.viewRelativePath);

    return {
        canGoPrevious: currentIndex > 0,
        canGoNext: currentIndex >= 0 && currentIndex < entries.length - 1
    };
}

async function navigateSiblingFile(direction) {
    if (session.mode === 'multi-diff' && session.multi) {
        const currentIndex = getMultiPanelIndexById(session.multi.activePanelId || '');
        if (currentIndex < 0) {
            return;
        }

        const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
        const nextPanel = session.multi.files[nextIndex];
        if (!nextPanel) {
            return;
        }

        session.multi.activePanelId = nextPanel.id;
        const pairIndex = direction === 'previous'
            ? Math.max(0, nextIndex)
            : Math.max(0, nextIndex - 1);
        session.multi.activePairIndex = normalizeMultiPairIndex(pairIndex, session.multi.files.length);
        await sendCurrentMultiDiff();
        return;
    }

    if (session.mode === 'directory-history' && session.dirHistory?.viewRelativePath) {
        const entry = ensureDirectoryHistoryEntryMaterialized(session.dirHistory, session.dirHistory.index);
        const entries = buildChangedFileEntries(buildMultiDirectoryComparison(entry.dirs));
        const currentIndex = entries.findIndex((directoryEntry) => directoryEntry.relativePath === session.dirHistory.viewRelativePath);
        const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
        const nextEntry = entries[nextIndex];

        if (!nextEntry) {
            return;
        }

        session.dirHistory.viewRelativePath = nextEntry.relativePath;
        await sendCurrentDirectoryHistoryEntry();
        return;
    }

    if (session.mode === 'diff' && session.returnDirectory?.relativePath) {
        const entries = buildChangedFileEntries(buildMultiDirectoryComparison(session.returnDirectory.dirs));
        const currentIndex = entries.findIndex((directoryEntry) => directoryEntry.relativePath === session.returnDirectory.relativePath);
        const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
        const nextEntry = entries[nextIndex];

        if (!nextEntry) {
            return;
        }

        await openDirectoryFileDiff(session.returnDirectory.dirs, session.returnDirectory.labels, nextEntry.relativePath);
    }
}

async function sendCurrentMultiDiff() {
    if (session.mode !== 'multi-diff' || !session.multi) {
        return;
    }

    const panels = session.multi.files.map((file) => ({
        id: file.id,
        label: file.label,
        content: file.content,
        editable: file.editable !== false
    }));

    const activePanelId = session.multi.activePanelId
        && panels.some((panel) => panel.id === session.multi.activePanelId)
        ? session.multi.activePanelId
        : (panels[0]?.id ?? null);
    const activePairIndex = normalizeMultiPairIndex(session.multi.activePairIndex, panels.length);
    session.multi.activePanelId = activePanelId;
    session.multi.activePairIndex = activePairIndex;

    postOrQueue({
        type: 'showMultiDiff',
        panels,
        pairs: panels.slice(0, -1).map((panel, index) => ({
            leftIndex: index,
            rightIndex: index + 1,
            diffModel: buildTwoWayDiffModel(panel.content, panels[index + 1].content)
        })),
        activePanelId,
        activePairIndex
    });

    updateWindowTitle(panels.map((panel) => panel.label).join(' ↔ ') || 'Multi-Panel Compare');

    if (mainWindow && !mainWindow.isDestroyed()) {
        setTimeout(() => {
            void mainWindow.webContents.executeJavaScript(`(() => ({
                fileInfo: document.getElementById('file-info')?.textContent,
                panelCount: document.querySelectorAll('.multi-pane').length,
                gutterCount: document.querySelectorAll('.multi-gutter').length
            }))()`)
                .then((snapshot) => {
                    if (smokeTestMode) {
                        finalizeSmokeTest(snapshot);
                        return;
                    }
                    if (captureMode) {
                        scheduleCaptureIfNeeded();
                    }
                })
                .catch((error) => {
                    if (smokeTestMode || captureMode) {
                        console.error(`Bygone ${captureMode ? 'capture' : 'smoke test'} failed: ${getErrorMessage(error)}`);
                        process.exitCode = 1;
                        app.exit(1);
                    }
                });
        }, 400);
    }
}

async function sendCurrentSession() {
    installApplicationMenu();

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

    if (session.mode === 'directory-history') {
        await sendCurrentDirectoryHistoryEntry();
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
        history: null,
        fileNavigation: buildStandaloneFileNavigationState(),
        editableSides: {
            left: true,
            right: true
        },
        canReturnToDirectory: Boolean(session.returnDirectory)
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
                        return;
                    }
                    if (captureMode) {
                        scheduleCaptureIfNeeded();
                    }
                })
                .catch((error) => {
                    if (smokeTestMode || captureMode) {
                        console.error(`Bygone ${captureMode ? 'capture' : 'smoke test'} failed: ${getErrorMessage(error)}`);
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

    const visibleIndices = getVisibleFileHistoryIndices(session.history);
    const normalizedIndex = normalizeHistoryIndex(visibleIndices, session.history.index);
    if (normalizedIndex === null) {
        return;
    }
    session.history.index = normalizedIndex;
    const entry = session.history.entries[session.history.index];
    const fileName = path.basename(session.history.filePath);
    const diffModel = buildTwoWayDiffModel(entry.leftContent, entry.rightContent);
    const rail = buildFileHistoryRailState(session.history);
    const visiblePosition = visibleIndices.indexOf(session.history.index);

    postOrQueue({
        type: 'showDiff',
        file1: entry.leftLabel,
        file2: entry.rightLabel,
        leftContent: entry.leftContent,
        rightContent: entry.rightContent,
        diffModel,
        editableSides: buildHistoryEditableSides(entry),
        history: {
            fileName,
            canGoBack: visiblePosition >= 0 && visiblePosition < visibleIndices.length - 1,
            canGoForward: visiblePosition > 0,
            positionLabel: `${visiblePosition + 1} / ${visibleIndices.length}`,
            leftCommitLabel: `${entry.parentCommit?.slice(0, 7) ?? ''} ${entry.parentSummary}`.trim(),
            leftTimestamp: entry.parentTimestamp,
            rightCommitLabel: `${entry.shortCommit} ${entry.summary}`.trim(),
            rightTimestamp: entry.timestamp,
            includeStaged: Boolean(session.history.includeStaged),
            skipUnchanged: Boolean(session.history.skipUnchanged),
            rail
        }
    });

    updateWindowTitle(`${fileName} History`);
    scheduleCaptureIfNeeded();
}

function buildHistoryEditableSides(entry) {
    return {
        left: false,
        right: entry.commit === 'WORKTREE'
    };
}

function buildFileHistoryRailState(historyState) {
    if (!historyState?.entries?.length) {
        return undefined;
    }

    return {
        activeTabId: 'history',
        tabs: [{ id: 'history', label: 'History' }],
        itemsByTab: {
            history: getVisibleFileHistoryIndices(historyState).map((index) => {
                const entry = historyState.entries[index];
                return ({
                label: `${entry.shortCommit} ${entry.summary}`.trim() || entry.shortCommit,
                meta: entry.timestamp,
                active: index === historyState.index,
                kind: 'history-entry',
                index
                });
            })
        }
    };
}

async function updateEditableHistoryDiff(_leftContent, rightContent) {
    if (session.mode !== 'history' || !session.history) {
        return;
    }

    const entry = session.history.entries[session.history.index];
    if (entry.commit !== 'WORKTREE') {
        return;
    }

    entry.rightContent = rightContent;
    entry.rightDirty = rightContent !== readFileContent(session.history.filePath);
    await sendCurrentHistoryEntry();
}

async function updateEditableDirectoryHistoryDiff(_leftContent, rightContent) {
    if (session.mode !== 'directory-history' || !session.dirHistory?.viewRelativePath) {
        return;
    }

    const entry = session.dirHistory.entries[session.dirHistory.index];
    if (entry.commit !== 'WORKTREE') {
        return;
    }

    if (!entry.editedFiles) {
        entry.editedFiles = {};
    }

    const relativePath = session.dirHistory.viewRelativePath;
    const targetPath = path.join(session.dirHistory.dirPath, relativePath);
    entry.editedFiles[relativePath] = rightContent;
    entry.rightDirty = !fs.existsSync(targetPath) || rightContent !== readFileContent(targetPath);
    await sendCurrentDirectoryHistoryEntry();
}

async function navigateHistory(direction) {
    if (session.mode === 'directory-history' && session.dirHistory) {
        const visibleIndices = getVisibleDirectoryHistoryIndices(session.dirHistory);
        const currentVisiblePosition = visibleIndices.indexOf(session.dirHistory.index);
        if (currentVisiblePosition < 0) {
            const normalizedIndex = normalizeHistoryIndex(visibleIndices, session.dirHistory.index);
            if (normalizedIndex === null) {
                return;
            }
            session.dirHistory.index = normalizedIndex;
        } else if (direction === 'back' && currentVisiblePosition < visibleIndices.length - 1) {
            session.dirHistory.index = visibleIndices[currentVisiblePosition + 1];
        } else if (direction === 'forward' && currentVisiblePosition > 0) {
            session.dirHistory.index = visibleIndices[currentVisiblePosition - 1];
        } else {
            return;
        }

        await sendCurrentDirectoryHistoryEntry();
        return;
    }

    if (session.mode !== 'history' || !session.history) {
        return;
    }

    const visibleIndices = getVisibleFileHistoryIndices(session.history);
    const currentVisiblePosition = visibleIndices.indexOf(session.history.index);
    if (currentVisiblePosition < 0) {
        const normalizedIndex = normalizeHistoryIndex(visibleIndices, session.history.index);
        if (normalizedIndex === null) {
            return;
        }
        session.history.index = normalizedIndex;
    } else if (direction === 'back' && currentVisiblePosition < visibleIndices.length - 1) {
        session.history.index = visibleIndices[currentVisiblePosition + 1];
    } else if (direction === 'forward' && currentVisiblePosition > 0) {
        session.history.index = visibleIndices[currentVisiblePosition - 1];
    } else {
        return;
    }

    await sendCurrentHistoryEntry();
}

async function updateHistoryIncludeStaged(includeStaged) {
    historyIncludeStagedPreference = includeStaged;

    if (session.mode === 'history' && session.history) {
        if (Boolean(session.history.includeStaged) === includeStaged) {
            return;
        }
        if (session.history.entries.some((entry) => entry.rightDirty)) {
            await showInfo('Save or reload your history edits before changing staged view.');
            return;
        }

        await openHistory(session.history.filePath, includeStaged);
        return;
    }

    if (session.mode === 'directory-history' && session.dirHistory) {
        if (Boolean(session.dirHistory.includeStaged) === includeStaged) {
            return;
        }
        if (session.dirHistory.entries.some((entry) => entry.rightDirty)) {
            await showInfo('Save or reload your directory history edits before changing staged view.');
            return;
        }

        const viewRelativePath = session.dirHistory.viewRelativePath;
        await openDirectoryHistory(session.dirHistory.dirPath, includeStaged);
        if (session.mode === 'directory-history' && session.dirHistory) {
            session.dirHistory.viewRelativePath = viewRelativePath;
            await sendCurrentDirectoryHistoryEntry();
        }
    }
}

async function updateHistorySkipUnchanged(skipUnchanged) {
    historySkipUnchangedPreference = skipUnchanged;

    if (session.mode === 'history' && session.history) {
        session.history.skipUnchanged = skipUnchanged;
        const normalizedIndex = normalizeHistoryIndex(getVisibleFileHistoryIndices(session.history), session.history.index);
        if (normalizedIndex !== null) {
            session.history.index = normalizedIndex;
        }
        await sendCurrentHistoryEntry();
        return;
    }

    if (session.mode === 'directory-history' && session.dirHistory) {
        session.dirHistory.skipUnchanged = skipUnchanged;
        const normalizedIndex = normalizeHistoryIndex(getVisibleDirectoryHistoryIndices(session.dirHistory), session.dirHistory.index);
        if (normalizedIndex !== null) {
            session.dirHistory.index = normalizedIndex;
        }
        await sendCurrentDirectoryHistoryEntry();
    }
}

async function selectHistoryEntry(index) {
    if (session.mode === 'history' && session.history) {
        const visibleIndices = getVisibleFileHistoryIndices(session.history);
        if (!visibleIndices.includes(index)) {
            return;
        }

        session.history.index = index;
        await sendCurrentHistoryEntry();
        return;
    }

    if (session.mode === 'directory-history' && session.dirHistory) {
        const visibleIndices = getVisibleDirectoryHistoryIndices(session.dirHistory);
        if (!visibleIndices.includes(index)) {
            return;
        }

        session.dirHistory.index = index;
        await sendCurrentDirectoryHistoryEntry();
    }
}

async function saveSide(side) {
    if (session.mode === 'history') {
        return saveHistorySide(side);
    }

    if (session.mode === 'directory-history') {
        return saveDirectoryHistorySide(side);
    }

    if (session.mode === 'multi-diff') {
        return saveActiveMultiPanel();
    }

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

async function saveHistorySide(side) {
    if (side !== 'right' || !session.history) {
        return false;
    }

    const entry = session.history.entries[session.history.index];
    if (entry.commit !== 'WORKTREE') {
        return false;
    }

    fs.writeFileSync(session.history.filePath, entry.rightContent, 'utf8');
    entry.rightDirty = false;
    await sendCurrentHistoryEntry();
    return true;
}

async function saveDirectoryHistorySide(side) {
    if (side !== 'right' || !session.dirHistory?.viewRelativePath) {
        return false;
    }

    const entry = session.dirHistory.entries[session.dirHistory.index];
    if (entry.commit !== 'WORKTREE') {
        return false;
    }

    const relativePath = session.dirHistory.viewRelativePath;
    const content = entry.editedFiles?.[relativePath];
    if (content === undefined) {
        return true;
    }

    const targetPath = path.join(session.dirHistory.dirPath, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
    entry.rightDirty = false;
    await sendCurrentDirectoryHistoryEntry();
    return true;
}

async function saveAllDirtySides() {
    if (session.mode === 'history') {
        return saveDirtyHistoryEntries();
    }

    if (session.mode === 'directory-history') {
        return saveDirtyDirectoryHistoryEntries();
    }

    if (session.mode === 'multi-diff') {
        return saveDirtyMultiPanels();
    }

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

async function saveActiveMultiPanel() {
    if (session.mode !== 'multi-diff' || !session.multi?.activePanelId) {
        return false;
    }

    const panel = session.multi.files.find((entry) => entry.id === session.multi.activePanelId);
    if (!panel) {
        return false;
    }

    let targetPath = panel.path;
    if (!targetPath) {
        if (!mainWindow) {
            return false;
        }

        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Save active file',
            defaultPath: `${panel.label || 'untitled'}.txt`
        });

        if (result.canceled || !result.filePath) {
            return false;
        }

        targetPath = result.filePath;
    }

    fs.writeFileSync(targetPath, panel.content, 'utf8');
    panel.path = targetPath;
    panel.label = path.basename(targetPath);
    panel.savedContent = panel.content;
    panel.dirty = false;
    updateWatchers();
    await sendCurrentMultiDiff();
    updateWindowTitle(session.multi.files.map((file) => file.label).join(' ↔ ') || 'Multi-Panel Compare');
    return true;
}

async function saveDirtyMultiPanels() {
    if (session.mode !== 'multi-diff' || !session.multi) {
        return true;
    }

    for (const panel of session.multi.files) {
        if (!panel.dirty || !panel.path) {
            continue;
        }

        fs.writeFileSync(panel.path, panel.content, 'utf8');
        panel.savedContent = panel.content;
        panel.dirty = false;
    }

    updateWindowTitle(session.multi.files.map((file) => file.label).join(' ↔ ') || 'Multi-Panel Compare');
    return true;
}

async function saveDirtyHistoryEntries() {
    if (!session.history) {
        return true;
    }

    for (const entry of session.history.entries) {
        if (entry.commit === 'WORKTREE' && entry.rightDirty) {
            fs.writeFileSync(session.history.filePath, entry.rightContent, 'utf8');
            entry.rightDirty = false;
        }
    }

    await sendCurrentHistoryEntry();
    return true;
}

async function saveDirtyDirectoryHistoryEntries() {
    if (!session.dirHistory) {
        return true;
    }

    for (const entry of session.dirHistory.entries) {
        if (entry.commit !== 'WORKTREE' || !entry.rightDirty || !entry.editedFiles) {
            continue;
        }

        for (const [relativePath, content] of Object.entries(entry.editedFiles)) {
            const targetPath = path.join(session.dirHistory.dirPath, relativePath);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, content, 'utf8');
        }

        entry.rightDirty = false;
    }

    await sendCurrentDirectoryHistoryEntry();
    return true;
}

async function reloadSide(side) {
    if (session.mode === 'multi-diff') {
        return reloadActiveMultiPanel();
    }

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

async function reloadActiveMultiPanel() {
    if (session.mode !== 'multi-diff' || !session.multi?.activePanelId) {
        return;
    }

    const panel = session.multi.files.find((entry) => entry.id === session.multi.activePanelId);
    if (!panel?.path) {
        return;
    }

    const freshContent = readFileContent(panel.path);
    panel.content = freshContent;
    panel.savedContent = freshContent;
    panel.dirty = false;
    await sendCurrentMultiDiff();
}

function updateWatchers() {
    clearWatchers();

    if (session.mode === 'multi-diff' && session.multi) {
        for (const panel of session.multi.files) {
            if (!panel.path || !fs.existsSync(panel.path)) {
                continue;
            }

            const watcher = fs.watch(panel.path, () => {
                void handleExternalMultiPanelChange(panel.id);
            });
            fileWatchers.push(watcher);
        }
        return;
    }

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

async function handleExternalMultiPanelChange(panelId) {
    if (session.mode !== 'multi-diff' || !session.multi || !mainWindow) {
        return;
    }

    const panel = session.multi.files.find((entry) => entry.id === panelId);
    if (!panel?.path || !fs.existsSync(panel.path)) {
        return;
    }

    const latestContent = readFileContent(panel.path);
    if (latestContent === panel.savedContent) {
        return;
    }

    const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Reload', 'Keep Current'],
        defaultId: 0,
        cancelId: 1,
        message: `${panel.label} changed on disk.`,
        detail: panel.dirty
            ? 'Reloading will discard unsaved Bygone edits for this panel.'
            : 'Reload the changed file into Bygone?'
    });

    if (choice.response === 0) {
        panel.content = latestContent;
        panel.savedContent = latestContent;
        panel.dirty = false;
        await sendCurrentMultiDiff();
    } else {
        panel.savedContent = latestContent;
        panel.dirty = panel.content !== panel.savedContent;
        updateWindowTitle(session.multi.files.map((file) => file.label).join(' ↔ ') || 'Multi-Panel Compare');
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
    if (session.mode === 'diff') {
        return session.left.dirty || session.right.dirty;
    }

    if (session.mode === 'multi-diff') {
        return Boolean(session.multi?.files.some((file) => file.dirty));
    }

    if (session.mode === 'history') {
        return Boolean(session.history?.entries.some((entry) => entry.rightDirty));
    }

    if (session.mode === 'directory-history') {
        return Boolean(session.dirHistory?.entries.some((entry) => entry.rightDirty));
    }

    return false;
}

function createEmptySession() {
    return {
        mode: 'empty',
        left: createSideState('', ''),
        right: createSideState('', ''),
        history: null,
        directory: null,
        multi: null,
        dirHistory: null,
        returnDirectory: null
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

function createMultiPanelState(filePath) {
    const content = readFileContent(filePath);
    return {
        id: `panel-${nextMultiPanelId++}`,
        path: filePath,
        label: path.basename(filePath),
        content,
        savedContent: content,
        dirty: false,
        editable: true
    };
}

function createBlankMultiPanelState() {
    return {
        id: `panel-${nextMultiPanelId++}`,
        path: '',
        label: `Untitled ${nextMultiPanelId - 1}`,
        content: '',
        savedContent: '',
        dirty: false,
        editable: true
    };
}

function getHistoryNeighborIndex(historyState, entryIndex, direction) {
    const visibleIndices = getVisibleFileHistoryIndices(historyState);
    const currentPosition = visibleIndices.indexOf(entryIndex);
    if (currentPosition < 0) {
        return null;
    }

    if (direction === 'older') {
        return currentPosition < visibleIndices.length - 1 ? visibleIndices[currentPosition + 1] : null;
    }

    if (direction === 'newer') {
        return currentPosition > 0 ? visibleIndices[currentPosition - 1] : null;
    }

    return null;
}

function createHistoryMultiPanelState(entry, entryIndex, side, filePath) {
    const isRight = side === 'right';
    const editable = isRight && entry.commit === 'WORKTREE';
    const content = isRight ? entry.rightContent : entry.leftContent;
    const savedContent = editable ? readFileContent(filePath) : content;

    return {
        id: `panel-${nextMultiPanelId++}`,
        path: editable ? filePath : '',
        label: isRight ? entry.rightLabel : entry.leftLabel,
        content,
        savedContent,
        dirty: editable ? Boolean(entry.rightDirty) : false,
        editable,
        historyEntryIndex: entryIndex,
        historySide: side
    };
}

function readFileContent(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function runGit(args, cwd) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: GIT_MAX_BUFFER_BYTES
    }).trimEnd();
}

function readHeadCommit(repoRoot) {
    try {
        return runGit(['rev-parse', 'HEAD'], repoRoot);
    } catch {
        return undefined;
    }
}

function readPrimaryParent(repoRoot, commit) {
    const parents = runGit(['rev-list', '--parents', '-n', '1', commit], repoRoot)
        .trim()
        .split(' ')
        .slice(1);

    return parents[0];
}

function readCommitSummary(repoRoot, commit) {
    return runGit(['show', '-s', '--format=%s', commit], repoRoot);
}

function readCommitTimestamp(repoRoot, commit) {
    return runGit(['show', '-s', '--format=%cI', commit], repoRoot);
}

function parseGitHistoryRecords(logOutput) {
    return logOutput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            const [commit, shortCommit, timestamp, ...summaryParts] = line.split('\t');
            return {
                commit,
                shortCommit,
                timestamp,
                summary: summaryParts.join('\t')
            };
        });
}

function readGitBlob(repoRoot, commit, relativePath) {
    return execFileSync('git', ['show', `${commit}:${relativePath}`], {
        cwd: repoRoot,
        maxBuffer: GIT_MAX_BUFFER_BYTES
    });
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

function shellQuote(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
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

function scheduleCaptureIfNeeded() {
    if (!captureMode || !mainWindow || mainWindow.isDestroyed() || captureScheduled) {
        return;
    }

    captureScheduled = true;
    setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed() || !captureOutputPath) {
            return;
        }

        mainWindow.webContents.capturePage()
            .then((image) => {
                fs.mkdirSync(path.dirname(captureOutputPath), { recursive: true });
                fs.writeFileSync(captureOutputPath, image.toPNG());
                app.quit();
            })
            .catch((error) => {
                console.error(`Bygone capture failed: ${getErrorMessage(error)}`);
                process.exitCode = 1;
                app.exit(1);
            });
    }, 700);
}

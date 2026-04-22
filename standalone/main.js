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
const DEFAULT_FILE_HISTORY_CACHE_SIZE = 5;
const parsedFileHistoryCacheSize = Number.parseInt(process.env.BYGONE_FILE_HISTORY_CACHE_SIZE || '', 10);
const FILE_HISTORY_CACHE_SIZE = Number.isFinite(parsedFileHistoryCacheSize) && parsedFileHistoryCacheSize > 0
    ? parsedFileHistoryCacheSize
    : DEFAULT_FILE_HISTORY_CACHE_SIZE;
const commandLineToolPath = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'Microsoft', 'WindowsApps', 'bygone.cmd')
    : '/usr/local/bin/bygone';
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
    installStandardContextMenu(mainWindow);

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
    const isMac = process.platform === 'darwin';
    const template = [
        ...(isMac ? [{ role: 'appMenu' }] : []),
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
                ...(isMac
                    ? [{ role: 'close' }]
                    : [{ role: 'quit' }])
            ]
        },
        { role: 'editMenu' },
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
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
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

function installStandardContextMenu(windowInstance) {
    windowInstance.webContents.on('context-menu', (event, params) => {
        const template = [];
        const hasSelection = typeof params.selectionText === 'string' && params.selectionText.length > 0;

        if (params.isEditable) {
            template.push(
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                ...(process.platform === 'darwin' ? [{ role: 'pasteAndMatchStyle' }] : []),
                { role: 'delete' },
                { type: 'separator' },
                { role: 'selectAll' }
            );
        } else if (hasSelection) {
            template.push({ role: 'copy' }, { type: 'separator' }, { role: 'selectAll' });
        } else {
            template.push({ role: 'selectAll' });
        }

        event.preventDefault();
        Menu.buildFromTemplate(template).popup({ window: windowInstance });
    });
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
        await openDirectoryHistory(launchTarget.dirPath);
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
    const { cwd, launchArgs } = normalizeLaunchArgs(args);

    if (launchArgs.length === 0) {
        return { kind: 'directory-history', dirPath: cwd };
    }

    if (launchArgs[0] === '--diff' && launchArgs.length >= 3) {
        return { kind: 'diff', leftPath: resolveLaunchPath(launchArgs[1], cwd), rightPath: resolveLaunchPath(launchArgs[2], cwd) };
    }

    if (launchArgs[0] === '--dir' && launchArgs.length >= 3) {
        return { kind: 'directory', leftPath: resolveLaunchPath(launchArgs[1], cwd), rightPath: resolveLaunchPath(launchArgs[2], cwd) };
    }

    if (launchArgs[0] === '--dir3' && launchArgs.length >= 4) {
        return { kind: 'multi-directory', paths: launchArgs.slice(1, 4).map((candidate) => resolveLaunchPath(candidate, cwd)) };
    }

    if (launchArgs[0] === '--diff3' && launchArgs.length >= 4) {
        return { kind: 'multi-diff', paths: launchArgs.slice(1, 4).map((candidate) => resolveLaunchPath(candidate, cwd)) };
    }

    if (launchArgs[0] === '--history' && launchArgs.length >= 2) {
        return { kind: 'history', filePath: resolveLaunchPath(launchArgs[1], cwd) };
    }

    if (launchArgs[0] === '--dir-history' && launchArgs.length >= 2) {
        return { kind: 'directory-history', dirPath: resolveLaunchPath(launchArgs[1], cwd) };
    }

    if (launchArgs[0] === '--test') {
        return { kind: 'test' };
    }

    if (launchArgs[0] === '--smoke-test') {
        return { kind: 'smoke' };
    }

    if (launchArgs.length === 1 && !launchArgs[0].startsWith('--')) {
        const targetPath = resolveLaunchPath(launchArgs[0], cwd);
        return getPathKind(targetPath) === 'directory'
            ? { kind: 'directory-history', dirPath: targetPath }
            : { kind: 'history', filePath: targetPath };
    }

    if (launchArgs.length >= 2 && !launchArgs[0].startsWith('--')) {
        return { kind: 'pair', leftPath: resolveLaunchPath(launchArgs[0], cwd), rightPath: resolveLaunchPath(launchArgs[1], cwd) };
    }

    return { kind: 'directory-history', dirPath: cwd };
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

    if (
        message.type === 'navigateDirectoryEntry'
        && (message.direction === 'previous' || message.direction === 'next')
    ) {
        await navigateDirectoryEntry(message.direction);
        return;
    }

    if (message.type === 'returnToDirectory') {
        await returnToDirectoryView();
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
        multi: null,
        dirHistory: null
    };

    clearWatchers();
    await sendCurrentDirectoryDiff();
}

async function openDirectoryHistory(dirPath) {
    const resolvedDir = path.resolve(dirPath);
    if (getPathKind(resolvedDir) !== 'directory') {
        await showInfo('Directory history requires a directory.');
        return;
    }

    let historyState;
    try {
        historyState = buildDirectoryHistory(resolvedDir);
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
    await sendCurrentDirectoryHistoryEntry();
}

function buildDirectoryHistory(resolvedDir) {
    const repoRoot = fs.realpathSync(runGit(['rev-parse', '--show-toplevel'], resolvedDir));
    const realDir = fs.realpathSync(resolvedDir);
    const relativeDir = path.relative(repoRoot, realDir).replace(/\\/g, '/');
    const displayName = path.basename(realDir) || path.basename(repoRoot);
    const commitRecords = parseGitHistoryRecords(runGit(
        ['log', '--format=%H%x09%h%x09%cI%x09%s%x09%P', '--', relativeDir || '.'],
        repoRoot
    ));
    const parentMetadataByCommit = readCommitMetadataMap(
        repoRoot,
        [...new Set(commitRecords.map((commit) => commit.parentCommit).filter((commit) => typeof commit === 'string'))]
    );
    const entries = [];
    const workingTreeEntry = buildWorkingTreeDirectoryHistoryEntry(repoRoot, relativeDir, displayName);

    if (workingTreeEntry) {
        entries.push(workingTreeEntry);
    }

    for (const commit of commitRecords) {
        const parentCommit = commit.parentCommit;
        if (!parentCommit) {
            continue;
        }
        const parentMetadata = parentMetadataByCommit.get(parentCommit) ?? readCommitMetadata(repoRoot, parentCommit);

        entries.push({
            commit: commit.commit,
            parentCommit,
            shortCommit: commit.shortCommit,
            summary: commit.summary,
            timestamp: commit.timestamp,
            parentSummary: parentMetadata.summary,
            parentTimestamp: parentMetadata.timestamp,
            labels: [`${displayName} @ ${parentCommit.slice(0, 7)}`, `${displayName} @ ${commit.shortCommit}`]
        });
    }

    return {
        repoRoot,
        relativeDir,
        dirPath: realDir,
        displayName,
        entries,
        index: 0,
        viewRelativePath: null,
        materializedOrder: []
    };
}

function buildWorkingTreeDirectoryHistoryEntry(repoRoot, relativeDir, displayName) {
    const headCommit = readHeadCommit(repoRoot);
    if (!headCommit || !hasWorkingTreeDirectoryChanges(repoRoot, relativeDir)) {
        return undefined;
    }
    const headMetadata = readCommitMetadata(repoRoot, headCommit);

    return {
        commit: 'WORKTREE',
        parentCommit: headCommit,
        shortCommit: 'Working Tree',
        summary: '',
        timestamp: '',
        parentSummary: headMetadata.summary,
        parentTimestamp: headMetadata.timestamp,
        labels: [`${displayName} @ HEAD`, `${displayName} @ Working Tree`]
    };
}

function hasWorkingTreeDirectoryChanges(repoRoot, relativeDir) {
    return runGit(['status', '--porcelain', '--', relativeDir || '.'], repoRoot).trim().length > 0;
}

function materializeGitTree(repoRoot, relativeDir, targetRoot, commit = 'HEAD') {
    const lsArgs = ['ls-tree', '-r', '-z', '--name-only', commit];
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
        const targetFile = path.join(targetRoot, relativeFile);
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.writeFileSync(targetFile, readGitBlob(repoRoot, commit, relativeFile));
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
}

async function sendCurrentDirectoryHistoryEntry() {
    if (session.mode !== 'directory-history' || !session.dirHistory) {
        return;
    }

    const entry = session.dirHistory.entries[session.dirHistory.index];
    if (!entry) {
        await showError(`Error loading directory history entry: no entry at index ${session.dirHistory.index}`);
        return;
    }

    const history = buildDirectoryHistoryViewState(session.dirHistory, entry);

    if (session.dirHistory.viewRelativePath) {
        const relativePath = session.dirHistory.viewRelativePath;
        const view = buildDirectoryHistoryFileView(session.dirHistory, entry, relativePath);
        const leftExists = view.leftExists;
        const rightExists = view.rightExists;

        if (!leftExists && !rightExists) {
            session.dirHistory.viewRelativePath = null;
            await showInfo('That entry does not exist on either side for this history step.');
            await sendCurrentDirectoryHistoryEntry();
            return;
        }

        let directoryContext = {
            changedFiles: [relativePath],
            activeRelativePath: relativePath
        };
        try {
            const materializedEntry = ensureDirectoryHistoryEntryMaterialized(session.dirHistory, session.dirHistory.index);
            directoryContext = buildDirectoryContext(materializedEntry.dirs, relativePath, false) || directoryContext;
        } catch {
            // Best-effort; keep the focused path available in the rail.
        }

        postOrQueue({
            type: 'showDiff',
            file1: view.leftLabel,
            file2: view.rightLabel,
            leftContent: view.leftContent,
            rightContent: view.rightContent,
            diffModel: buildTwoWayDiffModel(view.leftContent, view.rightContent),
            canReturnToDirectory: true,
            directoryContext,
            editableSides: buildHistoryEditableSides(entry),
            history: {
                ...history,
                fileName: relativePath
            }
        });

        updateWindowTitle(`${relativePath} Directory History`);
        return;
    }

    let materializedEntry;
    try {
        materializedEntry = ensureDirectoryHistoryEntryMaterialized(session.dirHistory, session.dirHistory.index);
    } catch (error) {
        await showError(`Error loading directory history entry: ${getErrorMessage(error)}`);
        return;
    }

    const entries = buildMultiDirectoryComparison(materializedEntry.dirs);

    postOrQueue({
        type: 'showDirectoryDiff',
        leftLabel: materializedEntry.labels[0],
        rightLabel: materializedEntry.labels[1],
        labels: materializedEntry.labels,
        entries,
        history
    });

    updateWindowTitle(`${session.dirHistory.displayName} Directory History`);
}

function buildDirectoryHistoryViewState(dirHistory, entry) {
    return {
        fileName: dirHistory.displayName,
        canGoBack: dirHistory.index < dirHistory.entries.length - 1,
        canGoForward: dirHistory.index > 0,
        positionLabel: `${dirHistory.index + 1} / ${dirHistory.entries.length}`,
        leftCommitLabel: `${entry.parentCommit.slice(0, 7)} ${entry.parentSummary}`.trim(),
        leftTimestamp: entry.parentTimestamp,
        rightCommitLabel: `${entry.shortCommit} ${entry.summary}`.trim(),
        rightTimestamp: entry.timestamp
    };
}

function buildDirectoryHistoryFileView(dirHistory, entry, relativePath) {
    const repoRelativePath = joinRepoRelativePath(dirHistory.relativeDir, relativePath);
    const leftContent = readGitBlobText(dirHistory.repoRoot, entry.parentCommit, repoRelativePath);

    let rightContent;
    if (entry.commit === 'WORKTREE') {
        rightContent = entry.editedFiles?.[relativePath];
        if (rightContent === undefined) {
            rightContent = readFileContentSafe(path.join(dirHistory.dirPath, relativePath));
        }
    } else {
        rightContent = readGitBlobText(dirHistory.repoRoot, entry.commit, repoRelativePath);
    }

    const leftExists = typeof leftContent === 'string';
    const rightExists = typeof rightContent === 'string';

    return {
        leftExists,
        rightExists,
        leftContent: leftContent ?? '',
        rightContent: rightContent ?? '',
        leftLabel: `${entry.labels[0]} / ${relativePath}${leftExists ? '' : ' (missing)'}`,
        rightLabel: `${entry.labels[1]} / ${relativePath}${rightExists ? '' : ' (missing)'}`
    };
}

function joinRepoRelativePath(relativeDir, relativePath) {
    return relativeDir ? `${relativeDir}/${relativePath}` : relativePath;
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

function ensureFileHistoryEntryMaterialized(history, index) {
    const entry = history.entries[index];
    if (!entry) {
        throw new Error(`No file history entry at index ${index}`);
    }

    if (typeof entry.leftContent === 'string' && typeof entry.rightContent === 'string') {
        markFileHistoryEntryUsed(history, index);
        return entry;
    }

    const materialized = gitHistoryService.materializeFileHistoryEntry(entry);
    entry.leftContent = materialized.leftContent;
    entry.rightContent = materialized.rightContent;

    markFileHistoryEntryUsed(history, index);
    evictFileHistoryEntries(history, index);
    return entry;
}

function markFileHistoryEntryUsed(history, index) {
    if (!Array.isArray(history.materializedOrder)) {
        history.materializedOrder = [];
    }

    history.materializedOrder = history.materializedOrder.filter((value) => value !== index);
    history.materializedOrder.push(index);
}

function evictFileHistoryEntries(history, activeIndex) {
    const keepIndexes = new Set([activeIndex]);
    const materializedIndexes = [];

    for (let index = 0; index < history.entries.length; index += 1) {
        const entry = history.entries[index];
        if (typeof entry.leftContent === 'string' && typeof entry.rightContent === 'string') {
            materializedIndexes.push(index);
        }

        if (entry.commit === 'WORKTREE' && entry.rightDirty) {
            keepIndexes.add(index);
        }
    }

    if (materializedIndexes.length <= FILE_HISTORY_CACHE_SIZE) {
        return;
    }

    for (const candidateIndex of [...(history.materializedOrder || [])]) {
        if (materializedIndexes.length <= FILE_HISTORY_CACHE_SIZE) {
            break;
        }

        if (keepIndexes.has(candidateIndex)) {
            continue;
        }

        const candidate = history.entries[candidateIndex];
        if (typeof candidate?.leftContent !== 'string' || typeof candidate?.rightContent !== 'string') {
            continue;
        }

        releaseFileHistoryEntry(candidate);
        const candidatePosition = materializedIndexes.indexOf(candidateIndex);
        if (candidatePosition !== -1) {
            materializedIndexes.splice(candidatePosition, 1);
        }
    }

    history.materializedOrder = (history.materializedOrder || []).filter((index) => {
        const entry = history.entries[index];
        return typeof entry?.leftContent === 'string' && typeof entry?.rightContent === 'string';
    });
}

function releaseFileHistoryEntry(entry) {
    delete entry.leftContent;
    delete entry.rightContent;
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

async function openHistory(filePath) {
    const resolvedPath = path.resolve(filePath);
    let entries;

    try {
        entries = gitHistoryService.buildFileHistoryDescriptors(resolvedPath);
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
            materializedOrder: []
        },
        directory: null,
        multi: null,
        dirHistory: null
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
        },
        dirHistory: null
    };

    clearWatchers();
    await sendCurrentMultiDiff();
}

async function openDirectoryEntry(relativePath) {
    if (session.mode === 'directory-history' && session.dirHistory && !relativePath.endsWith('/')) {
        session.dirHistory.viewRelativePath = relativePath;
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

function getChangedFilePaths(entries, requireBothSides) {
    return entries
        .filter((entry) => (
            !entry.isDirectory
            && entry.status !== 'same'
            && (!requireBothSides || entry.sides.filter(Boolean).length >= 2)
        ))
        .map((entry) => entry.relativePath);
}

function buildDirectoryContext(dirs, activeRelativePath, requireBothSides) {
    const entries = buildMultiDirectoryComparison(dirs);
    const changedFiles = getChangedFilePaths(entries, requireBothSides);
    if (changedFiles.length === 0) {
        return null;
    }

    const activePath = typeof activeRelativePath === 'string' && changedFiles.includes(activeRelativePath)
        ? activeRelativePath
        : changedFiles[0];

    return {
        changedFiles,
        activeRelativePath: activePath
    };
}

function getNextRelativePath(changedPaths, currentPath, direction) {
    if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
        return null;
    }

    const step = direction === 'next' ? 1 : -1;
    const currentIndex = typeof currentPath === 'string' ? changedPaths.indexOf(currentPath) : -1;
    const startIndex = currentIndex >= 0
        ? currentIndex
        : (direction === 'next' ? -1 : 0);
    const nextIndex = (startIndex + step + changedPaths.length) % changedPaths.length;
    return changedPaths[nextIndex] || null;
}

async function navigateDirectoryEntry(direction) {
    if (session.mode === 'diff' && session.returnDirectory) {
        const entries = buildMultiDirectoryComparison(session.returnDirectory.dirs);
        const changedPaths = getChangedFilePaths(entries, false);
        const nextRelativePath = getNextRelativePath(changedPaths, session.returnDirectory.relativePath, direction);
        if (!nextRelativePath) {
            return;
        }

        await openDirectoryFileDiff(session.returnDirectory.dirs, session.returnDirectory.labels, nextRelativePath);
        return;
    }

    if (session.mode === 'directory-history' && session.dirHistory?.viewRelativePath) {
        let materializedEntry;
        try {
            materializedEntry = ensureDirectoryHistoryEntryMaterialized(session.dirHistory, session.dirHistory.index);
        } catch (error) {
            await showError(`Error loading directory history entry: ${getErrorMessage(error)}`);
            return;
        }

        const entries = buildMultiDirectoryComparison(materializedEntry.dirs);
        const changedPaths = getChangedFilePaths(entries, false);
        const nextRelativePath = getNextRelativePath(changedPaths, session.dirHistory.viewRelativePath, direction);
        if (!nextRelativePath) {
            return;
        }

        session.dirHistory.viewRelativePath = nextRelativePath;
        await sendCurrentDirectoryHistoryEntry();
    }
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
    const directoryContext = session.returnDirectory
        ? buildDirectoryContext(session.returnDirectory.dirs, session.returnDirectory.relativePath, false)
        : null;
    const message = {
        type: 'showDiff',
        file1: session.left.label,
        file2: session.right.label,
        leftContent: session.left.content,
        rightContent: session.right.content,
        diffModel,
        history: null,
        editableSides: {
            left: true,
            right: true
        },
        canReturnToDirectory: Boolean(session.returnDirectory),
        directoryContext: directoryContext || undefined
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

    let entry;
    try {
        entry = ensureFileHistoryEntryMaterialized(session.history, session.history.index);
    } catch (error) {
        await showError(`Error loading file history entry: ${getErrorMessage(error)}`);
        return;
    }

    const fileName = path.basename(session.history.filePath);
    const diffModel = buildTwoWayDiffModel(entry.leftContent, entry.rightContent);

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

function buildHistoryEditableSides(entry) {
    return {
        left: false,
        right: entry.commit === 'WORKTREE'
    };
}

async function updateEditableHistoryDiff(_leftContent, rightContent) {
    if (session.mode !== 'history' || !session.history) {
        return;
    }

    let entry;
    try {
        entry = ensureFileHistoryEntryMaterialized(session.history, session.history.index);
    } catch (error) {
        await showError(`Error updating history entry: ${getErrorMessage(error)}`);
        return;
    }

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
        if (direction === 'back' && session.dirHistory.index < session.dirHistory.entries.length - 1) {
            session.dirHistory.index += 1;
        } else if (direction === 'forward' && session.dirHistory.index > 0) {
            session.dirHistory.index -= 1;
        } else {
            return;
        }

        await sendCurrentDirectoryHistoryEntry();
        return;
    }

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
    if (session.mode === 'history') {
        return saveHistorySide(side);
    }

    if (session.mode === 'directory-history') {
        return saveDirectoryHistorySide(side);
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

async function saveDirtyHistoryEntries() {
    if (!session.history) {
        return true;
    }

    for (let index = 0; index < session.history.entries.length; index += 1) {
        const entry = session.history.entries[index];
        if (entry.commit === 'WORKTREE' && entry.rightDirty) {
            ensureFileHistoryEntryMaterialized(session.history, index);
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
    if (session.mode === 'diff') {
        return session.left.dirty || session.right.dirty;
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

function readFileContent(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function readFileContentSafe(filePath) {
    try {
        return readFileContent(filePath);
    } catch {
        return undefined;
    }
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

function readCommitMetadata(repoRoot, commit) {
    const output = runGit(['show', '-s', '--format=%cI%x09%s', commit], repoRoot);
    const [timestamp = '', ...summaryParts] = output.split('\t');
    return {
        timestamp,
        summary: summaryParts.join('\t')
    };
}

function readCommitMetadataMap(repoRoot, commits) {
    if (!Array.isArray(commits) || commits.length === 0) {
        return new Map();
    }

    const output = runGit(['show', '-s', '--format=%H%x09%cI%x09%s', ...commits], repoRoot);
    return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .reduce((map, line) => {
            const [commit, timestamp = '', ...summaryParts] = line.split('\t');
            if (commit) {
                map.set(commit, {
                    timestamp,
                    summary: summaryParts.join('\t')
                });
            }
            return map;
        }, new Map());
}

function parseGitHistoryRecords(logOutput) {
    return logOutput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            const parts = line.split('\t');
            const commit = parts[0];
            const shortCommit = parts[1];
            const timestamp = parts[2];
            const hasParentField = parts.length >= 5;
            const parentField = hasParentField ? (parts[parts.length - 1] || '') : '';
            const summaryParts = hasParentField ? parts.slice(3, -1) : parts.slice(3);
            const parentCommit = parentField.split(' ').find((candidate) => candidate.length > 0);
            return {
                commit,
                shortCommit,
                timestamp,
                summary: summaryParts.join('\t'),
                parentCommit
            };
        });
}

function readGitBlob(repoRoot, commit, relativePath) {
    return execFileSync('git', ['show', `${commit}:${relativePath}`], {
        cwd: repoRoot,
        maxBuffer: GIT_MAX_BUFFER_BYTES
    });
}

function readGitBlobText(repoRoot, commit, relativePath) {
    try {
        return execFileSync('git', ['show', `${commit}:${relativePath}`], {
            cwd: repoRoot,
            encoding: 'utf8',
            maxBuffer: GIT_MAX_BUFFER_BYTES
        });
    } catch {
        return undefined;
    }
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

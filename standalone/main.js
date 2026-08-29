const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { buildTwoWayDiffModel } = require('../src/diffEngine.ts');
const { buildBinaryComparison, classifyFile } = require('../src/binaryComparison.ts');
const { GitHistoryService } = require('../src/gitHistory.ts');
const { createJavaScriptSampleFilePair } = require('../src/sampleFiles.ts');
const { buildMultiDirectoryComparison } = require('../src/directoryDiff.ts');
const { searchChangeSetSnapshots } = require('../src/changeSetSearch.ts');
const { detectRipgrepCapability, startRepositorySearch } = require('../src/repositorySearch.ts');
const { buildRepositoryReplacementPlan, applyRepositoryReplacementPlan, undoRepositoryReplacementPlan } = require('../src/repositoryReplace.ts');
const { searchFileHistory } = require('../src/gitHistorySearch.ts');
const { classifyAuthoredTourPaths, discoverAuthoredTourDocument } = require('../src/tourDocument.ts');
const { materializeBranchReviewTrees, materializeGitTree, resolveBranchReviewRange, resolveReviewPathPair } = require('../src/gitComparison.ts');
const {
    ensurePullRequestWorkspace,
    isPullRequestInput,
    parsePullRequestRef,
    resolvePullRequest,
    toPullRequestSummary
} = require('../src/pullRequest.ts');
const { buildDirectoryNavigationState } = require('../media/navigationUtils.js');
const { collectComparisonSelection, getMenuCapabilities } = require('./menuUtils.js');
const {
    cloneSessionSource,
    createBranchReviewSource,
    createDirectoriesSource,
    createDirectoryHistorySource,
    createFileHistorySource,
    createFilesSource,
    createGitRefsSource,
    isRefreshableSource,
    sessionSourcesEqual
} = require('./sessionSource.js');
const { generateCompletion, SUPPORTED_SHELLS } = require('../cli/completions.js');
const { tokenMatches, tokensFor } = require('../cli/commandSpec.js');
const { startPresentation } = require('../cli/present.js');
const { resolveWorkingDirectory } = require('../cli/workingDirectory.js');
const { getCliArgsFromArgv, getForwardedLaunchArgs } = require('./launchArgs.js');
const { readWindowState, writeWindowState } = require('./windowState.js');
const {
    buildHistoryTitle,
    buildStandaloneSessionTitle,
    buildTourWindowTitle
} = require('../src/windowTitle.ts');

const APP_NAME = 'Bygone';
const APP_VERSION = require('../package.json').version;
const HELP_URL = 'https://github.com/davidmashburn/bygone';
const EXPLORE_HELP_URL = `${HELP_URL}/blob/main/docs/explore.md`;
const PRESENT_HELP_URL = `${HELP_URL}/blob/main/docs/present.md`;
const packageRoot = path.join(__dirname, '..');
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
const initialCliArgs = getCliArgs();
const launchArguments = parseLaunchArgs(initialCliArgs);
const smokeTestMode = launchArguments.kind === 'smoke'
    || launchArguments.kind === 'smoke-multi'
    || launchArguments.kind === 'smoke-directory'
    || launchArguments.kind === 'smoke-directory-history';
const captureOutputPath = launchArguments.capturePath ? path.resolve(launchArguments.capturePath) : null;
const captureMode = Boolean(captureOutputPath);
const launchWindowWidth = Number.isFinite(launchArguments.windowWidth) ? launchArguments.windowWidth : 1500;
const launchWindowHeight = Number.isFinite(launchArguments.windowHeight) ? launchArguments.windowHeight : 960;
const shouldUseSingleInstanceLock = app.isPackaged && !smokeTestMode && !captureMode;
const shouldRestoreWindowState = initialCliArgs.length === 0 && !smokeTestMode && !captureMode;

app.setName(APP_NAME);
if (typeof app.setAppUserModelId === 'function') {
    app.setAppUserModelId('com.davidmashburn.bygone');
}

const singleInstanceLock = shouldUseSingleInstanceLock
    ? app.requestSingleInstanceLock({ launchArgs: getCliArgs() })
    : true;

let mainWindow;
let latestTourWindow;
const tourPresentations = new Map();
const activeTourServers = new Set();
let hostReady = false;
let pendingMessage;
let closingForSave = false;
let fileWatchers = [];
let session = createEmptySession();
let smokeTimeout;
let directoryHistorySmokeDrilldownStarted = false;
let pendingOpenPaths = [];
let historyIncludeStagedPreference = false;
let historySkipUnchangedPreference = false;
let captureScheduled = false;
let captureRenderReady = false;
let nextMultiPanelId = 1;
let refreshInProgress = false;
let refreshFailure = null;
let navigationRequestId = 0;
const pendingNavigationRequests = new Map();
let sourceMonitorInterval;
let sourceChangeTimer;
let sourceFingerprint = null;
let sourceStale = false;
let wordWrapEnabled = false;
let wordWrapAvailable = false;
let repositorySearch = null;
let lastRepositoryReplacement = null;
let pendingLaunchPrompt = null;
let nextLaunchPromptId = 1;
let appIsQuitting = false;
let restoringWindowState = false;

if (!singleInstanceLock) {
    app.quit();
}

app.whenReady().then(async () => {
    installApplicationMenu();
    initializeAutoUpdates();
    await openInitialLaunchTarget();
}).catch(async (error) => {
    ensureMainWindow();
    await showError(`Could not open Bygone: ${getErrorMessage(error)}`);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    appIsQuitting = true;
    persistOpenWindowState();
});

app.on('will-quit', () => {
    repositorySearch?.handle?.cancel();
    for (const server of [...activeTourServers]) {
        closeTourServer(server);
    }
    cleanupGitDiffTempRoots([...trackedGitDiffTempRoots]);
});

app.on('activate', async () => {
    if (!BrowserWindow.getAllWindows().some((window) => window.isVisible())) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
            return;
        }
        createMainWindow();
        installApplicationMenu();
        await openBlankDiff();
    }
});

if (shouldUseSingleInstanceLock) {
    app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
        const launchTarget = parseLaunchArgs(getForwardedLaunchArgs(argv, additionalData));
        void routeLaunchTarget(launchTarget)
            .then(() => focusLaunchTarget(launchTarget))
            .catch((error) => showError(`Could not open command-line request: ${getErrorMessage(error)}`));
    });
}

app.on('open-file', (event, filePath) => {
    event.preventDefault();
    pendingOpenPaths.push(filePath);

    if (app.isReady()) {
        void routePendingOpenPaths().catch(async (error) => {
            ensureMainWindow();
            await showError(`Could not open Bygone presentation: ${getErrorMessage(error)}`);
        });
    }
});

ipcMain.on('bygone:renderer-message', (event, message) => {
    if (!isTrustedRendererEvent(event)) {
        return;
    }

    void handleRendererMessage(message).catch((error) => {
        console.error(`Bygone renderer message failed: ${getErrorMessage(error)}`);
    });
});

function isTrustedRendererEvent(event) {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
        return false;
    }

    const expectedUrl = pathToFileURL(path.join(__dirname, '..', 'standalone', 'index.html')).toString();
    return event.senderFrame === mainWindow.webContents.mainFrame
        && event.senderFrame.url === expectedUrl;
}

function createMainWindow({ show = !smokeTestMode } = {}) {
    mainWindow = new BrowserWindow({
        width: launchWindowWidth,
        height: launchWindowHeight,
        minWidth: 960,
        minHeight: 640,
        show,
        title: APP_NAME,
        webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'standalone-preload.js')
        }
    });

    hostReady = false;
    pendingMessage = undefined;
    const expectedUrl = pathToFileURL(path.join(__dirname, '..', 'standalone', 'index.html')).toString();
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        if (navigationUrl !== expectedUrl) {
            event.preventDefault();
        }
    });
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
        for (const pending of pendingNavigationRequests.values()) {
            clearTimeout(pending.timeout);
            pending.resolve(null);
        }
        pendingNavigationRequests.clear();
        mainWindow = undefined;
        session = createEmptySession();
        closingForSave = false;
        clearTimeout(smokeTimeout);
        smokeTimeout = undefined;
        captureScheduled = false;
        captureRenderReady = false;
        if (!appIsQuitting && (process.platform === 'darwin' || BrowserWindow.getAllWindows().length > 0)) {
            persistOpenWindowState();
        }
    });
}

function ensureMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        createMainWindow();
        installApplicationMenu();
    }
}

async function openTourPresentation(args, cwd) {
    let ownerWindow = null;
    const presentation = await startPresentation(args, cwd, packageRoot, {
        announce: false,
        open: false,
        onNarrationClaim: () => claimTourNarration(ownerWindow)
    });
    activeTourServers.add(presentation.server);

    try {
        ownerWindow = await showTourWindow(presentation.url, presentation.server, presentation.manifest, {
            args: [...args],
            cwd: path.resolve(cwd)
        });
    } catch (error) {
        closeTourServer(presentation.server);
        throw error;
    }
}

async function openAuthoredTourDocument(sourcePath) {
    const document = discoverAuthoredTourDocument(sourcePath);
    await openTourPresentation(['--tour', document.documentPath], document.repoRoot);
}

async function showTourWindow(url, server, manifest, launch) {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' || parsedUrl.hostname !== '127.0.0.1') {
        throw new Error('Tour presenter URL must use the local Bygone server.');
    }
    const tourOrigin = parsedUrl.origin;
    const tourWindow = new BrowserWindow({
        width: launchWindowWidth,
        height: launchWindowHeight,
        minWidth: 960,
        minHeight: 640,
        show: false,
        title: buildTourWindowTitle(manifest, APP_NAME),
        webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            backgroundThrottling: false
        }
    });
    latestTourWindow = tourWindow;
    tourPresentations.set(tourWindow, { server, origin: tourOrigin, launch });
    installApplicationMenu();

    tourWindow.webContents.setWindowOpenHandler(({ url: externalUrl }) => {
        if (/^https?:\/\//i.test(externalUrl)) {
            void shell.openExternal(externalUrl);
        }
        return { action: 'deny' };
    });
    tourWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        let navigationOrigin;
        try {
            navigationOrigin = new URL(navigationUrl).origin;
        } catch {
            navigationOrigin = undefined;
        }
        if (navigationOrigin !== tourOrigin) {
            event.preventDefault();
            if (/^https?:\/\//i.test(navigationUrl)) {
                void shell.openExternal(navigationUrl);
            }
        }
    });
    tourWindow.on('closed', () => {
        tourPresentations.delete(tourWindow);
        closeTourServer(server);
        if (latestTourWindow === tourWindow) {
            latestTourWindow = getLatestTourWindow();
        }
        installApplicationMenu();
        if (!appIsQuitting && (process.platform === 'darwin' || BrowserWindow.getAllWindows().length > 0)) {
            persistOpenWindowState();
        }
    });

    const tourWindowTitle = buildTourWindowTitle(manifest, APP_NAME);
    const applyTourWindowTitle = () => {
        if (!tourWindow.isDestroyed()) {
            tourWindow.setTitle(tourWindowTitle);
        }
    };
    tourWindow.webContents.on('page-title-updated', (event) => {
        event.preventDefault();
        queueMicrotask(applyTourWindowTitle);
    });
    tourWindow.webContents.on('did-finish-load', applyTourWindowTitle);

    try {
        await tourWindow.loadURL(url);
    } catch (error) {
        tourWindow.destroy();
        throw error;
    }
    applyTourWindowTitle();
    tourWindow.show();
    tourWindow.focus();
    persistOpenWindowState();
    return tourWindow;
}

function getLatestTourWindow() {
    return [...tourPresentations.keys()]
        .reverse()
        .find((window) => !window.isDestroyed());
}

function claimTourNarration(ownerWindow) {
    if (!ownerWindow || ownerWindow.isDestroyed()) return;
    for (const tourWindow of tourPresentations.keys()) {
        if (tourWindow !== ownerWindow && !tourWindow.isDestroyed()) {
            dispatchTourPresenterCommand(tourWindow, 'pauseNarration');
        }
    }
}

function dispatchTourPresenterCommand(tourWindow, command) {
    if (!tourWindow || tourWindow.isDestroyed()) return;
    const script = `window.dispatchEvent(new CustomEvent('bygone:tour-command', { detail: ${JSON.stringify(command)} }))`;
    void tourWindow.webContents.executeJavaScript(script).catch(() => {});
}

function toggleLatestTourNarration() {
    const tourWindow = getLatestTourWindow();
    if (tourWindow) dispatchTourPresenterCommand(tourWindow, 'toggleNarration');
}

function closeTourServer(server) {
    if (!server || !activeTourServers.delete(server)) {
        return;
    }
    server.close();
}

function focusLaunchTarget(launchTarget) {
    const targetWindow = launchTarget.kind === 'tour' || launchTarget.kind === 'tour-document'
        ? latestTourWindow
        : mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
        return;
    }
    if (targetWindow.isMinimized()) {
        targetWindow.restore();
    }
    targetWindow.show();
    targetWindow.focus();
}

function installApplicationMenu() {
    const {
        isMultiDiff,
        isTwoWayDiff,
        isHistory,
        canFind,
        canSearchComparison,
        canReplace,
        canReturnToDirectory,
        canAddPanel,
        canRemovePanel,
        canRefreshSession
    } = getMenuCapabilities(session);
    const fileActionItems = isMultiDiff
        ? [
            {
                label: 'Save Active File',
                accelerator: 'CmdOrCtrl+S',
                enabled: Boolean(session.multi?.activePanelId),
                click: () => { void saveSide('left'); }
            },
            {
                label: 'Save All',
                accelerator: 'CmdOrCtrl+Shift+S',
                enabled: isMultiDiff,
                click: () => { void saveAllDirtySides(); }
            },
            {
                label: 'Reload Active File',
                enabled: Boolean(session.multi?.activePanelId),
                click: () => { void reloadSide('left'); }
            }
        ]
        : [
            {
                label: 'Save Left',
                accelerator: 'CmdOrCtrl+S',
                enabled: isTwoWayDiff || isHistory,
                click: () => { void saveSide('left'); }
            },
            {
                label: 'Save Right',
                accelerator: 'CmdOrCtrl+Shift+S',
                enabled: isTwoWayDiff || isHistory,
                click: () => { void saveSide('right'); }
            },
            {
                label: 'Save All',
                enabled: isTwoWayDiff || isHistory,
                click: () => { void saveAllDirtySides(); }
            },
            {
                label: 'Reload Left',
                enabled: isTwoWayDiff,
                click: () => { void reloadSide('left'); }
            },
            {
                label: 'Reload Right',
                enabled: isTwoWayDiff,
                click: () => { void reloadSide('right'); }
            }
        ];

    const isMac = process.platform === 'darwin';
    const isDevelopment = !app.isPackaged;
    const aboutItem = {
        label: `About ${APP_NAME}`,
        click: () => {
            void dialog.showMessageBox(mainWindow ?? undefined, {
                type: 'info',
                title: `About ${APP_NAME}`,
                message: APP_NAME,
                detail: `Version ${APP_VERSION}\n\n${HELP_URL}`,
                buttons: ['OK']
            });
        }
    };

    const template = [
        ...(isMac ? [{
            label: APP_NAME,
            submenu: [
                aboutItem,
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Blank Comparison',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => runMenuAction('open a blank comparison', openBlankDiff)
                },
                { type: 'separator' },
                {
                    label: 'Compare Files…',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => runMenuAction('compare files', openCompareFilesDialog)
                },
                {
                    label: 'Compare Directories…',
                    accelerator: 'CmdOrCtrl+Shift+O',
                    click: () => runMenuAction('compare directories', openCompareDirectoriesDialog)
                },
                { type: 'separator' },
                {
                    label: 'View File or Directory History…',
                    accelerator: 'CmdOrCtrl+Shift+H',
                    click: () => runMenuAction('open Git history', openHistoryDialog)
                },
                {
                    label: 'Open Authored Tour…',
                    click: () => runMenuAction('open an authored tour', openAuthoredTourDialog)
                },
                { type: 'separator' },
                {
                    label: 'Comparison Panels',
                    submenu: [
                        {
                            label: 'Add Panel to Left…',
                            enabled: canAddPanel,
                            click: () => runMenuAction('add a panel', () => addPanelFromMenu('left'))
                        },
                        {
                            label: 'Add Panel to Right…',
                            enabled: canAddPanel,
                            click: () => runMenuAction('add a panel', () => addPanelFromMenu('right'))
                        },
                        {
                            label: 'Remove Active Panel',
                            enabled: canRemovePanel,
                            click: () => runMenuAction('remove the active panel', removeActivePanelFromMenu)
                        }
                    ]
                },
                { type: 'separator' },
                ...fileActionItems,
                ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }])
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'pasteAndMatchStyle' },
                { role: 'delete' },
                { role: 'selectAll' },
                {
                    label: 'Selection',
                    enabled: canFind,
                    submenu: [
                        editorActionItem('Add Cursor Above', 'editor.action.insertCursorAbove'),
                        editorActionItem('Add Cursor Below', 'editor.action.insertCursorBelow'),
                        { type: 'separator' },
                        editorActionItem('Add Next Occurrence', 'editor.action.addSelectionToNextFindMatch'),
                        editorActionItem('Add Previous Occurrence', 'editor.action.addSelectionToPreviousFindMatch'),
                        editorActionItem('Select All Occurrences', 'editor.action.selectHighlights'),
                        { type: 'separator' },
                        editorActionItem('Expand Selection', 'editor.action.smartSelect.expand'),
                        editorActionItem('Shrink Selection', 'editor.action.smartSelect.shrink')
                    ]
                },
                { type: 'separator' },
                {
                    label: 'Find',
                    accelerator: 'CmdOrCtrl+F',
                    enabled: canFind,
                    click: () => postFindCommand('open')
                },
                {
                    label: 'Find Next',
                    accelerator: 'F3',
                    enabled: canFind,
                    click: () => postFindCommand('next')
                },
                {
                    label: 'Find Previous',
                    accelerator: 'Shift+F3',
                    enabled: canFind,
                    click: () => postFindCommand('previous')
                },
                {
                    label: 'Search Comparison…',
                    accelerator: 'CmdOrCtrl+Shift+F',
                    enabled: canSearchComparison,
                    click: postVisibleSearchCommand
                },
                {
                    label: 'Search in Files…',
                    accelerator: 'CmdOrCtrl+Alt+F',
                    click: () => runMenuAction('search in files', openRepositorySearchDialog)
                },
                { type: 'separator' },
                {
                    label: 'Replace…',
                    accelerator: 'CmdOrCtrl+H',
                    enabled: canReplace,
                    click: () => postFindCommand('replace')
                },
                {
                    label: 'Replace All',
                    accelerator: 'CmdOrCtrl+Alt+Enter',
                    enabled: canReplace,
                    click: () => postFindCommand('replaceAll')
                },
                { type: 'separator' },
                {
                    label: 'Lines',
                    enabled: canFind,
                    submenu: [
                        editorActionItem('Move Line Up', 'editor.action.moveLinesUpAction'),
                        editorActionItem('Move Line Down', 'editor.action.moveLinesDownAction'),
                        editorActionItem('Copy Line Up', 'editor.action.copyLinesUpAction'),
                        editorActionItem('Copy Line Down', 'editor.action.copyLinesDownAction'),
                        editorActionItem('Delete Line', 'editor.action.deleteLines'),
                        editorActionItem('Insert Line Above', 'editor.action.insertLineBefore'),
                        editorActionItem('Insert Line Below', 'editor.action.insertLineAfter'),
                        editorActionItem('Join Lines', 'editor.action.joinLines'),
                        editorActionItem('Transpose Characters', 'editor.action.transpose'),
                        { type: 'separator' },
                        editorActionItem('Indent Lines', 'editor.action.indentLines'),
                        editorActionItem('Outdent Lines', 'editor.action.outdentLines'),
                        editorActionItem('Reindent Lines', 'editor.action.reindentlines'),
                        { type: 'separator' },
                        editorActionItem('Toggle Line Comment', 'editor.action.commentLine'),
                        editorActionItem('Toggle Block Comment', 'editor.action.blockComment')
                    ]
                }
            ]
        },
        {
            label: 'Git',
            submenu: [
                {
                    label: 'Compare Revisions…',
                    click: () => runMenuAction('compare Git revisions', openGitRefsDialog)
                },
                {
                    label: 'Review Branch Change…',
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: () => runMenuAction('review a branch change', openBranchReviewDialog)
                },
                {
                    label: 'Review Pull Request…',
                    click: () => runMenuAction('review a pull request', openPullRequestReviewDialog)
                }
            ]
        },
        {
            label: 'Present',
            submenu: [
                {
                    label: 'Present Current Branch',
                    click: () => runMenuAction('present the current branch', presentCurrentBranch)
                },
                {
                    label: 'Present Branch or Ref…',
                    click: () => runMenuAction('present a branch or ref', openPresentBranchDialog)
                },
                { type: 'separator' },
                {
                    label: 'Listen to Tour',
                    enabled: Boolean(getLatestTourWindow()),
                    click: toggleLatestTourNarration
                }
            ]
        },
        {
            label: 'Navigate',
            submenu: [
                {
                    label: 'Next Change',
                    accelerator: 'F7',
                    enabled: canFind,
                    click: () => postToRenderer({ type: 'navigateChange', direction: 1 })
                },
                {
                    label: 'Previous Change',
                    accelerator: 'Shift+F7',
                    enabled: canFind,
                    click: () => postToRenderer({ type: 'navigateChange', direction: -1 })
                },
                { type: 'separator' },
                {
                    label: 'Back to Directory',
                    accelerator: 'CmdOrCtrl+[',
                    enabled: canReturnToDirectory,
                    click: () => { void returnToDirectoryView(); }
                },
                { type: 'separator' },
                {
                    label: 'Older Commit',
                    accelerator: 'Alt+Left',
                    enabled: isHistory,
                    click: () => { void navigateHistory('back'); }
                },
                {
                    label: 'Newer Commit',
                    accelerator: 'Alt+Right',
                    enabled: isHistory,
                    click: () => { void navigateHistory('forward'); }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Refresh Session',
                    accelerator: 'CmdOrCtrl+R',
                    enabled: canRefreshSession && !refreshInProgress,
                    click: () => { void refreshSession(); }
                },
                {
                    label: 'Wrap Long Lines',
                    accelerator: 'Alt+Z',
                    type: 'checkbox',
                    checked: wordWrapEnabled,
                    enabled: wordWrapAvailable,
                    click: () => postToRenderer({ type: 'toggleWordWrap' })
                },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' }
            ]
        },
        {
            label: 'Window',
            role: 'windowMenu',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])
            ]
        },
        ...(isDevelopment ? [{
            label: 'Developer',
            submenu: [
                {
                    label: 'Compare Test Fixtures',
                    accelerator: 'CmdOrCtrl+Shift+T',
                    click: () => { void compareTestFiles(); }
                },
                { role: 'toggleDevTools' }
            ]
        }] : []),
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Explore Guide',
                    click: () => { void shell.openExternal(EXPLORE_HELP_URL); }
                },
                {
                    label: 'Present and Tour Guide',
                    click: () => { void shell.openExternal(PRESENT_HELP_URL); }
                },
                { type: 'separator' },
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
                },
                {
                    label: 'Repository Search Status…',
                    click: () => { void showRepositorySearchStatus(); }
                },
                ...(isMac ? [] : [{ type: 'separator' }, aboutItem])
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function runMenuAction(description, action) {
    void Promise.resolve()
        .then(action)
        .catch((error) => showError(`Could not ${description}: ${getErrorMessage(error)}`));
}

async function presentCurrentBranch() {
    const repoRoot = await resolveOrChooseGitRepository('Select a Git repository to present');
    if (repoRoot) {
        await openTourPresentation([], repoRoot);
    }
}

async function openPresentBranchDialog() {
    const repoRoot = await resolveOrChooseGitRepository('Select a Git repository to present');
    if (!repoRoot) {
        return;
    }

    openLaunchPrompt({
        kind: 'present-branch',
        title: 'Present Branch or Ref',
        description: `Repository: ${repoRoot}`,
        submitLabel: 'Present',
        fields: [
            { name: 'head', label: 'Head branch or ref', value: 'HEAD', required: true },
            { name: 'base', label: 'Base branch or ref (optional)', value: '' }
        ]
    }, async (values) => {
        const head = values.head.trim() || 'HEAD';
        const base = values.base.trim();
        const args = [head];
        if (base) {
            args.push(tokensFor('base')[0], base);
        }
        await openTourPresentation(args, repoRoot);
    });
}

async function showRepositorySearchStatus() {
    const capability = detectRipgrepCapability();
    if (capability.kind === 'available') {
        await showInfo(`Search in Files can use ${capability.version} at ${capability.executable}.`);
        return;
    }
    if (capability.kind === 'unsupported') {
        await showInfo(`${capability.version} is below Bygone's minimum supported ripgrep major version ${capability.minimumMajorVersion}. Set BYGONE_RG_PATH to a newer executable.`);
        return;
    }
    await showInfo(`Experimental repository search is unavailable: ${capability.message}. Install ripgrep or set BYGONE_RG_PATH to an executable.`);
}

async function openRepositorySearchDialog() {
    const capability = detectRipgrepCapability();
    if (capability.kind !== 'available') {
        await showRepositorySearchStatus();
        return;
    }
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
        title: 'Choose Search Root',
        properties: ['openDirectory']
    });
    const root = result.filePaths[0];
    if (result.canceled || !root) return;
    repositorySearch?.handle?.cancel();
    repositorySearch = {
        root: fs.realpathSync(root),
        executable: capability.executable,
        requestId: 0,
        handle: null,
        startedAt: 0,
        resultKeys: new Set(),
        resultPaths: new Set(),
        completedQuery: null,
        replacementPlan: null
    };
    postToRenderer({ type: 'openRepositorySearch', root: repositorySearch.root });
}

async function openAuthoredTourDialog() {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
        title: 'Open Authored Bygone Tour',
        properties: ['openFile'],
        filters: [
            { name: 'Bygone presentations', extensions: ['bygone', 'yaml', 'yml'] },
            { name: 'All files', extensions: ['*'] }
        ]
    });
    const tourPath = result.filePaths[0];
    if (result.canceled || !tourPath) {
        return;
    }
    await openAuthoredTourDocument(tourPath);
}

function postFindCommand(command) {
    if (!getMenuCapabilities(session).canFind) {
        return;
    }
    postToRenderer({ type: 'find', command });
}

function editorActionItem(label, actionId) {
    return {
        label,
        click: () => postToRenderer({ type: 'editorAction', actionId })
    };
}

function postVisibleSearchCommand() {
    if (!getMenuCapabilities(session).canSearchComparison) return;
    postToRenderer({ type: 'visibleSearch' });
}

async function installCommandLineTools() {
    const launcher = buildCommandLineLauncher();

    try {
        fs.mkdirSync(path.dirname(commandLineToolPath), { recursive: true });
        fs.writeFileSync(commandLineToolPath, launcher.content, 'utf8');
        fs.chmodSync(commandLineToolPath, 0o755);
        const completionPaths = installShellCompletionFiles();
        await showInfo(
            `Installed command line tool at ${commandLineToolPath}\n\nShell completions:\n`
            + completionPaths.map((completionPath) => `- ${completionPath}`).join('\n')
        );
    } catch (error) {
        await showError(
            `Could not install command line tool at ${commandLineToolPath}.\n\n`
            + `Run this manually:\n${launcher.manualCommand}\n${completionManualCommands()}\n\n`
            + getErrorMessage(error)
        );
    }
}

function buildCommandLineLauncher() {
    if (process.platform === 'darwin') {
        const content = buildPosixCommandLineLauncher(`exec ${shellQuote(process.execPath)} --cwd "$PWD" "$@"`);
        return {
            content,
            manualCommand: `sudo tee ${shellQuote(commandLineToolPath)} >/dev/null <<'EOF'\n${content}EOF\nsudo chmod +x ${shellQuote(commandLineToolPath)}`
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
    const content = buildPosixCommandLineLauncher(`exec ${shellQuote(executablePath)} --cwd "$PWD" "$@"`);
    return {
        content,
        manualCommand: `sudo tee ${shellQuote(commandLineToolPath)} >/dev/null <<'EOF'\n${content}EOF\nsudo chmod +x ${shellQuote(commandLineToolPath)}`
    };
}

function buildPosixCommandLineLauncher(applicationCommand) {
    const completionCommand = tokensFor('completion')[0];
    const cases = SUPPORTED_SHELLS.map((shell) => {
        const delimiter = `BYGONE_${shell.toUpperCase()}_COMPLETION`;
        return `        ${shell})\n            cat <<'${delimiter}'\n${generateCompletion(shell)}${delimiter}\n            ;;`;
    }).join('\n');

    return `#!/usr/bin/env sh
if [ "$1" = "${completionCommand}" ]; then
    case "$2" in
${cases}
        *)
            echo "Usage: bygone completion <${SUPPORTED_SHELLS.join('|')}>" >&2
            exit 2
            ;;
    esac
    exit 0
fi
${applicationCommand}
`;
}

function installShellCompletionFiles() {
    if (process.platform === 'win32') {
        return [];
    }

    const prefix = path.dirname(path.dirname(commandLineToolPath));
    const targets = [
        ['zsh', path.join(prefix, 'share', 'zsh', 'site-functions', '_bygone')],
        ['bash', path.join(prefix, 'etc', 'bash_completion.d', 'bygone')],
        ['fish', path.join(prefix, 'share', 'fish', 'vendor_completions.d', 'bygone.fish')]
    ];

    for (const [shellName, targetPath] of targets) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, generateCompletion(shellName), 'utf8');
    }
    return targets.map(([, targetPath]) => targetPath);
}

function completionManualCommands() {
    if (process.platform === 'win32') {
        return '';
    }
    const prefix = path.dirname(path.dirname(commandLineToolPath));
    const targets = [
        ['zsh', path.join(prefix, 'share', 'zsh', 'site-functions', '_bygone')],
        ['bash', path.join(prefix, 'etc', 'bash_completion.d', 'bygone')],
        ['fish', path.join(prefix, 'share', 'fish', 'vendor_completions.d', 'bygone.fish')]
    ];
    return targets.map(([shellName, targetPath]) => (
        `sudo mkdir -p ${shellQuote(path.dirname(targetPath))}\n`
        + `bygone completion ${shellName} | sudo tee ${shellQuote(targetPath)} >/dev/null`
    )).join('\n');
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

    if (shouldRestoreWindowState && await restoreOpenWindowState()) {
        return;
    }

    await routeLaunchTarget(launchArguments);
}

async function restoreOpenWindowState() {
    const savedState = readWindowState(getWindowStatePath());
    if (!savedState || (!savedState.main && savedState.tours.length === 0)) {
        return false;
    }

    let restoredAnyWindow = false;
    restoringWindowState = true;
    try {
        if (savedState.main) {
            ensureMainWindow();
            try {
                await restoreMainSession(savedState.main.source);
            } catch (error) {
                console.error(`Could not restore the previous Bygone session: ${getErrorMessage(error)}`);
                await openBlankDiff();
            }
            restoredAnyWindow = true;
        }

        for (const tour of savedState.tours) {
            try {
                await openTourPresentation(tour.args, tour.cwd);
                restoredAnyWindow = true;
            } catch (error) {
                console.error(`Could not restore a previous Bygone tour: ${getErrorMessage(error)}`);
            }
        }
    } finally {
        restoringWindowState = false;
        persistOpenWindowState();
    }
    return restoredAnyWindow;
}

async function restoreMainSession(source) {
    if (source.kind === 'blank') {
        await openBlankDiff();
        return;
    }

    session = buildSessionFromSource(source);
    historyIncludeStagedPreference = Boolean(source.includeStaged ?? historyIncludeStagedPreference);
    historySkipUnchangedPreference = Boolean(source.skipUnchanged ?? historySkipUnchangedPreference);
    clearWatchers();
    updateWatchers();
    await sendCurrentSession();
}

function persistOpenWindowState() {
    if (restoringWindowState || !app.isReady()) return;
    const hasMainWindow = Boolean(mainWindow && !mainWindow.isDestroyed());
    const mainSource = hasMainWindow && (isRefreshableSource(session.source) || session.source?.kind === 'blank')
        ? cloneSessionSource(session.source)
        : hasMainWindow
            ? { kind: 'blank' }
            : null;
    const tours = [...tourPresentations.entries()]
        .filter(([window, presentation]) => !window.isDestroyed() && presentation.launch)
        .map(([, presentation]) => presentation.launch);

    try {
        writeWindowState(getWindowStatePath(), {
            version: 1,
            main: mainSource ? { source: mainSource } : null,
            tours
        });
    } catch (error) {
        console.error(`Could not save Bygone window state: ${getErrorMessage(error)}`);
    }
}

function getWindowStatePath() {
    return path.join(app.getPath('userData'), 'open-windows.json');
}

async function routeLaunchTarget(launchTarget) {
    if (launchTarget.kind === 'unsupported-launch-intent') {
        ensureMainWindow();
        await showError(`This version of Bygone does not support desktop launch intent version ${launchTarget.version}.`);
        return;
    }
    if (launchTarget.kind === 'tour') {
        await openTourPresentation(launchTarget.args, launchTarget.cwd || process.cwd());
        return;
    }
    if (launchTarget.kind === 'tour-document') {
        await openAuthoredTourDocument(launchTarget.documentPath);
        return;
    }
    if (launchTarget.kind === 'invalid-tour-selection') {
        ensureMainWindow();
        await showInfo(launchTarget.message);
        return;
    }

    ensureMainWindow();

    const requestedSource = sourceForLaunchTarget(launchTarget);
    if (isRefreshableSource(requestedSource) && sessionSourcesEqual(session.source, requestedSource)) {
        await refreshSession();
        return;
    }

    if (launchTarget.kind === 'blank') {
        await openBlankDiff();
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

    if (launchTarget.kind === 'git-diff') {
        await openGitRefs(launchTarget.cwd || process.cwd(), launchTarget.refs);
        return;
    }

    if (launchTarget.kind === 'branch-diff') {
        await openGitBranchReview(launchTarget.cwd || process.cwd(), launchTarget.branch, launchTarget.mainRef, {
            pullRequest: launchTarget.pullRequest,
            unreadablePullRequest: launchTarget.unreadablePullRequest
        });
        return;
    }

    if (launchTarget.kind === 'test' || launchTarget.kind === 'smoke') {
        await compareTestFiles();
        return;
    }

    if (launchTarget.kind === 'smoke-multi') {
        await compareMultiTestFiles();
        return;
    }

    if (launchTarget.kind === 'smoke-directory') {
        await compareDirectoryTestFiles();
        return;
    }

    if (launchTarget.kind === 'smoke-directory-history') {
        await compareDirectoryHistoryTestFiles();
    }
}

function sourceForLaunchTarget(launchTarget) {
    if (launchTarget.kind === 'diff' || launchTarget.kind === 'pair') {
        return createFilesSource([launchTarget.leftPath, launchTarget.rightPath]);
    }
    if (launchTarget.kind === 'multi-diff') {
        return createFilesSource(launchTarget.paths);
    }
    if (launchTarget.kind === 'directory') {
        return createDirectoriesSource([launchTarget.leftPath, launchTarget.rightPath]);
    }
    if (launchTarget.kind === 'multi-directory') {
        return createDirectoriesSource(launchTarget.paths);
    }
    if (launchTarget.kind === 'history') {
        return createFileHistorySource(launchTarget.filePath, launchTarget.includeStaged, historySkipUnchangedPreference);
    }
    if (launchTarget.kind === 'directory-history') {
        return createDirectoryHistorySource(launchTarget.dirPath, launchTarget.includeStaged, historySkipUnchangedPreference);
    }
    if (launchTarget.kind === 'git-diff') {
        try {
            const repoRoot = fs.realpathSync(runGit(['rev-parse', '--show-toplevel'], launchTarget.cwd || process.cwd()));
            return createGitRefsSource(repoRoot, launchTarget.refs);
        } catch {
            return null;
        }
    }
    if (launchTarget.kind === 'branch-diff') {
        if (launchTarget.pullRequest) {
            // The repository and refs only exist once the pull request has been
            // resolved and fetched, so the review itself records the source.
            return null;
        }
        try {
            const repoRoot = fs.realpathSync(runGit(['rev-parse', '--show-toplevel'], launchTarget.cwd || process.cwd()));
            return createBranchReviewSource(repoRoot, launchTarget.branch, launchTarget.mainRef);
        } catch {
            return null;
        }
    }
    return null;
}

function getCliArgs() {
    return getCliArgsFromArgv(process.argv);
}

function parseLaunchArgs(args) {
    const { cwd, launchArgs } = normalizeLaunchArgs(args);
    const includeStaged = launchArgs.some((arg) => tokenMatches('includeStaged', arg));
    let capturePath = null;
    let windowWidth = null;
    let windowHeight = null;
    let launchIntentVersion = null;
    const filteredArgs = [];

    for (let index = 0; index < launchArgs.length; index += 1) {
        const arg = launchArgs[index];
        if (tokenMatches('includeStaged', arg)) {
            continue;
        }
        if (arg === '--launch-intent-version' && typeof launchArgs[index + 1] === 'string') {
            launchIntentVersion = Number.parseInt(launchArgs[index + 1], 10);
            index += 1;
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

    if (launchIntentVersion !== null && launchIntentVersion !== 1) {
        return { kind: 'unsupported-launch-intent', version: launchIntentVersion };
    }

    if (filteredArgs.length === 0) {
        return isInsideGitRepo(cwd)
            ? { kind: 'directory-history', dirPath: cwd, includeStaged, capturePath, windowWidth, windowHeight }
            : { kind: 'blank', capturePath, windowWidth, windowHeight };
    }

    if (tokenMatches('diff', filteredArgs[0]) && filteredArgs.length < 2) {
        return { kind: 'blank', capturePath, windowWidth, windowHeight };
    }

    if (tokenMatches('diff', filteredArgs[0]) && filteredArgs.length >= 2) {
        if (filteredArgs.length === 2) {
            return { kind: 'multi-diff', paths: filteredArgs.slice(1).map((candidate) => resolveLaunchPath(candidate, cwd)), capturePath, windowWidth, windowHeight };
        }

        if (filteredArgs.length === 3) {
            return { kind: 'diff', leftPath: resolveLaunchPath(filteredArgs[1], cwd), rightPath: resolveLaunchPath(filteredArgs[2], cwd), capturePath, windowWidth, windowHeight };
        }

        return { kind: 'multi-diff', paths: filteredArgs.slice(1).map((candidate) => resolveLaunchPath(candidate, cwd)), capturePath, windowWidth, windowHeight };
    }

    if (tokenMatches('history', filteredArgs[0]) && filteredArgs.length >= 2) {
        const targetPath = resolveLaunchPath(filteredArgs[1], cwd);
        return getPathKind(targetPath) === 'directory'
            ? { kind: 'directory-history', dirPath: targetPath, includeStaged, capturePath, windowWidth, windowHeight }
            : { kind: 'history', filePath: targetPath, includeStaged, capturePath, windowWidth, windowHeight };
    }

    if (tokenMatches('gitDiff', filteredArgs[0]) && filteredArgs.length >= 3) {
        return { kind: 'git-diff', refs: filteredArgs.slice(1), cwd, capturePath, windowWidth, windowHeight };
    }

    if (tokenMatches('present', filteredArgs[0])) {
        return { kind: 'tour', args: filteredArgs.slice(1), cwd, capturePath, windowWidth, windowHeight };
    }

    if (tokenMatches('branchDiff', filteredArgs[0]) || tokenMatches('review', filteredArgs[0])) {
        let branch = 'HEAD';
        let mainRef;
        let pullRequest;
        let unreadablePullRequest;
        for (let i = 1; i < filteredArgs.length; i++) {
            const arg = filteredArgs[i];
            if (tokenMatches('pullRequest', arg) && filteredArgs[i + 1]) {
                const requested = filteredArgs[++i];
                pullRequest = parsePullRequestRef(requested);
                if (!pullRequest) {
                    unreadablePullRequest = requested;
                }
            } else if (tokenMatches('branch', arg) && filteredArgs[i + 1]) {
                branch = filteredArgs[++i];
            } else if (tokenMatches('base', arg) && filteredArgs[i + 1]) {
                mainRef = filteredArgs[++i];
            } else if (tokenMatches('review', filteredArgs[0]) && !arg.startsWith('-')) {
                // A pasted pull request link is unambiguous, so it wins over
                // being treated as a Git ref.
                if (isPullRequestInput(arg)) {
                    pullRequest = parsePullRequestRef(arg);
                } else {
                    branch = arg;
                }
            }
        }
        return { kind: 'branch-diff', branch, mainRef, pullRequest, unreadablePullRequest, cwd, capturePath, windowWidth, windowHeight };
    }

    if (tokenMatches('test', filteredArgs[0])) {
        return { kind: 'test', capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs[0] === '--smoke-test') {
        return { kind: 'smoke', capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs[0] === '--smoke-test-multi') {
        return { kind: 'smoke-multi', capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs[0] === '--smoke-test-directory') {
        return { kind: 'smoke-directory', capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs[0] === '--smoke-test-directory-history') {
        return { kind: 'smoke-directory-history', capturePath, windowWidth, windowHeight };
    }

    if (filteredArgs.length >= 1 && !filteredArgs[0].startsWith('--')) {
        const resolvedPaths = filteredArgs.map((candidate) => resolveLaunchPath(candidate, cwd));
        const tourSelection = classifyAuthoredTourPaths(resolvedPaths);
        if (tourSelection.kind === 'single') {
            return { kind: 'tour-document', documentPath: tourSelection.path, capturePath, windowWidth, windowHeight };
        }
        if (tourSelection.kind === 'multiple') {
            return {
                kind: 'invalid-tour-selection',
                message: 'Open one authored Bygone presentation at a time.',
                capturePath,
                windowWidth,
                windowHeight
            };
        }
        if (tourSelection.kind === 'mixed') {
            return {
                kind: 'invalid-tour-selection',
                message: 'Open an authored Bygone presentation separately from ordinary files and directories.',
                capturePath,
                windowWidth,
                windowHeight
            };
        }

        if (resolvedPaths.length === 1) {
            const targetPath = resolvedPaths[0];
            return getPathKind(targetPath) === 'directory'
                ? { kind: 'directory-history', dirPath: targetPath, includeStaged, capturePath, windowWidth, windowHeight }
                : { kind: 'history', filePath: targetPath, includeStaged, capturePath, windowWidth, windowHeight };
        }

        const kinds = resolvedPaths.map((candidate) => getPathKind(candidate));
        if (kinds.every((kind) => kind === 'directory')) {
            return resolvedPaths.length === 2
                ? { kind: 'directory', leftPath: resolvedPaths[0], rightPath: resolvedPaths[1], capturePath, windowWidth, windowHeight }
                : { kind: 'multi-directory', paths: resolvedPaths, capturePath, windowWidth, windowHeight };
        }

        if (kinds.every((kind) => kind === 'file')) {
            return resolvedPaths.length === 2
                ? { kind: 'pair', leftPath: resolvedPaths[0], rightPath: resolvedPaths[1], capturePath, windowWidth, windowHeight }
                : { kind: 'multi-diff', paths: resolvedPaths, capturePath, windowWidth, windowHeight };
        }

        return resolvedPaths.length === 2
            ? { kind: 'pair', leftPath: resolvedPaths[0], rightPath: resolvedPaths[1], capturePath, windowWidth, windowHeight }
            : { kind: 'multi-diff', paths: resolvedPaths, capturePath, windowWidth, windowHeight };
    }

    return isInsideGitRepo(cwd)
        ? { kind: 'directory-history', dirPath: cwd, includeStaged, capturePath, windowWidth, windowHeight }
        : { kind: 'blank', capturePath, windowWidth, windowHeight };
}

function normalizeLaunchArgs(args) {
    const launchArgs = [...args];
    let cwd = process.cwd();
    const cwdIndex = launchArgs.indexOf('--cwd');

    if (cwdIndex !== -1 && typeof launchArgs[cwdIndex + 1] === 'string') {
        cwd = path.resolve(launchArgs[cwdIndex + 1]);
        launchArgs.splice(cwdIndex, 2);
    }

    const resolved = resolveWorkingDirectory(launchArgs, cwd);
    return { cwd: resolved.cwd, launchArgs: resolved.args };
}

function resolveLaunchPath(candidate, cwd) {
    return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
}

function isInsideGitRepo(cwd) {
    try {
        return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim() === 'true';
    } catch {
        return false;
    }
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

    if (message.type === 'renderComplete') {
        captureRenderReady = true;
        if (captureMode) {
            scheduleCaptureIfNeeded();
        }
        return;
    }

    if (message.type === 'refreshSession') {
        await refreshSession();
        return;
    }

    if (message.type === 'submitLaunchPrompt'
        && Number.isInteger(message.requestId)
        && message.requestId === pendingLaunchPrompt?.requestId
        && message.values
        && typeof message.values === 'object'
        && !Array.isArray(message.values)) {
        const prompt = pendingLaunchPrompt;
        pendingLaunchPrompt = null;
        const values = Object.fromEntries(prompt.fieldNames.map((fieldName) => [
            fieldName,
            typeof message.values[fieldName] === 'string' ? message.values[fieldName] : ''
        ]));
        try {
            await prompt.submit(values);
        } catch (error) {
            await showError(`Could not ${prompt.description}: ${getErrorMessage(error)}`);
        }
        return;
    }

    if (message.type === 'cancelLaunchPrompt'
        && Number.isInteger(message.requestId)
        && message.requestId === pendingLaunchPrompt?.requestId) {
        pendingLaunchPrompt = null;
        return;
    }

    if (message.type === 'searchChangeSet' && Number.isInteger(message.requestId)) {
        searchCurrentChangeSet(message);
        return;
    }

    if (message.type === 'searchGitHistory' && Number.isInteger(message.requestId)) {
        searchCurrentFileHistory(message);
        return;
    }

    if (message.type === 'runRepositorySearch' && Number.isInteger(message.requestId)) {
        runRepositorySearch(message);
        return;
    }

    if (message.type === 'cancelRepositorySearch') {
        repositorySearch?.handle?.cancel();
        return;
    }

    if (message.type === 'openRepositorySearchResult'
        && typeof message.path === 'string'
        && Number.isInteger(message.line)
        && Number.isInteger(message.column)
        && Number.isInteger(message.endColumn)) {
        await openRepositorySearchResult(message);
        return;
    }

    if (message.type === 'previewRepositoryReplacement' && Number.isInteger(message.requestId)) {
        previewRepositoryReplacement(message);
        return;
    }

    if (message.type === 'applyRepositoryReplacement' && Array.isArray(message.paths)) {
        await applyRepositoryReplacement(message.paths);
        return;
    }

    if (message.type === 'undoRepositoryReplacement') {
        await undoLastRepositoryReplacement();
        return;
    }

    if (message.type === 'openGitHistorySearchResult'
        && Number.isInteger(message.historyIndex)
        && Number.isInteger(message.sideIndex)
        && Number.isInteger(message.lineNumber)) {
        await openFileHistorySearchResult(message.historyIndex);
        postToRenderer({ type: 'revealSearchResult', sideIndex: message.sideIndex, lineNumber: message.lineNumber, startColumn: message.startColumn, endColumn: message.endColumn });
        return;
    }

    if (message.type === 'openChangeSetSearchResult'
        && typeof message.relativePath === 'string'
        && Number.isInteger(message.sideIndex)
        && Number.isInteger(message.lineNumber)) {
        await openDirectoryEntry(message.relativePath);
        postToRenderer({
            type: 'revealSearchResult',
            sideIndex: message.sideIndex,
            lineNumber: message.lineNumber,
            startColumn: message.startColumn,
            endColumn: message.endColumn
        });
        return;
    }

    if (message.type === 'navigationState' && Number.isInteger(message.requestId)) {
        const pending = pendingNavigationRequests.get(message.requestId);
        if (pending) {
            pendingNavigationRequests.delete(message.requestId);
            clearTimeout(pending.timeout);
            pending.resolve(message.navigation || null);
        }
        return;
    }

    if (message.type === 'wordWrapState') {
        wordWrapEnabled = Boolean(message.enabled);
        wordWrapAvailable = Boolean(message.available);
        installApplicationMenu();
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
        if (setActiveMultiPanel(message.panelId)) {
            refreshSessionWindowTitle();
        }
        return;
    }

    if (message.type === 'multiSetActivePair' && Number.isInteger(message.pairIndex)) {
        if (setActiveMultiPair(message.pairIndex)) {
            refreshSessionWindowTitle();
        }
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

    if (message.type === 'dirAddColumn' && (message.side === 'left' || message.side === 'right')) {
        await addDirectoryColumn(message.side);
        return;
    }

    if (message.type === 'dirRemoveColumn' && Number.isInteger(message.sideIndex)) {
        await removeDirectoryColumn(message.sideIndex);
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
            refreshSessionWindowTitle();
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
    const filePaths = await collectComparisonPaths('file');
    if (filePaths.length < 2) {
        return;
    }

    if (filePaths.length === 2) {
        await openDiff(filePaths[0], filePaths[1]);
    } else {
        await openMultiDiff(filePaths);
    }
}

async function collectComparisonPaths(kind) {
    ensureExploreWindow();
    const isDirectory = kind === 'directory';
    const noun = isDirectory ? 'directory' : 'file';
    return collectComparisonSelection(async (selectedCount) => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: selectedCount === 0
                ? `Select ${noun}s to compare`
                : `Add ${noun}${selectedCount === 1 ? '' : 's'} to the comparison`,
            properties: [isDirectory ? 'openDirectory' : 'openFile', 'multiSelections']
        });
        if (result.canceled) {
            return null;
        }
        return result.filePaths.map((selectedPath) => path.resolve(selectedPath));
    }, async (paths) => {
        const choice = await dialog.showMessageBox(mainWindow, {
            type: 'question',
            buttons: [`Compare ${paths.length}`, 'Add More…', 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            message: `Compare ${paths.length} selected ${noun}${paths.length === 1 ? '' : 's'}?`,
            detail: paths.join('\n')
        });
        if (choice.response === 0) {
            return 'compare';
        }
        return choice.response === 1 ? 'add' : 'cancel';
    });
}

function ensureExploreWindow() {
    ensureMainWindow();
    if (!mainWindow.isVisible()) {
        mainWindow.show();
    }
    mainWindow.focus();
}

function openLaunchPrompt(config, submit) {
    ensureExploreWindow();
    const requestId = nextLaunchPromptId++;
    pendingLaunchPrompt = {
        requestId,
        fieldNames: config.fields.map((field) => field.name),
        description: config.failureDescription || config.title.toLowerCase(),
        submit
    };
    postToRenderer({
        type: 'openLaunchPrompt',
        requestId,
        ...config
    });
}

async function resolveOrChooseGitRepository(title) {
    const sourcePath = session.source?.repoRoot
        || session.source?.path
        || session.source?.paths?.[0];
    const sourceCandidate = sourcePath && getPathKind(sourcePath) === 'file'
        ? path.dirname(sourcePath)
        : sourcePath;
    const candidates = [sourceCandidate, launchArguments.cwd, process.cwd()]
        .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
    for (const candidate of candidates) {
        try {
            return fs.realpathSync(runGit(['rev-parse', '--show-toplevel'], candidate));
        } catch {
            // Try the next relevant location before asking the user.
        }
    }

    ensureExploreWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
        title,
        properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    try {
        return fs.realpathSync(runGit(['rev-parse', '--show-toplevel'], result.filePaths[0]));
    } catch (error) {
        await showError(`The selected directory is not inside a Git repository: ${getErrorMessage(error)}`);
        return null;
    }
}

async function openGitRefsDialog() {
    const repoRoot = await resolveOrChooseGitRepository('Select a Git repository to compare');
    if (!repoRoot) {
        return;
    }

    openLaunchPrompt({
        kind: 'git-refs',
        title: 'Compare Git Revisions',
        description: `Repository: ${repoRoot}`,
        submitLabel: 'Compare',
        fields: [{
            name: 'refs',
            label: 'Revisions (two or more, separated by spaces)',
            value: 'HEAD~1 HEAD',
            required: true
        }]
    }, async (values) => {
        const refs = values.refs.trim().split(/\s+/).filter(Boolean);
        if (refs.length < 2) {
            await showInfo('Enter at least two Git revisions to compare.');
            return;
        }
        await openGitRefs(repoRoot, refs);
    });
}

async function openDroppedFiles(paths) {
    const normalizedPaths = paths
        .filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
        .map((candidate) => path.resolve(candidate))
        .filter((candidate, index, all) => all.indexOf(candidate) === index);

    const tourSelection = classifyAuthoredTourPaths(normalizedPaths);
    if (tourSelection.kind === 'single') {
        await openAuthoredTourDocument(tourSelection.path);
        return;
    }
    if (tourSelection.kind === 'multiple') {
        await showInfo('Open one authored Bygone presentation at a time.');
        return;
    }
    if (tourSelection.kind === 'mixed') {
        await showInfo('Open an authored Bygone presentation separately from ordinary files and directories.');
        return;
    }

    ensureMainWindow();

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
            await openDirectories(normalizedPaths);
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
        title: 'Select file or directory for git history',
        properties: ['openFile', 'openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
        return;
    }

    const targetPath = result.filePaths[0];
    if (getPathKind(targetPath) === 'directory') {
        await openDirectoryHistory(targetPath, historyIncludeStagedPreference);
        return;
    }

    await openHistory(targetPath, historyIncludeStagedPreference);
}

async function openBranchReviewDialog() {
    const repoRoot = await resolveOrChooseGitRepository('Select a Git repository to review');
    if (!repoRoot) {
        return;
    }

    openLaunchPrompt({
        kind: 'review-branch',
        title: 'Review Branch Change',
        description: `Repository: ${repoRoot}`,
        submitLabel: 'Review',
        fields: [
            { name: 'head', label: 'Head branch or ref', value: 'HEAD', required: true },
            { name: 'base', label: 'Base branch or ref (optional)', value: '' }
        ]
    }, async (values) => {
        await openGitBranchReview(repoRoot, values.head.trim() || 'HEAD', values.base.trim() || undefined);
    });
}

/**
 * Reviewing a pull request deliberately asks for nothing but the link. The
 * repository, refs, and any clone are resolved from it.
 */
async function openPullRequestReviewDialog() {
    openLaunchPrompt({
        kind: 'review-pull-request',
        title: 'Review Pull Request',
        description: 'Paste a GitHub pull request link, or type owner/repo#number.',
        submitLabel: 'Review',
        fields: [
            { name: 'pullRequest', label: 'Pull request link or owner/repo#number', value: '', required: true }
        ]
    }, async (values) => {
        const requested = values.pullRequest.trim();
        const ref = parsePullRequestRef(requested);
        if (!ref || !ref.owner || !ref.repo) {
            await showError(
                `Could not read "${requested}" as a pull request. `
                + 'Use a full link such as https://github.com/owner/repo/pull/123, or owner/repo#123.'
            );
            return;
        }
        await openGitBranchReview(launchArguments.cwd || process.cwd(), 'HEAD', undefined, { pullRequest: ref });
    });
}

async function openCompareDirectoriesDialog() {
    const directoryPaths = await collectComparisonPaths('directory');
    if (directoryPaths.length < 2) {
        return;
    }
    await openDirectories(directoryPaths);
}

async function openDirectories(dirs, options = {}) {
    const resolvedDirs = dirs.map((dir) => path.resolve(dir)).filter((dir, index, all) => all.indexOf(dir) === index);
    if (resolvedDirs.length < 2 || !resolvedDirs.every((dir) => getPathKind(dir) === 'directory')) {
        await showInfo('Directory compare requires at least two distinct directories.');
        return;
    }
    if (!options.skipConfirm && !await confirmSessionReplacement('open another directory comparison')) {
        cleanupGitDiffTempRoots(options.tempRoots || []);
        return;
    }

    const labels = Array.isArray(options.labels) && options.labels.length === resolvedDirs.length
        ? [...options.labels]
        : resolvedDirs.map((dir) => path.basename(dir));

    session = {
        mode: 'directory',
        source: cloneSessionSource(options.source || createDirectoriesSource(resolvedDirs, options.labels)),
        left: createSideState(resolvedDirs[0], ''),
        right: createSideState(resolvedDirs[1], ''),
        history: null,
        directory: {
            dirs: resolvedDirs,
            labels,
            tempRoots: Array.isArray(options.tempRoots) ? [...options.tempRoots] : [],
            review: options.review || null
        },
        multi: null,
        dirHistory: null
    };

    clearWatchers();
    updateWatchers();
    await sendCurrentDirectoryDiff();
}

async function addDirectoryColumn(side) {
    if (session.mode === 'directory-history' && session.dirHistory) {
        const range = session.dirHistory.displayedRange;
        const entries = session.dirHistory.entries;
        if (side === 'left') {
            if (range[0] + 1 >= entries.length) {
                return;
            }
            range[0] += 1;
        } else {
            if (range[1] - 1 < 0) {
                return;
            }
            range[1] -= 1;
        }
        await sendCurrentDirectoryHistoryEntry();
        return;
    }

    if (session.mode !== 'directory' || !session.directory || !mainWindow || session.source?.kind !== 'directories') {
        return;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
        title: `Add directory to the ${side}`,
        properties: ['openDirectory']
    });

    if (result.canceled || !result.filePaths?.length) {
        return;
    }

    const newDir = path.resolve(result.filePaths[0]);
    if (getPathKind(newDir) !== 'directory') {
        await showInfo('Selected path is not a directory.');
        return;
    }

    const newLabel = path.basename(newDir);
    if (side === 'left') {
        session.directory.dirs.unshift(newDir);
        session.directory.labels.unshift(newLabel);
    } else {
        session.directory.dirs.push(newDir);
        session.directory.labels.push(newLabel);
    }

    session.left = createSideState(session.directory.dirs[0], '');
    session.right = createSideState(session.directory.dirs[session.directory.dirs.length - 1], '');
    session.source = createDirectoriesSource(session.directory.dirs, session.directory.labels);
    await sendCurrentDirectoryDiff();
}

async function removeDirectoryColumn(sideIndex) {
    if (session.mode === 'directory-history' && session.dirHistory) {
        const range = session.dirHistory.displayedRange;
        const colCount = (range[0] - range[1]) + 2;
        if (colCount <= 1) {
            return;
        }
        if (sideIndex === 0) {
            range[0] -= 1;
        } else if (sideIndex === colCount - 1) {
            range[1] += 1;
        } else {
            return;
        }
        await sendCurrentDirectoryHistoryEntry();
        return;
    }

    if (session.mode !== 'directory' || !session.directory || session.source?.kind !== 'directories') {
        return;
    }

    if (session.directory.dirs.length <= 2) {
        return;
    }

    if (sideIndex < 0 || sideIndex >= session.directory.dirs.length) {
        return;
    }

    session.directory.dirs.splice(sideIndex, 1);
    session.directory.labels.splice(sideIndex, 1);
    session.left = createSideState(session.directory.dirs[0], '');
    session.right = createSideState(session.directory.dirs[session.directory.dirs.length - 1], '');
    session.source = createDirectoriesSource(session.directory.dirs, session.directory.labels);
    await sendCurrentDirectoryDiff();
}

const trackedGitDiffTempRoots = new Set();

function cleanupGitDiffTempRoots(roots) {
    for (const root of roots || []) {
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch {
            // best effort
        }
        trackedGitDiffTempRoots.delete(root);
    }
}

function resolveGitRefForDiff(repoRoot, ref) {
    const normalizedRef = ref.toUpperCase();
    if (normalizedRef === 'INDEX') {
        return {
            ref,
            kind: 'index',
            label: 'Index'
        };
    }
    if (normalizedRef === 'WORKTREE' || normalizedRef === 'WORKDIR' || normalizedRef === 'WORKINGTREE') {
        return {
            ref,
            kind: 'worktree',
            label: 'Working Tree'
        };
    }

    const sha = runGit(['rev-parse', '--verify', `${ref}^{commit}`], repoRoot);
    const shortSha = sha.slice(0, 7);
    let summary = '';
    try {
        summary = readCommitSummary(repoRoot, sha);
    } catch {
        // ignore — labels are nice-to-have
    }
    return { ref, kind: 'commit', sha, shortSha, summary };
}

function materializeGitDiffSource(repoRoot, source, targetRoot) {
    if (source.kind === 'index') {
        materializeGitTree(repoRoot, '', targetRoot, 'INDEX');
        return;
    }
    if (source.kind === 'worktree') {
        materializeWorkingTree(repoRoot, '', targetRoot);
        return;
    }

    materializeGitTree(repoRoot, '', targetRoot, source.sha);
}

function getGitDiffSourceLabel(source) {
    if (source.label) {
        return source.label;
    }

    return `${source.shortSha}${source.summary ? ` ${source.summary}` : ''} (${source.ref})`;
}

async function openGitRefs(cwd, refs, options = {}) {
    if (!Array.isArray(refs) || refs.length < 2) {
        await showInfo('Compare git refs requires at least two refs.');
        return;
    }

    let repoRoot;
    try {
        repoRoot = fs.realpathSync(runGit(['rev-parse', '--show-toplevel'], cwd));
    } catch (error) {
        await showError(`Not inside a git repository: ${getErrorMessage(error)}`);
        return;
    }

    const resolved = [];
    for (const ref of refs) {
        try {
            resolved.push(resolveGitRefForDiff(repoRoot, ref));
        } catch (error) {
            await showError(`Could not resolve git ref "${ref}": ${getErrorMessage(error)}`);
            return;
        }
    }

    const tempRoots = [];
    const dirs = [];
    const labels = [];

    try {
        for (const r of resolved) {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-gitdiff-'));
            tempRoots.push(root);
            trackedGitDiffTempRoots.add(root);
            materializeGitDiffSource(repoRoot, r, root);
            dirs.push(root);
            const customLabel = options.labels?.[dirs.length - 1];
            labels.push(customLabel || getGitDiffSourceLabel(r));
        }
    } catch (error) {
        cleanupGitDiffTempRoots(tempRoots);
        await showError(`Error materializing git refs: ${getErrorMessage(error)}`);
        return;
    }

    await openDirectories(dirs, {
        labels,
        tempRoots,
        skipConfirm: Boolean(options.skipConfirm),
        source: options.source || createGitRefsSource(repoRoot, refs)
    });
}

async function openGitBranchReview(cwd, branch, mainRef, options = {}) {
    let reviewRoot = cwd;
    let headRef = branch;
    let baseRef = mainRef;
    let pullRequest;

    if (options.unreadablePullRequest) {
        await showError(
            `Could not read "${options.unreadablePullRequest}" as a pull request. `
            + 'Use a number, a full link such as https://github.com/owner/repo/pull/123, or owner/repo#123.'
        );
        return;
    }

    if (options.pullRequest) {
        try {
            const metadata = resolvePullRequest(options.pullRequest, cwd);
            const workspace = ensurePullRequestWorkspace(options.pullRequest, metadata, cwd);
            reviewRoot = workspace.repoRoot;
            headRef = workspace.headRef;
            baseRef = workspace.baseRef;
            pullRequest = toPullRequestSummary(metadata);
        } catch (error) {
            await showError(`Could not prepare pull request review: ${getErrorMessage(error)}`);
            return;
        }
    }

    let review;
    try {
        review = resolveBranchReviewRange(reviewRoot, headRef, baseRef);
    } catch (error) {
        await showError(`Could not prepare branch review: ${getErrorMessage(error)}`);
        return;
    }

    if (review.changedPaths.length === 0) {
        await showInfo(pullRequest
            ? `Pull request #${pullRequest.number} has no changes relative to ${pullRequest.baseRefName}.`
            : `${review.headRef} has no changes relative to ${review.baseRef}.`);
        return;
    }

    const leftRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-review-base-'));
    const rightRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-review-head-'));
    trackedGitDiffTempRoots.add(leftRoot);
    trackedGitDiffTempRoots.add(rightRoot);

    try {
        materializeBranchReviewTrees(review, leftRoot, rightRoot);
    } catch (error) {
        cleanupGitDiffTempRoots([leftRoot, rightRoot]);
        await showError(`Could not load branch review files: ${getErrorMessage(error)}`);
        return;
    }

    await openDirectories([leftRoot, rightRoot], {
        labels: [
            `${pullRequest ? pullRequest.baseRefName : review.baseRef} @ ${review.mergeBaseOid.slice(0, 7)}`,
            `${pullRequest ? `#${pullRequest.number} ${pullRequest.headRefName}` : review.headRef} @ ${review.headOid.slice(0, 7)}`
        ],
        tempRoots: [leftRoot, rightRoot],
        skipConfirm: Boolean(options.skipConfirm),
        source: options.source || createBranchReviewSource(review.repoRoot || reviewRoot, headRef, baseRef),
        review: {
            ...review,
            pullRequest,
            viewedPaths: new Set()
        }
    });
}

async function openDirectoryHistory(dirPath, includeStaged = historyIncludeStagedPreference, options = {}) {
    const resolvedDir = path.resolve(dirPath);
    if (getPathKind(resolvedDir) !== 'directory') {
        await showInfo('Directory history requires a directory.');
        return;
    }
    if (!options.skipConfirm && !await confirmSessionReplacement('open directory history')) {
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
        source: cloneSessionSource(options.source || createDirectoryHistorySource(
            resolvedDir,
            includeStaged,
            historyState.skipUnchanged
        )),
        left: createSideState('', ''),
        right: createSideState('', ''),
        history: null,
        directory: null,
        multi: null,
        dirHistory: historyState
    };

    clearWatchers();
    updateWatchers();
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
        ['log', '--format=%H%x09%h%x09%cI%x09%s%x09%P', '--', relativeDir || '.'],
        repoRoot
    ));
    const parentMetadataByCommit = readCommitMetadataMap(
        repoRoot,
        [...new Set(commitRecords.map((commit) => commit.parentCommit).filter(Boolean))]
    );
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
        const parentCommit = commit.parentCommit;
        if (!parentCommit) {
            continue;
        }
        const parentMetadata = parentMetadataByCommit.get(parentCommit) || { summary: '', timestamp: '' };

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
        includeStaged,
        skipUnchanged: Boolean(historySkipUnchangedPreference),
        entries,
        index: 0,
        displayedRange: [0, 0],
        viewRelativePath: null,
        materializedOrder: []
    };
}

function getDisplayedDirectoryHistoryDirs(dirHistory) {
    const range = dirHistory.displayedRange || [dirHistory.index, dirHistory.index];
    const [oldestIdx, newestIdx] = range;
    const dirs = [];
    const labels = [];

    for (let i = oldestIdx; i >= newestIdx; i--) {
        const entry = ensureDirectoryHistoryEntryMaterialized(dirHistory, i);
        if (i === oldestIdx) {
            dirs.push(entry.dirs[0]);
            labels.push(entry.labels[0]);
        }
        dirs.push(entry.dirs[1]);
        labels.push(entry.labels[1]);
    }

    return { dirs, labels };
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

function applyReviewMetadata(entries, review) {
    if (!review) {
        return entries;
    }

    const changeByPath = new Map();
    for (const changedPath of review.changedPaths) {
        changeByPath.set(changedPath.path, changedPath);
        if (changedPath.previousPath) {
            changeByPath.set(changedPath.previousPath, changedPath);
        }
    }

    return entries.map((entry) => {
        const normalizedPath = entry.relativePath.endsWith('/')
            ? entry.relativePath.slice(0, -1)
            : entry.relativePath;
        const changedPath = changeByPath.get(normalizedPath);
        if (!changedPath) {
            return entry;
        }
        const reviewPair = resolveReviewPathPair(review.changedPaths, normalizedPath);
        const relatedPath = reviewPair?.leftPath === normalizedPath
            ? reviewPair.rightPath
            : reviewPair?.rightPath === normalizedPath
                ? reviewPair.leftPath
                : null;
        return {
            ...entry,
            gitChangeKind: changedPath.kind,
            previousPath: changedPath.previousPath,
            relatedPath: relatedPath && relatedPath !== normalizedPath ? relatedPath : undefined,
            reviewKey: reviewPair?.key,
            relationSummary: reviewPair?.summary,
            reviewed: review.viewedPaths.has(changedPath.path)
                || Boolean(changedPath.previousPath && review.viewedPaths.has(changedPath.previousPath))
        };
    });
}

function buildReviewViewState(review) {
    if (!review) {
        return null;
    }

    const viewedCount = review.changedPaths.filter((changedPath) => (
        review.viewedPaths.has(changedPath.path)
        || Boolean(changedPath.previousPath && review.viewedPaths.has(changedPath.previousPath))
    )).length;

    return {
        baseRef: review.baseRef,
        headRef: review.headRef,
        mergeBaseOid: review.mergeBaseOid,
        headOid: review.headOid,
        dirty: review.dirty,
        changedFileCount: review.changedPaths.length,
        viewedCount,
        commitCount: review.commits.length,
        mergeCommitCount: review.commits.filter((commit) => commit.parentOids.length > 1).length,
        commits: review.commits
    };
}

async function sendCurrentDirectoryDiff() {
    if (session.mode !== 'directory' || !session.directory) {
        return;
    }

    const review = session.directory.review;
    const entries = applyReviewMetadata(
        buildMultiDirectoryComparison(session.directory.dirs),
        review
    );

    postOrQueue({
        type: 'showDirectoryDiff',
        leftLabel: session.directory.labels[0],
        rightLabel: session.directory.labels[1],
        labels: session.directory.labels,
        entries,
        canMutate: !review && session.source?.kind === 'directories',
        review: buildReviewViewState(review)
    });

    refreshSessionWindowTitle();
    if (launchArguments.kind === 'smoke-directory' && mainWindow && !mainWindow.isDestroyed()) {
        setTimeout(() => {
            void mainWindow.webContents.executeJavaScript(`document.querySelector('.dir-entry[data-is-dir="false"]')?.click()`);
        }, 250);
    }
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
        const { dirs: displayedDirs, labels: displayedLabels } = getDisplayedDirectoryHistoryDirs(session.dirHistory);
        const allMissing = displayedDirs.every((dir) => getPathKind(path.join(dir, relativePath)) !== 'file');

        if (allMissing) {
            session.dirHistory.viewRelativePath = null;
            await showInfo('That entry does not exist in any displayed column for this history step.');
            await sendCurrentDirectoryHistoryEntry();
            return;
        }

        const range = session.dirHistory.displayedRange;
        const colCount = displayedDirs.length;
        const panels = displayedDirs.map((dir, colIdx) => {
            const filePath = path.join(dir, relativePath);
            const exists = getPathKind(filePath) === 'file';
            const content = exists ? readFileContent(filePath) : '';
            const isFirst = colIdx === 0;
            const isLast = colIdx === colCount - 1;
            return {
                id: `dir-hist-col-${colIdx}`,
                label: `${displayedLabels[colIdx]} / ${relativePath}${exists ? '' : ' (missing)'}`,
                path: relativePath,
                content,
                editable: false,
                dirty: false,
                addLeftEnabled: isFirst && (range[0] + 1 < session.dirHistory.entries.length),
                removeEnabled: (isFirst || isLast) && colCount > 1,
                addRightEnabled: isLast && (range[1] - 1 >= 0)
            };
        });
        const pairs = panels.slice(0, -1).map((_, i) => ({ leftIndex: i, rightIndex: i + 1 }));

        postOrQueue({
            type: 'showMultiDiff',
            panels,
            pairs,
            activePanelId: panels[panels.length - 1]?.id ?? null,
            activePairIndex: pairs.length > 0 ? pairs.length - 1 : null,
            history: { ...history, fileName: relativePath },
            fileNavigation: buildDirectoryHistoryFileNavigationState(session.dirHistory, entry),
            canReturnToDirectory: true,
            revealFirstChangeInEachPanel: true
        });

        refreshSessionWindowTitle();
        if (launchArguments.kind === 'smoke-directory-history') {
            pollDirectoryHistoryDrilldownSmoke();
        }
        scheduleCaptureIfNeeded();
        return;
    }

    let displayedDirs;
    let displayedLabels;
    try {
        const result = getDisplayedDirectoryHistoryDirs(session.dirHistory);
        displayedDirs = result.dirs;
        displayedLabels = result.labels;
    } catch (error) {
        await showError(`Error loading directory history range: ${getErrorMessage(error)}`);
        return;
    }

    const entries = buildMultiDirectoryComparison(displayedDirs);

    postOrQueue({
        type: 'showDirectoryDiff',
        leftLabel: displayedLabels[0],
        rightLabel: displayedLabels[displayedLabels.length - 1],
        labels: displayedLabels,
        entries,
        history,
        canMutate: true
    });

    refreshSessionWindowTitle();
    if (launchArguments.kind === 'smoke-directory-history'
        && !directoryHistorySmokeDrilldownStarted
        && mainWindow
        && !mainWindow.isDestroyed()) {
        directoryHistorySmokeDrilldownStarted = true;
        setTimeout(() => {
            void mainWindow.webContents.executeJavaScript(`document.querySelector('.dir-entry[data-is-dir="false"]')?.click()`);
        }, 250);
    }
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

    if (Array.isArray(dirHistory.displayedRange)) {
        const [oldestIdx, newestIdx] = dirHistory.displayedRange;
        for (let i = newestIdx; i <= oldestIdx; i++) {
            if (i >= 0 && i < dirHistory.entries.length) {
                keepIndexes.add(i);
            }
        }
    }

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

async function openDiff(leftPath, rightPath, options = {}) {
    const binaryComparison = buildBinaryComparison(leftPath, rightPath);
    if (binaryComparison) {
        if (!options.skipConfirm && !await confirmSessionReplacement('open another comparison')) {
            return;
        }
        session = {
            mode: 'diff',
            source: cloneSessionSource(options.source || createFilesSource([leftPath, rightPath])),
            left: createSideState(leftPath, ''),
            right: createSideState(rightPath, ''),
            binaryComparison,
            history: null,
            directory: null,
            multi: null,
            dirHistory: null,
            returnDirectory: null
        };
        clearWatchers();
        updateWatchers();
        await sendCurrentDiff();
        return;
    }
    await openMultiDiff([leftPath, rightPath], options);
}

async function openHistory(filePath, includeStaged = historyIncludeStagedPreference, options = {}) {
    if (!options.skipConfirm && !await confirmSessionReplacement('open file history')) {
        return;
    }
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

    const firstEntry = entries[0];
    const historySource = {
        filePath: resolvedPath,
        entries,
        includeStaged: Boolean(includeStaged),
        skipUnchanged: Boolean(historySkipUnchangedPreference)
    };
    const files = [
        createHistoryMultiPanelState(firstEntry, 0, 'left', resolvedPath),
        createHistoryMultiPanelState(firstEntry, 0, 'right', resolvedPath)
    ];

    session = {
        mode: 'multi-diff',
        source: cloneSessionSource(options.source || createFileHistorySource(
            resolvedPath,
            includeStaged,
            historySource.skipUnchanged
        )),
        left: createSideState('', ''),
        right: createSideState('', ''),
        history: null,
        directory: null,
        multi: {
            sourceKind: 'history',
            files,
            activePanelId: files[1]?.id ?? null,
            activePairIndex: 0,
            historySource
        },
        dirHistory: null
    };

    clearWatchers();
    updateWatchers();
    historyIncludeStagedPreference = Boolean(includeStaged);
    historySkipUnchangedPreference = Boolean(historySource.skipUnchanged);
    await sendCurrentMultiDiff();
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

async function openMultiDiff(filePaths, options = {}) {
    const resolvedPaths = filePaths.map((filePath) => path.resolve(filePath));
    if (resolvedPaths.length < 1 || !resolvedPaths.every((filePath) => getPathKind(filePath) === 'file')) {
        await showInfo('Multi-file compare requires one or more files.');
        return;
    }
    if (!options.skipConfirm && !await confirmSessionReplacement('open another comparison')) {
        return;
    }

    const files = resolvedPaths.map((filePath) => createMultiPanelState(filePath));

    session = {
        mode: 'multi-diff',
        source: cloneSessionSource(options.source || createFilesSource(resolvedPaths)),
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

async function openBlankDiff() {
    if (!await confirmSessionReplacement('open a blank comparison')) {
        return;
    }
    const panel = createBlankMultiPanelState();
    session = {
        mode: 'multi-diff',
        source: { kind: 'blank' },
        left: createSideState('', ''),
        right: createSideState('', ''),
        history: null,
        directory: null,
        multi: {
            sourceKind: 'normal',
            files: [panel],
            activePanelId: panel.id,
            activePairIndex: null,
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
    if (session.mode === 'directory-history' && session.dirHistory?.viewRelativePath) {
        await addDirectoryColumn(side);
        return;
    }

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
    session.source = { kind: 'synthetic' };
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
    if (session.mode === 'directory-history' && session.dirHistory?.viewRelativePath) {
        const match = panelId.match(/^dir-hist-col-(\d+)$/);
        if (match) {
            await removeDirectoryColumn(parseInt(match[1], 10));
        }
        return;
    }

    if (session.mode !== 'multi-diff' || !session.multi || session.multi.files.length <= 1) {
        return;
    }

    const panelIndex = getMultiPanelIndexById(panelId);
    if (panelIndex < 0) {
        return;
    }
    if (session.multi.files[panelIndex]?.dirty && !await confirmSessionReplacement('remove the edited panel')) {
        return;
    }

    session.multi.files.splice(panelIndex, 1);
    const remainingPaths = session.multi.files.map((panel) => panel.path).filter(Boolean);
    session.source = remainingPaths.length === session.multi.files.length
        ? createFilesSource(remainingPaths)
        : { kind: 'synthetic' };
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

    const source = cloneSessionSource(session.source);
    session = {
        mode: 'multi-diff',
        source,
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
    if ((session.mode === 'diff' || session.mode === 'multi-diff') && session.returnDirectory && !relativePath.endsWith('/')) {
        const reviewPair = session.returnDirectory.review
            ? resolveReviewPathPair(session.returnDirectory.review.changedPaths, relativePath)
            : null;
        session.returnDirectory.review?.viewedPaths.add(reviewPair?.key || relativePath);
        if (session.returnDirectory.dirs.length === 2) {
            await openDirectoryFileDiff(
                session.returnDirectory.dirs,
                session.returnDirectory.labels,
                relativePath,
                session.returnDirectory.review
            );
        } else {
            await openDirectoryEntryMultiPanel(
                session.returnDirectory.dirs,
                session.returnDirectory.labels,
                relativePath,
                session.returnDirectory.review
            );
        }
        return;
    }

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

    const review = session.directory.review;
    const reviewPair = review ? resolveReviewPathPair(review.changedPaths, relativePath) : null;
    const reviewKey = reviewPair?.key || relativePath;
    if (review) {
        review.viewedPaths.add(reviewKey);
    }

    if (session.directory.dirs.length === 2) {
        await openDirectoryFileDiff(session.directory.dirs, session.directory.labels, reviewKey, review);
        return;
    }

    await openDirectoryEntryMultiPanel(session.directory.dirs, session.directory.labels, relativePath, review);
}

function searchCurrentChangeSet(message) {
    const context = getCurrentChangeSetContext();
    if (!context) {
        postToRenderer({ type: 'changeSetSearchResults', requestId: message.requestId, matches: [], unavailable: true });
        return;
    }
    try {
        const entries = applyReviewMetadata(buildMultiDirectoryComparison(context.dirs), context.review)
            .filter((entry) => !entry.isDirectory && entry.status !== 'same');
        const snapshots = [];
        for (const entry of entries) {
            const reviewPair = context.review ? resolveReviewPathPair(context.review.changedPaths, entry.reviewKey || entry.relativePath) : null;
            context.dirs.forEach((root, sideIndex) => {
                const relativePath = sideIndex === 0
                    ? reviewPair?.leftPath || entry.relativePath
                    : sideIndex === 1
                        ? reviewPair?.rightPath || entry.relativePath
                        : entry.relativePath;
                if (!relativePath) return;
                const filePath = path.join(root, relativePath);
                if (getPathKind(filePath) !== 'file' || classifyFile(filePath) !== 'text') return;
                snapshots.push({
                    relativePath: reviewPair?.key || entry.relativePath,
                    sideIndex,
                    label: `${context.labels[sideIndex]} / ${relativePath}`,
                    content: readFileContent(filePath)
                });
            });
        }
        const matches = searchChangeSetSnapshots(snapshots, String(message.query || ''), {
            regex: Boolean(message.regex),
            caseSensitive: Boolean(message.caseSensitive),
            limit: 500
        });
        postToRenderer({ type: 'changeSetSearchResults', requestId: message.requestId, matches });
    } catch (error) {
        postToRenderer({
            type: 'changeSetSearchResults',
            requestId: message.requestId,
            matches: [],
            error: getErrorMessage(error)
        });
    }
}

function getCurrentChangeSetContext() {
    if (session.mode === 'directory' && session.directory) {
        return session.directory;
    }
    if ((session.mode === 'diff' || session.mode === 'multi-diff') && session.returnDirectory) {
        return session.returnDirectory;
    }
    return null;
}

function searchCurrentFileHistory(message) {
    const source = session.mode === 'multi-diff' && session.multi?.sourceKind === 'history'
        ? session.multi.historySource
        : null;
    if (!source) {
        postToRenderer({ type: 'gitHistorySearchResults', requestId: message.requestId, matches: [], unavailable: true });
        return;
    }
    try {
        const matches = searchFileHistory(
            source.entries,
            String(message.query || ''),
            message.historyMode === 'change' ? 'change' : 'content',
            { regex: Boolean(message.regex), caseSensitive: Boolean(message.caseSensitive), limit: 500 }
        );
        postToRenderer({ type: 'gitHistorySearchResults', requestId: message.requestId, matches });
    } catch (error) {
        postToRenderer({ type: 'gitHistorySearchResults', requestId: message.requestId, matches: [], error: getErrorMessage(error) });
    }
}

function runRepositorySearch(message) {
    if (!repositorySearch) return;
    repositorySearch.handle?.cancel();
    repositorySearch.requestId = message.requestId;
    repositorySearch.startedAt = Date.now();
    repositorySearch.resultKeys.clear();
    repositorySearch.resultPaths.clear();
    repositorySearch.completedQuery = null;
    repositorySearch.replacementPlan = null;
    const globs = normalizeRepositorySearchGlobs(message.include, message.exclude);
    const pendingMatches = [];
    let flushTimer = null;
    const flush = () => {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = null;
        if (!repositorySearch || repositorySearch.requestId !== message.requestId || pendingMatches.length === 0) return;
        const matches = pendingMatches.splice(0).map((match) => ({
            ...match,
            relativePath: path.relative(repositorySearch.root, match.path).replace(/\\/g, '/')
        }));
        matches.forEach((match) => repositorySearch.resultKeys.add(repositorySearchResultKey(match)));
        matches.forEach((match) => repositorySearch.resultPaths.add(match.path));
        postToRenderer({ type: 'repositorySearchBatch', requestId: message.requestId, matches });
    };
    try {
        const handle = startRepositorySearch({
            root: repositorySearch.root,
            executable: repositorySearch.executable,
            pattern: String(message.query || ''),
            literal: !message.regex,
            caseSensitive: Boolean(message.caseSensitive),
            wholeWord: Boolean(message.wholeWord),
            hidden: Boolean(message.hidden),
            respectIgnores: message.respectIgnores !== false,
            globs,
            maxResults: normalizeRepositorySearchLimit(message.limit)
        }, (match) => {
            if (!repositorySearch || repositorySearch.requestId !== message.requestId) return;
            pendingMatches.push(match);
            if (pendingMatches.length >= 100) flush();
            else if (!flushTimer) flushTimer = setTimeout(flush, 40);
        });
        repositorySearch.handle = handle;
        void handle.completion.then((completion) => {
            flush();
            if (!repositorySearch || repositorySearch.requestId !== message.requestId) return;
            repositorySearch.handle = null;
            if (completion.kind === 'complete') {
                repositorySearch.completedQuery = {
                    requestId: message.requestId,
                    query: String(message.query || ''),
                    regex: Boolean(message.regex),
                    caseSensitive: Boolean(message.caseSensitive)
                };
            }
            postToRenderer({ type: 'repositorySearchComplete', requestId: message.requestId, completion });
        });
    } catch (error) {
        postToRenderer({
            type: 'repositorySearchComplete', requestId: message.requestId,
            completion: { kind: 'failed', matchCount: 0, message: getErrorMessage(error) }
        });
    }
}

function previewRepositoryReplacement(message) {
    const completed = repositorySearch?.completedQuery;
    if (!repositorySearch || !completed || completed.requestId !== message.requestId) return;
    if (completed.regex || !completed.caseSensitive) {
        postToRenderer({
            type: 'repositoryReplacementPreview', requestId: message.requestId,
            error: 'Replace in Files currently requires a completed case-sensitive literal search.'
        });
        return;
    }
    try {
        const plan = buildRepositoryReplacementPlan(
            repositorySearch.root,
            [...repositorySearch.resultPaths],
            completed.query,
            String(message.replacement ?? '')
        );
        repositorySearch.replacementPlan = plan;
        postToRenderer({
            type: 'repositoryReplacementPreview', requestId: message.requestId,
            files: plan.files.map((file) => ({ path: file.path, relativePath: file.relativePath, occurrenceCount: file.occurrenceCount })),
            occurrenceCount: plan.occurrenceCount
        });
    } catch (error) {
        postToRenderer({ type: 'repositoryReplacementPreview', requestId: message.requestId, error: getErrorMessage(error) });
    }
}

async function applyRepositoryReplacement(paths) {
    const plan = repositorySearch?.replacementPlan;
    if (!plan || paths.length === 0) return;
    const selected = plan.files.filter((file) => paths.includes(file.path));
    if (selected.length !== new Set(paths).size) {
        await showError('Replace in Files selection contains an unknown file. Build a new preview.');
        return;
    }
    const occurrences = selected.reduce((sum, file) => sum + file.occurrenceCount, 0);
    const confirmation = await dialog.showMessageBox(mainWindow ?? undefined, {
        type: 'warning',
        buttons: ['Replace', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Replace ${occurrences} occurrence${occurrences === 1 ? '' : 's'} in ${selected.length} file${selected.length === 1 ? '' : 's'}?`,
        detail: 'Bygone will revalidate every selected file before writing. You can undo immediately unless a file changes afterward.'
    });
    if (confirmation.response !== 0) return;
    try {
        const fileCount = applyRepositoryReplacementPlan(plan, paths);
        lastRepositoryReplacement = { plan, paths: [...paths] };
        repositorySearch.replacementPlan = null;
        postToRenderer({ type: 'repositoryReplacementApplied', fileCount, occurrenceCount: occurrences });
    } catch (error) {
        await showError(`Replace in Files failed without leaving a partial write where rollback succeeded: ${getErrorMessage(error)}`);
    }
}

async function undoLastRepositoryReplacement() {
    if (!lastRepositoryReplacement) return;
    try {
        const fileCount = undoRepositoryReplacementPlan(lastRepositoryReplacement.plan, lastRepositoryReplacement.paths);
        lastRepositoryReplacement = null;
        postToRenderer({ type: 'repositoryReplacementUndone', fileCount });
    } catch (error) {
        await showError(`Could not undo Replace in Files: ${getErrorMessage(error)}`);
    }
}

function normalizeRepositorySearchGlobs(include, exclude) {
    const split = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
    return [...split(include), ...split(exclude).map((glob) => glob.startsWith('!') ? glob : `!${glob}`)].slice(0, 50);
}

function normalizeRepositorySearchLimit(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isInteger(parsed) ? Math.min(5_000, Math.max(1, parsed)) : 1_000;
}

function repositorySearchResultKey(match) {
    return `${match.path}\0${match.line}\0${match.column}\0${match.endColumn}`;
}

async function openRepositorySearchResult(message) {
    if (!repositorySearch || !repositorySearch.resultKeys.has(repositorySearchResultKey({
        path: message.path, line: message.line, column: message.column, endColumn: message.endColumn
    }))) return;
    let realPath, stats;
    try {
        realPath = fs.realpathSync(message.path);
        stats = fs.statSync(realPath);
    } catch {
        await showError('This search result no longer exists. Run the search again.');
        return;
    }
    const relativePath = path.relative(repositorySearch.root, realPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || !stats.isFile()) return;
    if (stats.mtimeMs > repositorySearch.startedAt) {
        await showError('This file changed after the search started. Run the search again before opening the result.');
        return;
    }
    if (classifyFile(realPath) !== 'text') {
        await showError('This result is no longer a supported text file.');
        return;
    }
    if (!await confirmSessionReplacement('open a repository search result')) return;
    const content = readFileContent(realPath);
    const panel = {
        id: `panel-${nextMultiPanelId++}`,
        path: '',
        label: relativePath || path.basename(realPath),
        content,
        savedContent: content,
        dirty: false,
        editable: false
    };
    session = {
        mode: 'multi-diff', source: { kind: 'repository-search-result', root: repositorySearch.root, path: realPath },
        left: createSideState('', ''), right: createSideState('', ''), history: null, directory: null,
        multi: { sourceKind: 'files', files: [panel], activePanelId: panel.id, activePairIndex: 0, historySource: null },
        dirHistory: null, returnDirectory: null
    };
    clearWatchers();
    await sendCurrentMultiDiff();
    postToRenderer({
        type: 'revealSearchResult', sideIndex: 0, lineNumber: message.line,
        startColumn: message.column, endColumn: message.endColumn
    });
}

async function openFileHistorySearchResult(historyIndex) {
    if (session.mode !== 'multi-diff' || session.multi?.sourceKind !== 'history' || !session.multi.historySource) return;
    const source = session.multi.historySource;
    const entry = source.entries[historyIndex];
    if (!entry) return;
    session.multi.files = [
        createHistoryMultiPanelState(entry, historyIndex, 'left', source.filePath),
        createHistoryMultiPanelState(entry, historyIndex, 'right', source.filePath)
    ];
    session.multi.activePanelId = session.multi.files[1].id;
    session.multi.activePairIndex = 0;
    await sendCurrentMultiDiff();
}

async function openDirectoryEntryMultiPanel(dirs, labels, relativePath, review = null) {
    if (!await confirmSessionReplacement('open another directory file')) {
        return;
    }
    const panels = dirs.map((dir, i) => {
        const filePath = path.join(dir, relativePath);
        const exists = getPathKind(filePath) === 'file';
        const content = exists ? readFileContent(filePath) : '';
        return {
            id: `panel-${nextMultiPanelId++}`,
            path: exists ? filePath : '',
            label: `${labels[i]} / ${relativePath}${exists ? '' : ' (missing)'}`,
            content,
            savedContent: content,
            dirty: false,
            editable: false
        };
    });

    const source = cloneSessionSource(session.source);
    const tempRoots = [...(session.directory?.tempRoots || session.returnDirectory?.tempRoots || [])];
    session = {
        mode: 'multi-diff',
        source,
        left: createSideState('', ''),
        right: createSideState('', ''),
        history: null,
        directory: null,
        multi: {
            sourceKind: 'normal',
            files: panels,
            activePanelId: panels[panels.length - 1]?.id ?? null,
            activePairIndex: panels.length > 1 ? panels.length - 2 : null,
            historySource: null
        },
        dirHistory: null,
        returnDirectory: { dirs, labels, relativePath, review, source, tempRoots }
    };

    clearWatchers();
    updateWatchers();
    await sendCurrentMultiDiff();
}

async function openDirectoryFileDiff(dirs, labels, relativePath, review = null) {
    if (!await confirmSessionReplacement('open another directory file')) {
        return;
    }
    const reviewPair = review ? resolveReviewPathPair(review.changedPaths, relativePath) : null;
    const reviewKey = reviewPair?.key || relativePath;
    const leftRelativePath = reviewPair?.leftPath ?? relativePath;
    const rightRelativePath = reviewPair?.rightPath ?? relativePath;
    const leftPath = path.join(dirs[0], leftRelativePath);
    const rightPath = path.join(dirs[1], rightRelativePath);
    const leftExists = getPathKind(leftPath) === 'file';
    const rightExists = getPathKind(rightPath) === 'file';

    if (!leftExists && !rightExists) {
        await showInfo('That entry does not exist on either side.');
        return;
    }

    const binaryComparison = buildBinaryComparison(
        leftPath,
        rightPath,
        `${labels[0]} / ${leftRelativePath}${leftExists ? '' : ' (missing)'}`,
        `${labels[1]} / ${rightRelativePath}${rightExists ? '' : ' (missing)'}`
    );
    const leftContent = leftExists && !binaryComparison ? readFileContent(leftPath) : '';
    const rightContent = rightExists && !binaryComparison ? readFileContent(rightPath) : '';
    const left = createSideState(leftExists ? leftPath : '', leftContent);
    const right = createSideState(rightExists ? rightPath : '', rightContent);

    left.label = `${labels[0]} / ${leftRelativePath}${leftExists ? '' : ' (missing)'}`;
    right.label = `${labels[1]} / ${rightRelativePath}${rightExists ? '' : ' (missing)'}`;

    const source = cloneSessionSource(session.source);
    const tempRoots = [...(session.directory?.tempRoots || session.returnDirectory?.tempRoots || [])];
    session = {
        mode: 'diff',
        source,
        left,
        right,
        binaryComparison,
        history: null,
        directory: null,
        multi: null,
        dirHistory: null,
        returnDirectory: {
            dirs: [...dirs],
            labels: [...labels],
            relativePath: reviewKey,
            comparisonSummary: reviewPair?.summary,
            review,
            source,
            tempRoots
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

    if ((session.mode === 'diff' || session.mode === 'multi-diff') && session.returnDirectory) {
        if (!await confirmSessionReplacement('return to the directory comparison')) {
            return;
        }
        const { dirs, labels, review, source, tempRoots } = session.returnDirectory;

        session = {
            mode: 'directory',
            source: cloneSessionSource(source),
            left: createSideState(dirs[0], ''),
            right: createSideState(dirs[dirs.length - 1], ''),
            history: null,
            directory: {
                dirs,
                labels,
                tempRoots: [...(tempRoots || [])],
                review: review || null
            },
            multi: null,
            dirHistory: null,
            returnDirectory: null
        };

        clearWatchers();
        updateWatchers();
        await sendCurrentDirectoryDiff();
        return;
    }

    await showInfo('No directory view to return to.');
}

function buildChangedFileEntries(entries) {
    return entries.filter((directoryEntry) => directoryEntry.status !== 'same' && !directoryEntry.isDirectory);
}

function buildReturnDirectoryEntries(returnDirectory) {
    if (!returnDirectory?.review) {
        return buildChangedFileEntries(buildMultiDirectoryComparison(returnDirectory?.dirs || []));
    }

    return returnDirectory.review.changedPaths.map((changedPath) => ({
        relativePath: changedPath.path,
        displayName: changedPath.previousPath && changedPath.previousPath !== changedPath.path
            ? `${changedPath.previousPath} → ${changedPath.path}`
            : changedPath.path,
        isDirectory: false,
        status: changedPath.kind === 'added'
            ? 'right-only'
            : changedPath.kind === 'deleted'
                ? 'left-only'
                : 'modified'
    }));
}

function buildStandaloneFileNavigationState() {
    if ((session.mode !== 'diff' && session.mode !== 'multi-diff') || !session.returnDirectory?.relativePath) {
        return {
            canGoPrevious: false,
            canGoNext: false
        };
    }

    const entries = buildReturnDirectoryEntries(session.returnDirectory);
    return buildDirectoryNavigationState(entries, session.returnDirectory.relativePath).fileNavigation;
}

function buildDirectoryDrilldownNavigationState() {
    if ((session.mode !== 'diff' && session.mode !== 'multi-diff') || !session.returnDirectory?.relativePath) {
        return null;
    }

    const entries = buildReturnDirectoryEntries(session.returnDirectory);
    return buildDirectoryNavigationState(entries, session.returnDirectory.relativePath).directoryNavigation;
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
    if ((session.mode === 'diff' || session.mode === 'multi-diff') && session.returnDirectory?.relativePath) {
        const entries = buildReturnDirectoryEntries(session.returnDirectory);
        const currentIndex = entries.findIndex((entry) => entry.relativePath === session.returnDirectory.relativePath);
        const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
        const nextEntry = entries[nextIndex];
        if (!nextEntry) {
            return;
        }

        session.returnDirectory.review?.viewedPaths.add(nextEntry.relativePath);
        if (session.returnDirectory.dirs.length === 2) {
            await openDirectoryFileDiff(
                session.returnDirectory.dirs,
                session.returnDirectory.labels,
                nextEntry.relativePath,
                session.returnDirectory.review
            );
        } else {
            await openDirectoryEntryMultiPanel(
                session.returnDirectory.dirs,
                session.returnDirectory.labels,
                nextEntry.relativePath,
                session.returnDirectory.review
            );
        }
        return;
    }

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

}

async function sendCurrentMultiDiff() {
    if (session.mode !== 'multi-diff' || !session.multi) {
        return;
    }

    const sourceKind = session.multi.sourceKind;
    const fileCount = session.multi.files.length;
    const isDirectoryDrilldown = Boolean(session.returnDirectory);

    const panels = session.multi.files.map((file, index) => {
        let addLeftEnabled, removeEnabled, addRightEnabled;
        if (sourceKind === 'history') {
            addLeftEnabled = index === 0;
            removeEnabled = (index === 0 || index === fileCount - 1) && fileCount > 1;
            addRightEnabled = index === fileCount - 1;
        } else if (isDirectoryDrilldown) {
            addLeftEnabled = false;
            removeEnabled = false;
            addRightEnabled = false;
        } else {
            addLeftEnabled = true;
            removeEnabled = fileCount > 1;
            addRightEnabled = true;
        }
        return {
            id: file.id,
            label: file.label,
            path: file.path || file.label,
            content: file.content,
            editable: file.editable !== false,
            dirty: Boolean(file.dirty),
            addLeftEnabled,
            removeEnabled,
            addRightEnabled
        };
    });

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
        pairs: panels.slice(0, -1).map((_panel, index) => ({
            leftIndex: index,
            rightIndex: index + 1
        })),
        activePanelId,
        activePairIndex,
        canReturnToDirectory: Boolean(session.returnDirectory),
        directoryNavigation: buildDirectoryDrilldownNavigationState(),
        fileNavigation: buildStandaloneFileNavigationState(),
        mutationEnabled: !isDirectoryDrilldown,
        revealFirstChangeInEachPanel: isDirectoryDrilldown
    });

    refreshSessionWindowTitle();

    if (mainWindow && !mainWindow.isDestroyed()) {
        const inspectMultiDiff = () => {
            void mainWindow.webContents.executeJavaScript(`(() => ({
                fileInfo: document.getElementById('file-info')?.textContent,
                panelCount: document.querySelectorAll('.multi-pane').length,
                gutterCount: document.querySelectorAll('.multi-gutter').length,
                changePosition: document.getElementById('change-position')?.textContent,
                panelPositions: [...document.querySelectorAll('.multi-pane-position')].map((element) => element.textContent),
                decoratedLineCount: document.querySelectorAll('.bygone-paired-line, .bygone-one-sided-line').length,
                diffWorkerUrl: window.__BYGONE_HOST__?.diffWorkerUrl,
                activeDiffCount: document.querySelectorAll('.bygone-active-diff').length,
                adjacentEdgeCount: document.querySelectorAll('.bygone-paired-edge-left, .bygone-one-sided-edge-left').length,
                inlineAdjacentEdgeCount: document.querySelectorAll('.view-line span.bygone-paired-edge-left, .view-line span.bygone-one-sided-edge-left').length
            }))()`)
                .then((snapshot) => {
                    if (smokeTestMode) {
                        const diffReady = /^1 \/ [1-9]\d*$/.test(snapshot.changePosition)
                            && snapshot.panelPositions.some((position) => /^1 \/ [1-9]\d*$/.test(position))
                            && snapshot.decoratedLineCount > 0;
                        if (!diffReady) {
                            setTimeout(inspectMultiDiff, 100);
                            return;
                        }
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
        };
        setTimeout(inspectMultiDiff, smokeTestMode ? 100 : 400);
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

    await openDiff(leftPath, rightPath, { source: { kind: 'synthetic' } });
}

async function compareMultiTestFiles() {
    const contents = [
        'const alpha = 1;\nconst shared = true;\n',
        'const alpha = 2;\nconst shared = true;\n',
        'const alpha = 3;\nconst shared = false;\n'
    ];
    const files = contents.map((content, index) => ({
        id: `smoke-panel-${index}`,
        path: '',
        label: `test-panel-${index + 1}.js`,
        content,
        savedContent: content,
        dirty: false,
        editable: true
    }));

    session = {
        mode: 'multi-diff',
        source: { kind: 'synthetic' },
        left: createSideState('', ''),
        right: createSideState('', ''),
        history: null,
        directory: null,
        multi: {
            sourceKind: 'normal',
            files,
            activePanelId: files[1].id,
            activePairIndex: 0,
            historySource: null
        },
        dirHistory: null
    };

    clearWatchers();
    await sendCurrentMultiDiff();
}

async function compareDirectoryTestFiles() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-directory-smoke-'));
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');
    fs.mkdirSync(left, { recursive: true });
    fs.mkdirSync(right, { recursive: true });
    fs.writeFileSync(path.join(left, 'a.txt'), 'left a\n', 'utf8');
    fs.writeFileSync(path.join(right, 'a.txt'), 'right a\n', 'utf8');
    fs.writeFileSync(path.join(left, 'b.txt'), 'left b\n', 'utf8');
    fs.writeFileSync(path.join(right, 'b.txt'), 'right b\n', 'utf8');
    await openDirectories([left, right], { source: { kind: 'synthetic' } });
}

async function compareDirectoryHistoryTestFiles() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-directory-history-smoke-'));
    const filePath = path.join(root, 'history-smoke.js');
    runGit(['init'], root);
    runGit(['config', 'user.name', 'Bygone Smoke Test'], root);
    runGit(['config', 'user.email', 'bygone-smoke@example.invalid'], root);
    const unchangedPrefix = Array.from({ length: 80 }, (_, index) => `const context${index} = true;`).join('\n');
    fs.writeFileSync(filePath, `${unchangedPrefix}\nconst alpha = 1;\n`, 'utf8');
    runGit(['add', 'history-smoke.js'], root);
    runGit(['commit', '-m', 'initial'], root);
    fs.writeFileSync(filePath, `${unchangedPrefix}\nconst alpha = 2;\n`, 'utf8');
    runGit(['add', 'history-smoke.js'], root);
    runGit(['commit', '-m', 'change history smoke fixture'], root);
    await openDirectoryHistory(root, false, { skipConfirm: true, source: { kind: 'synthetic' } });
}

function pollDirectoryHistoryDrilldownSmoke() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    void mainWindow.webContents.executeJavaScript(`(() => ({
        directoryHistoryDrilldown: true,
        fileInfo: document.getElementById('file-info')?.textContent,
        changePosition: document.getElementById('change-position')?.textContent,
        panelPositions: [...document.querySelectorAll('.multi-pane-position')].map((element) => element.textContent),
        decoratedLineCount: document.querySelectorAll('.bygone-paired-line, .bygone-one-sided-line').length,
        visibleChangePaneCount: [...document.querySelectorAll('.multi-pane-content .view-lines')]
            .filter((element) => element.textContent.includes('alpha')).length,
        diffWorkerUrl: window.__BYGONE_HOST__?.diffWorkerUrl
    }))()`)
        .then((snapshot) => {
            const ready = /^1 \/ [1-9]\d*$/.test(snapshot.changePosition)
                && snapshot.panelPositions.some((position) => /^1 \/ [1-9]\d*$/.test(position))
                && snapshot.decoratedLineCount > 0
                && snapshot.visibleChangePaneCount === 2;
            if (ready) {
                finalizeSmokeTest(snapshot);
                return;
            }
            setTimeout(pollDirectoryHistoryDrilldownSmoke, 100);
        })
        .catch((error) => {
            console.error(`Bygone directory history smoke test failed: ${getErrorMessage(error)}`);
            process.exitCode = 1;
            app.exit(1);
        });
}

async function sendCurrentDiff() {
    if (session.mode !== 'diff') {
        return;
    }

    if (session.binaryComparison) {
        postOrQueue({
            type: 'showBinaryDiff',
            comparison: session.binaryComparison,
            comparisonSummary: session.returnDirectory?.comparisonSummary,
            fileNavigation: buildStandaloneFileNavigationState(),
            directoryNavigation: buildDirectoryDrilldownNavigationState(),
            canReturnToDirectory: Boolean(session.returnDirectory)
        });
        refreshSessionWindowTitle();
        scheduleCaptureIfNeeded();
        return;
    }

    const diffModel = buildTwoWayDiffModel(session.left.content, session.right.content);
    const message = {
        type: 'showDiff',
        file1: session.left.label,
        file2: session.right.label,
        comparisonId: `${session.left.path}\u0000${session.right.path}`,
        leftContent: session.left.content,
        rightContent: session.right.content,
        sourceInfo: {
            leftPath: session.left.path || session.left.label,
            rightPath: session.right.path || session.right.label
        },
        diffModel,
        history: null,
        fileNavigation: buildStandaloneFileNavigationState(),
        directoryNavigation: buildDirectoryDrilldownNavigationState(),
        editableSides: {
            left: !session.returnDirectory?.review,
            right: !session.returnDirectory?.review
        },
        canReturnToDirectory: Boolean(session.returnDirectory),
        comparisonSummary: session.returnDirectory?.comparisonSummary
    };

    postOrQueue(message);
    refreshSessionWindowTitle();

    if (mainWindow && !mainWindow.isDestroyed()) {
        setTimeout(() => {
            void mainWindow.webContents.executeJavaScript(`(() => ({
                fileInfo: document.getElementById('file-info')?.textContent,
                file1: document.getElementById('file1-header')?.textContent,
                file2: document.getElementById('file2-header')?.textContent,
                changePosition: document.getElementById('change-position')?.textContent,
                pairedLineCount: document.querySelectorAll('.bygone-paired-line').length,
                oneSidedLineCount: document.querySelectorAll('.bygone-one-sided-line').length,
                inlineHighlightCount: document.querySelectorAll('.bygone-inline-blue').length,
                activeDiffCount: document.querySelectorAll('.bygone-active-diff').length,
                pairedLineBackground: getComputedStyle(document.querySelector('.bygone-paired-line')).backgroundColor,
                inlineHighlightBackground: getComputedStyle(document.querySelector('.bygone-inline-blue')).backgroundColor,
                directoryRailVisible: !document.getElementById('history-rail')?.hidden,
                directoryRailItemCount: document.querySelectorAll('.history-rail-item').length,
                directoryReturnVisible: !document.getElementById('directory-return-toolbar')?.hidden,
                directorySidebarToggleVisible: !document.getElementById('toggle-directory-sidebar')?.hidden,
                directorySidebarToggleWorked: (() => {
                    const toggle = document.getElementById('toggle-directory-sidebar');
                    const rail = document.getElementById('history-rail');
                    if (!toggle || !rail || toggle.hidden) return false;
                    toggle.click();
                    const hidden = rail.hidden;
                    toggle.click();
                    return hidden && !rail.hidden;
                })(),
                nextFileEnabled: !document.getElementById('next-file')?.disabled
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
        comparisonId: `${session.history.filePath}\u0000${entry.commit}`,
        leftContent: entry.leftContent,
        rightContent: entry.rightContent,
        sourceInfo: {
            leftPath: session.history.filePath,
            rightPath: session.history.filePath
        },
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

    refreshSessionWindowTitle();

    if (mainWindow && !mainWindow.isDestroyed()) {
        setTimeout(() => {
            void mainWindow.webContents.executeJavaScript(`(() => ({
                fileInfo: document.getElementById('file-info')?.textContent,
                file1: document.getElementById('file1-header')?.textContent,
                file2: document.getElementById('file2-header')?.textContent,
                historyPosition: document.getElementById('history-position')?.textContent
            }))()`)
                .then((_snapshot) => {
                    if (captureMode) {
                        scheduleCaptureIfNeeded();
                    }
                })
                .catch((error) => {
                    if (captureMode) {
                        console.error(`Bygone capture failed: ${getErrorMessage(error)}`);
                        process.exitCode = 1;
                        app.exit(1);
                    }
                });
        }, 400);
    }
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

        session.dirHistory.displayedRange = [session.dirHistory.index, session.dirHistory.index];
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
        session.source = createFileHistorySource(session.history.filePath, session.history.includeStaged, skipUnchanged);
        session.history.skipUnchanged = skipUnchanged;
        const normalizedIndex = normalizeHistoryIndex(getVisibleFileHistoryIndices(session.history), session.history.index);
        if (normalizedIndex !== null) {
            session.history.index = normalizedIndex;
        }
        await sendCurrentHistoryEntry();
        return;
    }

    if (session.mode === 'directory-history' && session.dirHistory) {
        session.source = createDirectoryHistorySource(session.dirHistory.dirPath, session.dirHistory.includeStaged, skipUnchanged);
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
        session.dirHistory.displayedRange = [index, index];
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
    acknowledgeCurrentSourceState();
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
    acknowledgeCurrentSourceState();
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

    return saveMultiPanel(panel, {
        dialogTitle: 'Save active file',
        refreshView: true
    });
}

async function saveDirtyMultiPanels() {
    if (session.mode !== 'multi-diff' || !session.multi) {
        return true;
    }

    for (const panel of session.multi.files) {
        if (!panel.dirty) {
            continue;
        }

        const saved = await saveMultiPanel(panel, {
            dialogTitle: `Save ${panel.label || 'file'}`,
            refreshView: false
        });
        if (!saved) {
            return false;
        }
    }

    updateWatchers();
    await sendCurrentMultiDiff();
    refreshSessionWindowTitle();
    return true;
}

async function saveMultiPanel(panel, { dialogTitle, refreshView }) {
    let targetPath = panel.path;
    if (!targetPath) {
        if (!mainWindow) {
            return false;
        }

        const result = await dialog.showSaveDialog(mainWindow, {
            title: dialogTitle,
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

    if (refreshView) {
        updateWatchers();
        await sendCurrentMultiDiff();
        refreshSessionWindowTitle();
    }

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

    acknowledgeCurrentSourceState();
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

    acknowledgeCurrentSourceState();
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
    if (!isRefreshableSource(session.source)) {
        return;
    }
    sourceStale = false;
    refreshFailure = null;
    sourceFingerprint = computeSourceFingerprint(session.source);

    for (const watchPath of getSourceWatchPaths(session.source)) {
        if (!fs.existsSync(watchPath)) {
            continue;
        }
        try {
            const recursive = getPathKind(watchPath) === 'directory'
                && (process.platform === 'darwin' || process.platform === 'win32');
            const watcher = fs.watch(watchPath, { recursive }, scheduleSourceCheck);
            fileWatchers.push(watcher);
        } catch {
            // Polling below remains the cross-platform fallback.
        }
    }
    sourceMonitorInterval = setInterval(scheduleSourceCheck, 3000);
    sourceMonitorInterval.unref?.();
}

function acknowledgeCurrentSourceState() {
    if (!isRefreshableSource(session.source)) {
        return;
    }
    sourceFingerprint = computeSourceFingerprint(session.source);
    sourceStale = false;
    postRefreshState();
}

function clearWatchers() {
    fileWatchers.forEach((watcher) => watcher.close());
    fileWatchers = [];
    clearInterval(sourceMonitorInterval);
    sourceMonitorInterval = undefined;
    clearTimeout(sourceChangeTimer);
    sourceChangeTimer = undefined;
    sourceFingerprint = null;
}

function updateWindowTitle(title) {
    if (!mainWindow) {
        return;
    }

    const dirtySuffix = hasUnsavedChanges() ? ' • Unsaved' : '';
    mainWindow.setTitle(`${APP_NAME} — ${title}${dirtySuffix}`);
}

function refreshSessionWindowTitle() {
    if (session.mode === 'history' && session.history) {
        const visibleIndices = getVisibleFileHistoryIndices(session.history);
        const visiblePosition = visibleIndices.indexOf(session.history.index);
        const entry = session.history.entries[session.history.index];
        const fileName = path.basename(session.history.filePath);
        updateWindowTitle(buildHistoryTitle(fileName, {
            shortCommit: entry?.shortCommit,
            positionLabel: visiblePosition >= 0
                ? `${visiblePosition + 1} / ${visibleIndices.length}`
                : undefined
        }));
        return;
    }

    updateWindowTitle(buildStandaloneSessionTitle(session));
}

async function confirmSessionReplacement(action) {
    if (!hasUnsavedChanges()) {
        return true;
    }
    if (!mainWindow) {
        return false;
    }

    const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Save All', 'Discard', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: `Save your changes before you ${action}?`,
        detail: 'Continuing without saving will discard unsaved Bygone edits.'
    });
    if (choice.response === 2) {
        return false;
    }
    if (choice.response === 0) {
        return Boolean(await saveAllDirtySides());
    }
    return true;
}

function getRefreshState() {
    const enabled = isRefreshableSource(session.source);
    return {
        enabled,
        status: refreshInProgress
            ? 'refreshing'
            : (refreshFailure ? 'failed' : (sourceStale ? 'stale' : (enabled ? 'idle' : 'disabled'))),
        message: refreshFailure
    };
}

function postRefreshState() {
    installApplicationMenu();
    if (hostReady) {
        postToRenderer({ type: 'refreshState', refreshState: getRefreshState() });
    }
}

function safeRunGit(args, cwd) {
    try {
        return runGit(args, cwd);
    } catch {
        return 'missing';
    }
}

function pathFingerprint(targetPath, recursive = false, limit = 10000) {
    const pending = [path.resolve(targetPath)];
    const parts = [];
    while (pending.length > 0 && parts.length < limit) {
        const currentPath = pending.pop();
        let stats;
        try {
            stats = fs.statSync(currentPath);
        } catch {
            parts.push(`${currentPath}:missing`);
            continue;
        }
        parts.push(`${currentPath}:${stats.size}:${stats.mtimeMs}`);
        if (recursive && stats.isDirectory()) {
            let children = [];
            try {
                children = fs.readdirSync(currentPath).sort().reverse();
            } catch {
                // The next poll will retry unreadable or transient directories.
            }
            children.forEach((child) => pending.push(path.join(currentPath, child)));
        }
    }
    if (pending.length > 0) {
        parts.push(`truncated:${pending.length}`);
    }
    return parts.join('|');
}

function getSourceRepoRoot(source) {
    if (source.repoRoot) {
        return source.repoRoot;
    }
    try {
        return fs.realpathSync(runGit(['rev-parse', '--show-toplevel'], source.path));
    } catch {
        return null;
    }
}

function computeSourceFingerprint(source) {
    if (!isRefreshableSource(source)) {
        return null;
    }
    if (source.kind === 'files') {
        return source.paths.map((filePath) => pathFingerprint(filePath)).join('\n');
    }
    if (source.kind === 'directories') {
        return source.paths.map((dirPath) => pathFingerprint(dirPath, true)).join('\n');
    }

    const repoRoot = getSourceRepoRoot(source);
    if (!repoRoot) {
        return `missing-repository:${source.path || source.repoRoot}`;
    }
    const gitDir = safeRunGit(['rev-parse', '--git-dir'], repoRoot);
    const resolvedGitDir = path.resolve(repoRoot, gitDir);
    const indexFingerprint = pathFingerprint(path.join(resolvedGitDir, 'index'));

    if (source.kind === 'file-history') {
        return [
            safeRunGit(['rev-parse', 'HEAD'], repoRoot),
            indexFingerprint,
            pathFingerprint(source.path)
        ].join('\n');
    }
    if (source.kind === 'directory-history') {
        return [
            safeRunGit(['rev-parse', 'HEAD'], repoRoot),
            indexFingerprint,
            pathFingerprint(source.path, true)
        ].join('\n');
    }
    if (source.kind === 'git-refs') {
        const refs = source.refs.map((ref) => {
            const normalized = ref.toUpperCase();
            if (normalized === 'INDEX') {
                return `INDEX:${indexFingerprint}`;
            }
            if (normalized === 'WORKTREE' || normalized === 'WORKDIR' || normalized === 'WORKINGTREE') {
                return `WORKTREE:${safeRunGit(['status', '--porcelain=v1', '--untracked-files=normal'], repoRoot)}`;
            }
            return `${ref}:${safeRunGit(['rev-parse', '--verify', `${ref}^{commit}`], repoRoot)}`;
        });
        return refs.join('\n');
    }
    if (source.kind === 'branch-review') {
        try {
            const review = resolveBranchReviewRange(repoRoot, source.headRef, source.baseRef);
            return [review.headOid, review.baseOid, review.mergeBaseOid, review.dirty ? 'dirty' : 'clean'].join(':');
        } catch (error) {
            return `unresolved:${getErrorMessage(error)}`;
        }
    }
    return null;
}

function getSourceWatchPaths(source) {
    if (source.kind === 'files' || source.kind === 'directories') {
        return [...source.paths];
    }
    const repoRoot = getSourceRepoRoot(source);
    if (!repoRoot) {
        return source.path ? [source.path] : [];
    }
    const gitDir = safeRunGit(['rev-parse', '--git-dir'], repoRoot);
    const paths = [path.resolve(repoRoot, gitDir), repoRoot];
    if (source.path) {
        paths.push(source.path);
    }
    return [...new Set(paths)];
}

function scheduleSourceCheck() {
    clearTimeout(sourceChangeTimer);
    sourceChangeTimer = setTimeout(() => {
        sourceChangeTimer = undefined;
        void checkForSourceChanges();
    }, 250);
}

async function checkForSourceChanges() {
    if (refreshInProgress || !isRefreshableSource(session.source)) {
        return;
    }
    const latestFingerprint = computeSourceFingerprint(session.source);
    if (latestFingerprint === sourceFingerprint) {
        return;
    }
    if (session.source.kind === 'files' && !hasUnsavedChanges()) {
        await refreshSession({ reason: 'automatic', skipConfirm: true });
        return;
    }
    sourceStale = true;
    refreshFailure = null;
    postRefreshState();
}

function getSessionTempRoots(targetSession) {
    if (Array.isArray(targetSession?.directory?.tempRoots)) {
        return targetSession.directory.tempRoots;
    }
    if (Array.isArray(targetSession?.returnDirectory?.tempRoots)) {
        return targetSession.returnDirectory.tempRoots;
    }
    return [];
}

async function captureSessionNavigation(targetSession) {
    const snapshot = {
        relativePath: targetSession.returnDirectory?.relativePath || targetSession.dirHistory?.viewRelativePath || null,
        activePanelPath: null,
        historyCommit: null,
        historySide: null,
        directoryHistoryCommit: targetSession.dirHistory?.entries?.[targetSession.dirHistory.index]?.commit || null,
        viewedPaths: [...(targetSession.directory?.review?.viewedPaths || targetSession.returnDirectory?.review?.viewedPaths || [])],
        panelIdentities: [],
        renderer: await requestRendererNavigationState()
    };

    if (targetSession.mode === 'multi-diff' && targetSession.multi) {
        snapshot.panelIdentities = targetSession.multi.files.map((panel) => ({
            id: panel.id,
            path: panel.path || null,
            label: panel.label,
            historyCommit: targetSession.multi.historySource?.entries?.[panel.historyEntryIndex]?.commit || null,
            historySide: panel.historySide || null
        }));
        const activePanel = targetSession.multi.files.find((panel) => panel.id === targetSession.multi.activePanelId);
        snapshot.activePanelPath = activePanel?.path || null;
        if (targetSession.multi.sourceKind === 'history' && activePanel) {
            snapshot.historyCommit = targetSession.multi.historySource?.entries?.[activePanel.historyEntryIndex]?.commit || null;
            snapshot.historySide = activePanel.historySide || null;
        }
    }

    return snapshot;
}

function requestRendererNavigationState() {
    if (!hostReady || !mainWindow || mainWindow.isDestroyed()) {
        return Promise.resolve(null);
    }
    const requestId = ++navigationRequestId;
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            pendingNavigationRequests.delete(requestId);
            resolve(null);
        }, 750);
        pendingNavigationRequests.set(requestId, { resolve, timeout });
        postToRenderer({ type: 'captureNavigationState', requestId });
    });
}

function buildPanelIdMap(snapshot) {
    if (session.mode !== 'multi-diff' || !session.multi) {
        return {};
    }
    const available = new Set(session.multi.files.map((panel) => panel.id));
    const result = {};
    for (const previous of snapshot.panelIdentities) {
        const matching = session.multi.files.find((panel) => {
            if (!available.has(panel.id)) {
                return false;
            }
            if (previous.path && panel.path === previous.path) {
                return true;
            }
            const historyEntry = session.multi.historySource?.entries?.[panel.historyEntryIndex];
            return previous.historyCommit
                && historyEntry?.commit === previous.historyCommit
                && panel.historySide === previous.historySide;
        });
        if (matching) {
            result[previous.id] = matching.id;
            available.delete(matching.id);
        }
    }
    return result;
}

function postNavigationRestore(snapshot, panelIdMap = {}) {
    if (!snapshot.renderer || !hostReady) {
        return;
    }
    postToRenderer({
        type: 'restoreNavigationState',
        navigation: snapshot.renderer,
        panelIdMap
    });
}

function buildSessionFromSource(source) {
    if (source.kind === 'files') {
        const paths = source.paths.map((filePath) => path.resolve(filePath));
        if (paths.length < 1 || !paths.every((filePath) => getPathKind(filePath) === 'file')) {
            throw new Error('One or more source files no longer exist.');
        }
        const binaryComparison = paths.length === 2 ? buildBinaryComparison(paths[0], paths[1]) : null;
        if (binaryComparison) {
            return {
                mode: 'diff',
                source: cloneSessionSource(source),
                left: createSideState(paths[0], ''),
                right: createSideState(paths[1], ''),
                binaryComparison,
                history: null,
                directory: null,
                multi: null,
                dirHistory: null,
                returnDirectory: null
            };
        }
        const files = paths.map((filePath) => createMultiPanelState(filePath));
        return {
            mode: 'multi-diff',
            source: cloneSessionSource(source),
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
            dirHistory: null,
            returnDirectory: null
        };
    }

    if (source.kind === 'directories') {
        const dirs = source.paths.map((dirPath) => path.resolve(dirPath));
        if (dirs.length < 2 || !dirs.every((dirPath) => getPathKind(dirPath) === 'directory')) {
            throw new Error('One or more source directories no longer exist.');
        }
        const labels = Array.isArray(source.labels) && source.labels.length === dirs.length
            ? [...source.labels]
            : dirs.map((dirPath) => path.basename(dirPath));
        return createDirectorySession(dirs, labels, source);
    }

    if (source.kind === 'file-history') {
        const entries = gitHistoryService.buildFileHistory(source.path, source.includeStaged);
        if (entries.length === 0) {
            throw new Error('No Git history with parents was found for that file.');
        }
        const historySource = {
            filePath: source.path,
            entries,
            includeStaged: Boolean(source.includeStaged),
            skipUnchanged: Boolean(source.skipUnchanged)
        };
        const files = [
            createHistoryMultiPanelState(entries[0], 0, 'left', source.path),
            createHistoryMultiPanelState(entries[0], 0, 'right', source.path)
        ];
        return {
            mode: 'multi-diff',
            source: cloneSessionSource(source),
            left: createSideState('', ''),
            right: createSideState('', ''),
            history: null,
            directory: null,
            multi: {
                sourceKind: 'history',
                files,
                activePanelId: files[1]?.id ?? null,
                activePairIndex: 0,
                historySource
            },
            dirHistory: null,
            returnDirectory: null
        };
    }

    if (source.kind === 'directory-history') {
        const historyState = buildDirectoryHistory(source.path, source.includeStaged);
        historyState.skipUnchanged = Boolean(source.skipUnchanged);
        if (historyState.entries.length === 0) {
            throw new Error('No Git history with parents was found for that directory.');
        }
        return {
            mode: 'directory-history',
            source: cloneSessionSource(source),
            left: createSideState('', ''),
            right: createSideState('', ''),
            history: null,
            directory: null,
            multi: null,
            dirHistory: historyState,
            returnDirectory: null
        };
    }

    if (source.kind === 'git-refs') {
        const resolved = source.refs.map((ref) => resolveGitRefForDiff(source.repoRoot, ref));
        const tempRoots = [];
        try {
            const dirs = resolved.map((resolvedSource) => {
                const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-gitdiff-'));
                tempRoots.push(root);
                trackedGitDiffTempRoots.add(root);
                materializeGitDiffSource(source.repoRoot, resolvedSource, root);
                return root;
            });
            return createDirectorySession(
                dirs,
                resolved.map((resolvedSource) => getGitDiffSourceLabel(resolvedSource)),
                source,
                { tempRoots }
            );
        } catch (error) {
            cleanupGitDiffTempRoots(tempRoots);
            throw error;
        }
    }

    if (source.kind === 'branch-review') {
        const review = resolveBranchReviewRange(source.repoRoot, source.headRef, source.baseRef);
        if (review.changedPaths.length === 0) {
            throw new Error(`${review.headRef} has no changes relative to ${review.baseRef}.`);
        }
        const tempRoots = [];
        try {
            tempRoots.push(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-review-base-')));
            trackedGitDiffTempRoots.add(tempRoots[0]);
            tempRoots.push(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-review-head-')));
            trackedGitDiffTempRoots.add(tempRoots[1]);
            materializeBranchReviewTrees(review, tempRoots[0], tempRoots[1]);
            return createDirectorySession(
                tempRoots,
                [
                    `${review.baseRef} @ ${review.mergeBaseOid.slice(0, 7)}`,
                    `${review.headRef} @ ${review.headOid.slice(0, 7)}`
                ],
                source,
                {
                    tempRoots,
                    review: { ...review, viewedPaths: new Set() }
                }
            );
        } catch (error) {
            cleanupGitDiffTempRoots(tempRoots);
            throw error;
        }
    }

    throw new Error(`Session source ${source.kind} cannot be refreshed.`);
}

function createDirectorySession(dirs, labels, source, options = {}) {
    return {
        mode: 'directory',
        source: cloneSessionSource(source),
        left: createSideState(dirs[0], ''),
        right: createSideState(dirs[dirs.length - 1], ''),
        history: null,
        directory: {
            dirs: [...dirs],
            labels: [...labels],
            tempRoots: [...(options.tempRoots || [])],
            review: options.review || null
        },
        multi: null,
        dirHistory: null,
        returnDirectory: null
    };
}

async function restoreSessionNavigation(snapshot) {
    const review = session.directory?.review || session.returnDirectory?.review;
    if (review && snapshot.viewedPaths.length > 0) {
        snapshot.viewedPaths.forEach((relativePath) => review.viewedPaths.add(relativePath));
    }

    if (session.mode === 'directory-history' && session.dirHistory) {
        const matchingIndex = session.dirHistory.entries.findIndex((entry) => entry.commit === snapshot.directoryHistoryCommit);
        if (matchingIndex >= 0) {
            session.dirHistory.index = matchingIndex;
            session.dirHistory.displayedRange = [matchingIndex, matchingIndex];
        }
        session.dirHistory.viewRelativePath = snapshot.relativePath;
        await sendCurrentDirectoryHistoryEntry();
        postNavigationRestore(snapshot);
        return;
    }

    if (session.mode === 'multi-diff' && session.multi?.sourceKind === 'history' && snapshot.historyCommit) {
        const historySource = session.multi.historySource;
        const matchingIndex = historySource.entries.findIndex((entry) => entry.commit === snapshot.historyCommit);
        if (matchingIndex >= 0) {
            const entry = historySource.entries[matchingIndex];
            const files = [
                createHistoryMultiPanelState(entry, matchingIndex, 'left', historySource.filePath),
                createHistoryMultiPanelState(entry, matchingIndex, 'right', historySource.filePath)
            ];
            session.multi.files = files;
            const activeIndex = snapshot.historySide === 'left' ? 0 : 1;
            session.multi.activePanelId = files[activeIndex]?.id ?? files[0]?.id ?? null;
            session.multi.activePairIndex = files.length > 1 ? 0 : null;
        }
        await sendCurrentMultiDiff();
        postNavigationRestore(snapshot, buildPanelIdMap(snapshot));
        return;
    }

    if (session.mode === 'directory' && snapshot.relativePath) {
        const entries = session.directory?.review
            ? session.directory.review.changedPaths.map((entry) => entry.path)
            : buildChangedFileEntries(buildMultiDirectoryComparison(session.directory?.dirs || []))
                .map((entry) => entry.relativePath);
        if (entries.includes(snapshot.relativePath)) {
            await openDirectoryEntry(snapshot.relativePath);
            postNavigationRestore(snapshot, buildPanelIdMap(snapshot));
            return;
        }
        await showInfo(`${snapshot.relativePath} is no longer present in this comparison.`);
    }

    if (session.mode === 'multi-diff' && session.multi && snapshot.activePanelPath) {
        const matchingPanel = session.multi.files.find((panel) => panel.path === snapshot.activePanelPath);
        if (matchingPanel) {
            session.multi.activePanelId = matchingPanel.id;
            const panelIndex = session.multi.files.indexOf(matchingPanel);
            session.multi.activePairIndex = normalizeMultiPairIndex(Math.max(0, panelIndex - 1), session.multi.files.length);
        }
    }

    await sendCurrentSession();
    postNavigationRestore(snapshot, buildPanelIdMap(snapshot));
}

async function refreshSession(options = {}) {
    if (refreshInProgress || !isRefreshableSource(session.source)) {
        return;
    }
    const previousSession = session;
    if (!options.skipConfirm && !await confirmSessionReplacement('refresh this session')) {
        return;
    }
    if (session !== previousSession) {
        return;
    }

    const source = cloneSessionSource(session.source);
    const previousTempRoots = [...getSessionTempRoots(previousSession)];
    const navigation = await captureSessionNavigation(previousSession);
    if (session !== previousSession) {
        return;
    }
    refreshInProgress = true;
    refreshFailure = null;
    postRefreshState();

    try {
        const replacementSession = buildSessionFromSource(source);
        if (session !== previousSession) {
            cleanupGitDiffTempRoots(getSessionTempRoots(replacementSession));
            return;
        }
        session = replacementSession;
        historyIncludeStagedPreference = Boolean(source.includeStaged ?? historyIncludeStagedPreference);
        historySkipUnchangedPreference = Boolean(source.skipUnchanged ?? historySkipUnchangedPreference);
        clearWatchers();
        updateWatchers();
        await sendCurrentSession();
        if (session !== replacementSession) {
            cleanupGitDiffTempRoots(getSessionTempRoots(replacementSession));
            return;
        }
        await restoreSessionNavigation(navigation);
        const retainedRoots = new Set(getSessionTempRoots(session));
        cleanupGitDiffTempRoots(previousTempRoots.filter((root) => !retainedRoots.has(root)));
    } catch (error) {
        if (session !== previousSession) {
            const replacementRoots = getSessionTempRoots(session);
            session = previousSession;
            cleanupGitDiffTempRoots(replacementRoots);
            clearWatchers();
            updateWatchers();
            await sendCurrentSession();
        }
        if (options.reason === 'automatic') {
            sourceStale = true;
            refreshFailure = null;
        } else {
            refreshFailure = getErrorMessage(error);
            await showError(`Could not refresh session: ${refreshFailure}`);
        }
    } finally {
        refreshInProgress = false;
        postRefreshState();
    }
}

function postOrQueue(message) {
    installApplicationMenu();
    if (message && typeof message === 'object' && typeof message.type === 'string' && message.type.startsWith('show')) {
        persistOpenWindowState();
        if (!refreshInProgress) {
            refreshFailure = null;
        }
        message.refreshState = getRefreshState();
    }
    if (captureMode
        && message
        && typeof message === 'object'
        && (message.type === 'showDiff'
            || message.type === 'showBinaryDiff'
            || message.type === 'showDirectoryDiff'
            || message.type === 'showMultiDiff'
            || message.type === 'showThreeWayMerge')) {
        captureRenderReady = false;
        captureScheduled = false;
    }

    if (hostReady) {
        pendingMessage = undefined;
        postToRenderer(message);
        return;
    }

    pendingMessage = message;
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
        source: { kind: 'blank' },
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

function readCommitSummary(repoRoot, commit) {
    return runGit(['show', '-s', '--format=%s', commit], repoRoot);
}

function readCommitTimestamp(repoRoot, commit) {
    return runGit(['show', '-s', '--format=%cI', commit], repoRoot);
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
    const options = {
        type: 'info',
        message
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, options);
        return;
    }
    await dialog.showMessageBox(options);
}

async function showError(message) {
    const options = {
        type: 'error',
        message
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, options);
        return;
    }
    await dialog.showMessageBox(options);
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

    const passed = Boolean(snapshot && (
        (
            snapshot.fileInfo === 'Comparing test-file-1.js and test-file-2.js'
            && snapshot.file1 === 'test-file-1.js'
            && snapshot.file2 === 'test-file-2.js'
            && /^1 \/ \d+$/.test(snapshot.changePosition)
            && snapshot.pairedLineCount > 0
            && snapshot.oneSidedLineCount > 0
            && snapshot.inlineHighlightCount > 0
            && snapshot.activeDiffCount === 0
            && isVisibleBackground(snapshot.pairedLineBackground)
            && isVisibleBackground(snapshot.inlineHighlightBackground)
            && snapshot.pairedLineBackground !== snapshot.inlineHighlightBackground
        )
        || (
            snapshot.fileInfo === `Comparing ${snapshot.panelCount} files`
            && snapshot.panelCount >= 2
            && snapshot.gutterCount === snapshot.panelCount - 1
            && /^1 \/ [1-9]\d*$/.test(snapshot.changePosition)
            && snapshot.panelPositions.some((position) => /^1 \/ [1-9]\d*$/.test(position))
            && snapshot.decoratedLineCount > 0
            && /\/media\/diff\.worker\.js$/.test(snapshot.diffWorkerUrl)
            && snapshot.activeDiffCount === 0
            && snapshot.adjacentEdgeCount === 0
            && snapshot.inlineAdjacentEdgeCount === 0
        )
        || (
            snapshot.directoryRailVisible === true
            && snapshot.directoryRailItemCount === 2
            && snapshot.directoryReturnVisible === true
            && snapshot.directorySidebarToggleVisible === true
            && snapshot.directorySidebarToggleWorked === true
            && snapshot.nextFileEnabled === true
        )
        || (
            snapshot.directoryHistoryDrilldown === true
            && snapshot.fileInfo === 'Comparing 2 files'
            && /^1 \/ [1-9]\d*$/.test(snapshot.changePosition)
            && snapshot.panelPositions.some((position) => /^1 \/ [1-9]\d*$/.test(position))
            && snapshot.decoratedLineCount > 0
            && snapshot.visibleChangePaneCount === 2
            && /\/media\/diff\.worker\.js$/.test(snapshot.diffWorkerUrl)
        )
    ));

    if (!passed) {
        console.error(`Bygone smoke test failed: unexpected diff DOM snapshot ${JSON.stringify(snapshot)}`);
        process.exitCode = 1;
        app.exit(1);
        return;
    }

    app.quit();
}

function isVisibleBackground(value) {
    return typeof value === 'string'
        && value.length > 0
        && value !== 'transparent'
        && value !== 'rgba(0, 0, 0, 0)';
}

function scheduleCaptureIfNeeded() {
    if (!captureMode || !mainWindow || mainWindow.isDestroyed() || captureScheduled) {
        return;
    }

    captureScheduled = true;
    const attemptCapture = () => {
        if (!mainWindow || mainWindow.isDestroyed() || !captureOutputPath) {
            return;
        }

        if (!hostReady || !captureRenderReady || mainWindow.webContents.isLoadingMainFrame()) {
            setTimeout(attemptCapture, 120);
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
    };

    setTimeout(attemptCapture, 700);
}

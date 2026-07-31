import { ThreeWayMergeModel, TwoWayDiffModel } from './diffEngine';
import { DirectoryEntry, DirectoryEntryStatus } from './directoryDiff';
import { BinaryComparison } from './binaryComparison';

export { DirectoryEntry, DirectoryEntryStatus };

export interface HistoryViewState {
    canGoBack: boolean;
    canGoForward: boolean;
    positionLabel: string;
    leftCommitLabel: string;
    leftTimestamp: string;
    rightCommitLabel: string;
    rightTimestamp: string;
    includeStaged?: boolean;
    skipUnchanged?: boolean;
    rail?: HistoryRailState;
}

export interface FileNavigationState {
    canGoPrevious: boolean;
    canGoNext: boolean;
}

export interface HistoryRailItem {
    label: string;
    meta?: string;
    active?: boolean;
    status?: string;
    kind?: 'history-entry' | 'directory-entry';
    index?: number;
    relativePath?: string;
}

export interface HistoryRailState {
    activeTabId: string;
    tabs: Array<{
        id: string;
        label: string;
    }>;
    itemsByTab: Record<string, HistoryRailItem[]>;
}

export interface DirectoryNavigationState {
    activeRelativePath: string;
    rail: HistoryRailState;
}

export interface BranchReviewViewState {
    baseRef: string;
    headRef: string;
    mergeBaseOid: string;
    headOid: string;
    dirty: boolean;
    changedFileCount: number;
    viewedCount: number;
    commitCount: number;
    mergeCommitCount: number;
    commits: Array<{
        oid: string;
        shortOid: string;
        timestamp: string;
        summary: string;
        parentOids: string[];
    }>;
}

export interface ShowDiffMessage {
    type: 'showDiff';
    file1: string;
    file2: string;
    comparisonId?: string;
    leftContent: string;
    rightContent: string;
    diffModel: TwoWayDiffModel;
    history: (HistoryViewState & { fileName: string }) | null;
    canReturnToDirectory?: boolean;
    directoryNavigation?: DirectoryNavigationState | null;
    fileNavigation?: FileNavigationState | null;
    editableSides?: {
        left: boolean;
        right: boolean;
    };
    comparisonSummary?: string;
}

export interface ShowBinaryDiffMessage {
    type: 'showBinaryDiff';
    comparison: BinaryComparison;
    comparisonSummary?: string;
    canReturnToDirectory?: boolean;
    directoryNavigation?: DirectoryNavigationState | null;
    fileNavigation?: FileNavigationState | null;
}

export interface ShowDirectoryDiffMessage {
    type: 'showDirectoryDiff';
    leftLabel: string;
    rightLabel: string;
    labels?: string[];
    entries: DirectoryEntry[];
    history?: (HistoryViewState & { fileName: string }) | null;
    canMutate?: boolean;
    review?: BranchReviewViewState | null;
}

export interface MultiDiffPanel {
    id: string;
    label: string;
    content: string;
    editable?: boolean;
    dirty?: boolean;
}

export interface MultiDiffPair {
    leftIndex: number;
    rightIndex: number;
    diffModel: TwoWayDiffModel;
}

export interface ShowMultiDiffMessage {
    type: 'showMultiDiff';
    panels: MultiDiffPanel[];
    pairs: MultiDiffPair[];
    activePanelId?: string | null;
    activePairIndex?: number | null;
    canReturnToDirectory?: boolean;
    directoryNavigation?: DirectoryNavigationState | null;
    fileNavigation?: FileNavigationState | null;
    mutationEnabled?: boolean;
}

export interface ShowThreeWayMergeMessage {
    type: 'showThreeWayMerge';
    base: {
        name: string;
        lines: ThreeWayMergeModel['baseLines'];
    };
    left: {
        name: string;
        lines: ThreeWayMergeModel['leftLines'];
    };
    right: {
        name: string;
        lines: ThreeWayMergeModel['rightLines'];
    };
    result: {
        name: string;
        lines: ThreeWayMergeModel['resultLines'];
    };
    meta: {
        isExperimental: boolean;
        conflictCount: number;
    };
}

export interface ReadyMessage {
    type: 'ready';
}

export interface RecomputeDiffMessage {
    type: 'recomputeDiff';
    leftContent: string;
    rightContent: string;
}

export interface HistoryNavigationMessage {
    type: 'historyBack' | 'historyForward';
}

export interface OpenDirectoryEntryMessage {
    type: 'openDirectoryEntry';
    relativePath: string;
}

export interface SelectHistoryEntryMessage {
    type: 'selectHistoryEntry';
    index: number;
}

export interface ReturnToDirectoryMessage {
    type: 'returnToDirectory';
}

export interface NavigateFileMessage {
    type: 'navigateFile';
    direction: 'previous' | 'next';
}

export interface HistoryToggleStagedMessage {
    type: 'historyToggleStaged';
    includeStaged: boolean;
}

export interface HistoryToggleSkipUnchangedMessage {
    type: 'historyToggleSkipUnchanged';
    skipUnchanged: boolean;
}

export interface MultiSetActivePanelMessage {
    type: 'multiSetActivePanel';
    panelId: string;
}

export interface MultiSetActivePairMessage {
    type: 'multiSetActivePair';
    pairIndex: number;
}

export interface MultiAddPanelMessage {
    type: 'multiAddPanel';
    anchorPanelId: string;
    side: 'left' | 'right';
}

export interface MultiRemovePanelMessage {
    type: 'multiRemovePanel';
    panelId: string;
}

export interface MultiUpdatePanelContentMessage {
    type: 'multiUpdatePanelContent';
    panelId: string;
    content: string;
}

export interface MultiSavePanelMessage {
    type: 'multiSavePanel';
    panelId?: string;
}

export type WebviewInboundMessage =
    | ReadyMessage
    | RecomputeDiffMessage
    | HistoryNavigationMessage
    | OpenDirectoryEntryMessage
    | SelectHistoryEntryMessage
    | ReturnToDirectoryMessage
    | NavigateFileMessage
    | HistoryToggleStagedMessage
    | HistoryToggleSkipUnchangedMessage
    | MultiSetActivePanelMessage
    | MultiSetActivePairMessage
    | MultiAddPanelMessage
    | MultiRemovePanelMessage
    | MultiUpdatePanelContentMessage
    | MultiSavePanelMessage;
export type WebviewOutboundMessage = ShowDiffMessage | ShowBinaryDiffMessage | ShowDirectoryDiffMessage | ShowMultiDiffMessage | ShowThreeWayMergeMessage;

export function isReadyMessage(message: unknown): message is ReadyMessage {
    return getMessageType(message) === 'ready';
}

export function isRecomputeDiffMessage(message: unknown): message is RecomputeDiffMessage {
    return getMessageType(message) === 'recomputeDiff'
        && typeof (message as RecomputeDiffMessage).leftContent === 'string'
        && typeof (message as RecomputeDiffMessage).rightContent === 'string';
}

export function isHistoryNavigationMessage(message: unknown): message is HistoryNavigationMessage {
    return getMessageType(message) === 'historyBack' || getMessageType(message) === 'historyForward';
}

export function isOpenDirectoryEntryMessage(message: unknown): message is OpenDirectoryEntryMessage {
    return getMessageType(message) === 'openDirectoryEntry'
        && typeof (message as OpenDirectoryEntryMessage).relativePath === 'string';
}

export function isSelectHistoryEntryMessage(message: unknown): message is SelectHistoryEntryMessage {
    return getMessageType(message) === 'selectHistoryEntry'
        && Number.isInteger((message as SelectHistoryEntryMessage).index);
}

export function isNavigateFileMessage(message: unknown): message is NavigateFileMessage {
    return getMessageType(message) === 'navigateFile'
        && (((message as NavigateFileMessage).direction) === 'previous'
            || ((message as NavigateFileMessage).direction) === 'next');
}

export function isReturnToDirectoryMessage(message: unknown): message is ReturnToDirectoryMessage {
    return getMessageType(message) === 'returnToDirectory';
}

export function isHistoryToggleStagedMessage(message: unknown): message is HistoryToggleStagedMessage {
    return getMessageType(message) === 'historyToggleStaged'
        && typeof (message as HistoryToggleStagedMessage).includeStaged === 'boolean';
}

export function isHistoryToggleSkipUnchangedMessage(message: unknown): message is HistoryToggleSkipUnchangedMessage {
    return getMessageType(message) === 'historyToggleSkipUnchanged'
        && typeof (message as HistoryToggleSkipUnchangedMessage).skipUnchanged === 'boolean';
}

export function isMultiSetActivePanelMessage(message: unknown): message is MultiSetActivePanelMessage {
    return getMessageType(message) === 'multiSetActivePanel'
        && typeof (message as MultiSetActivePanelMessage).panelId === 'string';
}

export function isMultiSetActivePairMessage(message: unknown): message is MultiSetActivePairMessage {
    return getMessageType(message) === 'multiSetActivePair'
        && Number.isInteger((message as MultiSetActivePairMessage).pairIndex);
}

export function isMultiAddPanelMessage(message: unknown): message is MultiAddPanelMessage {
    return getMessageType(message) === 'multiAddPanel'
        && typeof (message as MultiAddPanelMessage).anchorPanelId === 'string'
        && (((message as MultiAddPanelMessage).side) === 'left'
            || ((message as MultiAddPanelMessage).side) === 'right');
}

export function isMultiRemovePanelMessage(message: unknown): message is MultiRemovePanelMessage {
    return getMessageType(message) === 'multiRemovePanel'
        && typeof (message as MultiRemovePanelMessage).panelId === 'string';
}

export function isMultiUpdatePanelContentMessage(message: unknown): message is MultiUpdatePanelContentMessage {
    return getMessageType(message) === 'multiUpdatePanelContent'
        && typeof (message as MultiUpdatePanelContentMessage).panelId === 'string'
        && typeof (message as MultiUpdatePanelContentMessage).content === 'string';
}

export function isMultiSavePanelMessage(message: unknown): message is MultiSavePanelMessage {
    return getMessageType(message) === 'multiSavePanel'
        && (((message as MultiSavePanelMessage).panelId) === undefined
            || typeof (message as MultiSavePanelMessage).panelId === 'string');
}

function getMessageType(message: unknown): string | undefined {
    return typeof message === 'object' && message !== null && 'type' in message
        ? String((message as { type?: unknown }).type)
        : undefined;
}

import { ThreeWayMergeModel, TwoWayDiffModel } from './diffEngine';
import { DirectoryEntry, DirectoryEntryStatus } from './directoryDiff';

export { DirectoryEntry, DirectoryEntryStatus };

export interface HistoryViewState {
    canGoBack: boolean;
    canGoForward: boolean;
    positionLabel: string;
    leftCommitLabel: string;
    leftTimestamp: string;
    rightCommitLabel: string;
    rightTimestamp: string;
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

export interface ShowDiffMessage {
    type: 'showDiff';
    file1: string;
    file2: string;
    leftContent: string;
    rightContent: string;
    diffModel: TwoWayDiffModel;
    history: (HistoryViewState & { fileName: string }) | null;
    canReturnToDirectory?: boolean;
    fileNavigation?: FileNavigationState | null;
    editableSides?: {
        left: boolean;
        right: boolean;
    };
}

export interface ShowDirectoryDiffMessage {
    type: 'showDirectoryDiff';
    leftLabel: string;
    rightLabel: string;
    labels?: string[];
    entries: DirectoryEntry[];
    history?: (HistoryViewState & { fileName: string }) | null;
}

export interface MultiDiffPanel {
    label: string;
    content: string;
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

export type WebviewInboundMessage =
    | ReadyMessage
    | RecomputeDiffMessage
    | HistoryNavigationMessage
    | OpenDirectoryEntryMessage
    | SelectHistoryEntryMessage
    | ReturnToDirectoryMessage
    | NavigateFileMessage;
export type WebviewOutboundMessage = ShowDiffMessage | ShowDirectoryDiffMessage | ShowMultiDiffMessage | ShowThreeWayMergeMessage;

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

function getMessageType(message: unknown): string | undefined {
    return typeof message === 'object' && message !== null && 'type' in message
        ? String((message as { type?: unknown }).type)
        : undefined;
}

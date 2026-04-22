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

export interface NavigateDirectoryEntryMessage {
    type: 'navigateDirectoryEntry';
    direction: 'previous' | 'next';
}

export interface ReturnToDirectoryMessage {
    type: 'returnToDirectory';
}

export type WebviewInboundMessage =
    | ReadyMessage
    | RecomputeDiffMessage
    | HistoryNavigationMessage
    | OpenDirectoryEntryMessage
    | NavigateDirectoryEntryMessage
    | ReturnToDirectoryMessage;
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

export function isNavigateDirectoryEntryMessage(message: unknown): message is NavigateDirectoryEntryMessage {
    return getMessageType(message) === 'navigateDirectoryEntry'
        && ((message as NavigateDirectoryEntryMessage).direction === 'previous' || (message as NavigateDirectoryEntryMessage).direction === 'next');
}

export function isReturnToDirectoryMessage(message: unknown): message is ReturnToDirectoryMessage {
    return getMessageType(message) === 'returnToDirectory';
}

function getMessageType(message: unknown): string | undefined {
    return typeof message === 'object' && message !== null && 'type' in message
        ? String((message as { type?: unknown }).type)
        : undefined;
}

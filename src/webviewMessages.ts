import { ThreeWayMergeModel, TwoWayDiffModel } from './diffEngine';
import { DirectoryMap } from './directoryDiff';

export { DirectoryMap };

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
    directoryMode?: boolean;
    directoryMap?: DirectoryMap;
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

export type WebviewInboundMessage = ReadyMessage | RecomputeDiffMessage | HistoryNavigationMessage;
export type WebviewOutboundMessage = ShowDiffMessage | ShowThreeWayMergeMessage;

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

function getMessageType(message: unknown): string | undefined {
    return typeof message === 'object' && message !== null && 'type' in message
        ? String((message as { type?: unknown }).type)
        : undefined;
}

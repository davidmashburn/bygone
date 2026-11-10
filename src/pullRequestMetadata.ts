export enum PullRequestState {
    Open = 'OPEN',
    Closed = 'CLOSED',
    Merged = 'MERGED'
}

/**
 * The author's own account of a change. This travels into change tours and LLM
 * dossiers so narrative comes from stated intent rather than inference alone.
 */
export interface PullRequestSummary {
    number: number;
    title: string;
    body: string;
    author: string;
    url: string;
    state: PullRequestState;
    baseRefName: string;
    headRefName: string;
    isCrossRepository: boolean;
}

export interface PullRequestMetadata extends PullRequestSummary {
    baseRefOid: string;
    headRefOid: string;
}

export function parsePullRequestState(value: unknown): PullRequestState {
    switch (value) {
        case PullRequestState.Open: return PullRequestState.Open;
        case PullRequestState.Closed: return PullRequestState.Closed;
        case PullRequestState.Merged: return PullRequestState.Merged;
        default: throw new Error(`Unrecognized pull request state: ${String(value)}`);
    }
}

export function validatePullRequestSummary(value: unknown): asserts value is PullRequestSummary {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Change-tour pullRequest must be an object.');
    }
    const entry = value as Record<string, unknown>;
    if (!Number.isSafeInteger(entry.number) || Number(entry.number) <= 0) {
        throw new Error('pullRequest.number must be a positive integer.');
    }
    for (const key of ['title', 'body', 'author', 'url', 'baseRefName', 'headRefName']) {
        if (typeof entry[key] !== 'string') throw new Error(`pullRequest.${key} must be a string.`);
    }
    parsePullRequestState(entry.state);
    if (typeof entry.isCrossRepository !== 'boolean') {
        throw new Error('pullRequest.isCrossRepository must be a boolean.');
    }
}

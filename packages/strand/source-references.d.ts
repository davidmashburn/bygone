/** Zero-based, half-open UTF-16 coordinates with a SHA-256 of the UTF-8 source slice. */
export type SourceRef = { revision: string; path: string; start: number; end: number; digest: string };
/** Revision IDs are opaque and must identify immutable snapshots within the caller's scope. */
export type SourceSnapshot = { revision: string; files: Record<string, string> };
export type SourcePair = { before: SourceRef; after: SourceRef };
export type SourceResolution = { status: 'valid'; text: string } | { status: 'broken'; reason: string };
export type SourceTransition =
    | { status: 'unchanged' | 'relocated' | 'changed'; before: SourceRef; after: SourceRef }
    | { status: 'unresolved'; before: SourceRef };

/** Malformed references and snapshots throw TypeError; unavailable evidence resolves as broken. */
export function parseSourceRef(value: unknown): SourceRef;
export function pinSourceRef(snapshot: SourceSnapshot, path: string, start: number, end: number): SourceRef;
export function resolveSourceRef(ref: SourceRef, snapshot: SourceSnapshot): SourceResolution;
/** Preserves order; accepts only one-to-one pairs already accepted by the host. No subrange inference. */
export function relocateSourceRefs(refs: SourceRef[], before: SourceSnapshot, after: SourceSnapshot, pairs: SourcePair[]): SourceTransition[];

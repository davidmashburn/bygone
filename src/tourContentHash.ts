import { createHash } from 'crypto';
import type { ChangeTourSource } from './changeTourSource';

/**
 * Hash the authored tour contract while ignoring assessment provenance.
 *
 * Keys are sorted recursively so equivalent JSON objects with different
 * authoring order produce the same fingerprint.  The source is expected to
 * have passed parseChangeTourSource before hashing.
 */
export function hashChangeTourSource(source: ChangeTourSource): string {
    const canonical = canonicalize(source);
    return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function canonicalize(value: unknown, parentKey?: string): unknown {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item));
    if (!isRecord(value)) return value;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
        if (parentKey === 'details' && key === 'assessment') continue;
        const child = value[key];
        if (child === undefined) continue;
        const canonical = canonicalize(child, key);
        if (key === 'details' && isRecord(canonical) && Object.keys(canonical).length === 0) continue;
        result[key] = canonical;
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

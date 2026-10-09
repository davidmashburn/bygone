/** Authored bookends belong to a narrative, independently of its evidence scenes. */
export interface TourPassage {
    title: string;
    summary: string;
    bullets?: string[];
}

export interface ChangeTourFraming {
    opening?: TourPassage;
    conclusion?: TourPassage;
}

export function validateTourFraming(value: Record<string, unknown>, version: unknown, path: string): void {
    for (const key of ['opening', 'conclusion']) {
        const passage = value[key];
        if (passage === undefined) continue;
        if (Number(version) < 5) throw new Error(`${path}.${key} requires version 5.`);
        if (!passage || typeof passage !== 'object' || Array.isArray(passage)) {
            throw new Error(`${path}.${key} must be an object.`);
        }
        const fields = passage as Record<string, unknown>;
        for (const field of Object.keys(fields)) {
            if (!['title', 'summary', 'bullets'].includes(field)) throw new Error(`${path}.${key}.${field} is unsupported.`);
        }
        for (const field of ['title', 'summary']) requireProse(fields[field], `${path}.${key}.${field}`);
        if (fields.bullets !== undefined) {
            if (!Array.isArray(fields.bullets)) throw new Error(`${path}.${key}.bullets must be an array.`);
            fields.bullets.forEach((bullet, index) => requireProse(bullet, `${path}.${key}.bullets[${index}]`));
        }
    }
}

export function validateOverviewPurpose(value: unknown, version: number, path: string): void {
    if (value === undefined) return;
    if (version < 5) {
        if (value && typeof value === 'object' && 'purpose' in value) throw new Error(`${path}.purpose requires version 5.`);
        return;
    }
    requireProse((value as Record<string, unknown> | null)?.purpose, `${path}.purpose`);
}

function requireProse(value: unknown, path: string): void {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a non-empty string.`);
}

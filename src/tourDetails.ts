/** Browser-safe audience details shared by source and manifest validation. */

export type ChangeTourAudienceCodebase = 'none' | 'some' | 'maintainer';
export type ChangeTourAudienceLanguage = 'none' | 'basic' | 'fluent' | 'advanced';
export type ChangeTourAudienceReadingDemand = 'general' | 'technical' | 'specialist';
export type ChangeTourAudiencePurpose = 'overview' | 'explanation' | 'review';

export interface ChangeTourAudience {
    codebase: ChangeTourAudienceCodebase;
    language: ChangeTourAudienceLanguage;
    domain?: string[];
    readingDemand: ChangeTourAudienceReadingDemand;
    purpose: ChangeTourAudiencePurpose;
    scope: string;
    estimatedMinutes?: number;
}

export interface ChangeTourDetails {
    audience?: ChangeTourAudience;
}

export function validateChangeTourDetails(
    value: unknown,
    path: string
): asserts value is ChangeTourDetails | undefined {
    if (value === undefined) return;
    if (!isRecord(value)) throw new Error(`${path} must be an object.`);
    requireOnlyKeys(value, ['audience'], path);
    validateAudience(value.audience, `${path}.audience`);
}

function validateAudience(value: unknown, path: string): void {
    if (value === undefined) return;
    if (!isRecord(value)) throw new Error(`${path} must be an object.`);
    requireOnlyKeys(value, [
        'codebase', 'language', 'domain', 'readingDemand', 'purpose', 'scope', 'estimatedMinutes'
    ], path);
    if (typeof value.codebase !== 'string'
        || !['none', 'some', 'maintainer'].includes(value.codebase)) {
        throw new Error(`${path}.codebase must be none, some, or maintainer.`);
    }
    if (typeof value.language !== 'string'
        || !['none', 'basic', 'fluent', 'advanced'].includes(value.language)) {
        throw new Error(`${path}.language must be none, basic, fluent, or advanced.`);
    }
    if (value.domain !== undefined) requireStringArray(value.domain, `${path}.domain`);
    if (typeof value.readingDemand !== 'string'
        || !['general', 'technical', 'specialist'].includes(value.readingDemand)) {
        throw new Error(`${path}.readingDemand must be general, technical, or specialist.`);
    }
    if (typeof value.purpose !== 'string'
        || !['overview', 'explanation', 'review'].includes(value.purpose)) {
        throw new Error(`${path}.purpose must be overview, explanation, or review.`);
    }
    requireString(value.scope, `${path}.scope`);
    if (value.estimatedMinutes !== undefined
        && (typeof value.estimatedMinutes !== 'number'
            || !Number.isFinite(value.estimatedMinutes)
            || value.estimatedMinutes <= 0)) {
        throw new Error(`${path}.estimatedMinutes must be a finite positive number.`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${path} must be a non-empty string.`);
    }
}

function requireStringArray(value: unknown, path: string): asserts value is string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
        throw new Error(`${path} must be an array of strings.`);
    }
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
    const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unexpected.length > 0) {
        throw new Error(`${path} contains unknown field${unexpected.length === 1 ? '' : 's'}: ${unexpected.join(', ')}`);
    }
}
